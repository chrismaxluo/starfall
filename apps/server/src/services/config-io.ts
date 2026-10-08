// 导出 / 导入配置（需求 F-DA-04）：带版本号的 JSON，素材之间、规则和素材之间用名称和文件哈希关联，
// 不用数据库 ID，所以可以导入到另一台电脑（包括以后的 Windows 版）。不包含 B 站登录信息和后台密码。
//
// 导入的规则：
// - 设置：覆盖文件里有的项
// - 素材：按名称匹配，没有的新建，已有的（非内置）更新；本机多出来的素材保留
// - 进场 / 专属 / 弹幕 / 礼物 / 上舰规则：整体替换成文件里的
// - 黑名单：合并（只添加）
// - 输出：按名称匹配，更新画布设置，地址（访问密钥）不变；没有的新建；本机多出来的保留
import { eq } from 'drizzle-orm';
import { DANMU_WHO_OLD, DanmuWhoSchema, EffectTextsSchema, FADE_DEFAULT_MS, FADE_MAX_MS, FADE_MIN_MS, FEATHER_DEFAULT, FEATHER_MAX, FEATHER_MODES, GIFTS_FILTER_DEFAULT, GIFTS_MAX_DEFAULT, HONOR_LEVEL_MAX, MEDAL_LEVEL_MAX, OFFSET_MAX, POSITIONS, SIZE_MAX, SIZE_MIN, QUICK_MAX, QuickButtonSchema, SVGA_ROLES, TIERS, danmuWhoFromOld } from '@starfall/shared';
import type { GiftRules, GuardRules, Tier } from '@starfall/shared';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { assets, effects, ruleDanmu, ruleExclusive } from '../db/schema.ts';
import { RENAMED_EFFECTS } from '../db/seed.ts';
import type { Settings } from '../db/seed.ts';
import { HttpError } from '../http.ts';
import { issueText } from '../zod-text.ts';
import type { AssetRow, AssetStore } from './assets.ts';
import type { BlacklistStore } from './blacklist.ts';
import type { DanmuRuleStore, GiftRuleStore, GuardRuleStore } from './event-rules.ts';
import { OutputInputSchema } from './outputs.ts';
import type { OutputStore } from './outputs.ts';
import type { QuickPlayStore } from './quick-play.ts';
import type { EnterRuleStore } from './rules.ts';
import type { SettingsStore } from './settings.ts';

export const CONFIG_FORMAT = 'starfall-config';
/** 2：弹幕规则的发送人条件改成多选（旧版本导入不了新文件，会提示先升级） */
export const CONFIG_VERSION = 2;
/** zip 里配置文件的名称；素材文件放在 files/ 下 */
export const CONFIG_ENTRY = 'starfall-config.json';

/** 导出的设置项（不含暂停状态这类运行时状态） */
const SETTING_KEYS = ['connectMode', 'offlinePolicy', 'cooldownMode', 'queueMax', 'queueJump', 'giftAnimImg', 'blockAnchor', 'blockAccount', 'retentionDays', 'giftComboEnabled', 'giftComboSec', 'autoBackup', 'featherOn', 'featherPct'] as const;
const SETTING_NAMES: Record<(typeof SETTING_KEYS)[number], string> = {
  connectMode: '连接直播间的时机',
  offlinePolicy: '未开播时是否播放',
  cooldownMode: '进场冷却方式',
  queueMax: '最多排队数',
  queueJump: '高价值插队',
  giftAnimImg: '礼物图用动图',
  blockAnchor: '主播本人不触发',
  blockAccount: '登录的账号不触发',
  retentionDays: '事件记录保留期',
  giftComboEnabled: '礼物连击合并',
  giftComboSec: '连击合并时间',
  autoBackup: '每天自动备份',
  featherOn: '素材上下羽化',
  featherPct: '上下羽化宽度',
};

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const effectRef = z.string().min(1).max(40).nullable();
const cooldownMin = z.number().int().min(0).max(1440);

const SettingsPart = z
  .object({
    connectMode: z.enum(['live_only', 'always']),
    offlinePolicy: z.enum(['mute', 'play']),
    cooldownMode: z.enum(['minutes', 'oncePerLive']),
    queueMax: z.number().int().min(3).max(30),
    queueJump: z.boolean(),
    giftAnimImg: z.boolean(),
    blockAnchor: z.boolean(),
    blockAccount: z.boolean(),
    retentionDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(180)]),
    giftComboEnabled: z.boolean(),
    giftComboSec: z.number().int().min(1).max(15),
    autoBackup: z.boolean(),
    featherOn: z.boolean(),
    featherPct: z.number().int().min(0).max(FEATHER_MAX),
  })
  .partial();

const AssetPart = z.object({
  sha256: sha,
  kind: z.enum(['video', 'image', 'fx', 'audio']),
  filename: z.string().min(1).max(200),
  ext: z.string().regex(/^[a-z0-9]{2,5}$/),
  size: z.number().int().min(0),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  hasAlpha: z.boolean(),
});

const EffectPart = z.object({
  name: z.string().min(1).max(40),
  builtin: z.boolean(),
  style: z.string().max(40).nullable(),
  asset: sha.nullable(),
  sound: sha.nullable(),
  showText: z.boolean(),
  texts: EffectTextsSchema,
  volume: z.number().int().min(0).max(100),
  position: z.enum(POSITIONS),
  durationMs: z.number().int().min(500).max(30_000),
  durationCustom: z.boolean().default(false),
  // 旧版本导出的文件没有这两项：保持以前的淡入淡出
  fadeIn: z.boolean().default(true),
  fadeOut: z.boolean().default(true),
  fadeInMs: z.number().int().min(FADE_MIN_MS).max(FADE_MAX_MS).default(FADE_DEFAULT_MS),
  fadeOutMs: z.number().int().min(FADE_MIN_MS).max(FADE_MAX_MS).default(FADE_DEFAULT_MS),
  offsetX: z.number().min(-OFFSET_MAX).max(OFFSET_MAX).default(0),
  offsetY: z.number().min(-OFFSET_MAX).max(OFFSET_MAX).default(0),
  sizePct: z.number().int().min(SIZE_MIN).max(SIZE_MAX).default(100),
  feather: z.enum(FEATHER_MODES).default('global'),
  featherPct: z.number().int().min(0).max(FEATHER_MAX).default(FEATHER_DEFAULT),
  guardFrame: z.boolean().default(false),
  honorBadge: z.boolean().default(false),
  svgaMap: z.record(z.string().min(1).max(120), z.enum(SVGA_ROLES)).default({}),
});

const TierPart = z.object({ effect: effectRef, cooldownMin, enabled: z.boolean() });

const RulesPart = z.object({
  enter: z.object({
    tiers: z.object({ gov: TierPart, adm: TierPart, cap: TierPart, mod: TierPart, nor: TierPart }),
    bands: z.array(z.object({ fromLevel: z.number().int().min(1).max(MEDAL_LEVEL_MAX), effect: effectRef, cooldownMin, enabled: z.boolean() })).min(1).max(20),
    /** 旧版本导出的没有这一项：导入时不改动现有的荣耀等级分档 */
    honorBands: z.array(z.object({ fromLevel: z.number().int().min(1).max(HONOR_LEVEL_MAX), effect: effectRef, cooldownMin, enabled: z.boolean() })).max(20).optional(),
  }),
  exclusives: z
    .array(z.object({ uid: z.number().int().positive(), name: z.string().max(60).default(''), effect: effectRef, cooldownMin, until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), enabled: z.boolean() }))
    .max(2000),
  danmu: z
    .array(
      z.object({
        keywords: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
        mode: z.enum(['contains', 'exact']),
        // 旧版本导出的是单选（字符串）
        who: z.union([z.enum(DANMU_WHO_OLD).transform(danmuWhoFromOld), DanmuWhoSchema]),
        effect: effectRef,
        globalCdSec: z.number().int().min(0).max(3600),
        userCdMin: z.number().int().min(0).max(1440),
        enabled: z.boolean(),
      }),
    )
    .max(500),
  gift: z.object({
    specific: z.array(z.object({ giftId: z.number().int().positive(), giftName: z.string().max(40), effect: effectRef, enabled: z.boolean() })).max(200),
    bands: z.array(z.object({ fromGold: z.number().int().min(1), effect: effectRef, enabled: z.boolean() })).min(1).max(20),
  }),
  guard: z.object(Object.fromEntries((['gov', 'adm', 'cap'] as const).map((t) => [t, z.object({ open: effectRef, renew: effectRef, enabled: z.boolean() })])) as Record<'gov' | 'adm' | 'cap', z.ZodObject<{ open: typeof effectRef; renew: typeof effectRef; enabled: z.ZodBoolean }>>),
});

// 弹幕列表的设置是 v1.3 加的：以前导出的文件里没有，用默认值
const OutputPart = OutputInputSchema.extend({
  chatEnabled: OutputInputSchema.shape.chatEnabled.default(true),
  chatSide: OutputInputSchema.shape.chatSide.default('left'),
  chatSize: OutputInputSchema.shape.chatSize.default('normal'),
  chatMedal: OutputInputSchema.shape.chatMedal.default('own'),
  chatMax: OutputInputSchema.shape.chatMax.default(8),
  chatFadeSec: OutputInputSchema.shape.chatFadeSec.default(0),
  // 送礼名单是 v1.5 加的
  giftsEnabled: OutputInputSchema.shape.giftsEnabled.default(true),
  giftsSide: OutputInputSchema.shape.giftsSide.default('right'),
  giftsSize: OutputInputSchema.shape.giftsSize.default('normal'),
  giftsMax: OutputInputSchema.shape.giftsMax.default(GIFTS_MAX_DEFAULT),
  giftsSpeed: OutputInputSchema.shape.giftsSpeed.default('normal'),
  giftsFilter: OutputInputSchema.shape.giftsFilter.default(GIFTS_FILTER_DEFAULT),
});

export const ConfigFileSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string(),
  settings: SettingsPart,
  assets: z.array(AssetPart).max(5000),
  effects: z.array(EffectPart).max(2000),
  rules: RulesPart,
  blacklist: z.array(z.object({ uid: z.number().int().positive(), name: z.string().max(60).default(''), note: z.string().max(200).default('') })).max(5000),
  outputs: z.array(OutputPart).max(20),
  // 素材快捷播放是 v1.5 加的：以前导出的文件里没有，导入时不动现有的按钮
  quickPlay: z
    .array(z.object({ effect: z.string().min(1), label: QuickButtonSchema.shape.label, hotkey: QuickButtonSchema.shape.hotkey, globalHotkey: QuickButtonSchema.shape.globalHotkey }))
    .max(QUICK_MAX)
    .optional(),
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** 导入预览里的一组变化 */
export interface PlanSection {
  key: 'settings' | 'effects' | 'enter' | 'exclusive' | 'danmu' | 'gift' | 'guard' | 'quickplay' | 'blacklist' | 'outputs';
  label: string;
  /** 一句话概括，例如"新增 2 · 修改 1" */
  summary: string;
  changed: boolean;
  /** 具体变化，最多列出 20 条 */
  details: string[];
}

export interface ImportPlan {
  exportedAt: string;
  sections: PlanSection[];
  /** 导入后会有问题的地方（缺文件、找不到素材等） */
  warnings: string[];
  files: { needed: number; missing: number };
}

/** 解析并校验配置文件；格式不对时给出能看懂的错误 */
export function parseConfigFile(text: string): ConfigFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_config', '不是有效的配置文件（JSON 格式错误）');
  }
  const head = json as { format?: unknown; version?: unknown };
  if (head?.format !== CONFIG_FORMAT) throw new HttpError(400, 'invalid_config', '这不是星临导出的配置文件');
  if (typeof head.version === 'number' && head.version > CONFIG_VERSION) throw new HttpError(400, 'config_too_new', '这个配置文件来自更新的版本，请先升级星临再导入');
  const r = ConfigFileSchema.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new HttpError(400, 'invalid_config', `配置文件内容有误：${issueText(i)}（位置 ${i.path.join('.') || '最外层'}）`);
  }
  return renameOldBuiltins(r.data);
}

/** 以前导出的文件里，改过名的内置素材还是旧名字：换成新名字（素材列表和所有引用素材的地方） */
function renameOldBuiltins(f: ConfigFile): ConfigFile {
  const alias = new Map(f.effects.filter((e) => e.builtin && RENAMED_EFFECTS[e.name] && !f.effects.some((x) => x.name === RENAMED_EFFECTS[e.name])).map((e) => [e.name, RENAMED_EFFECTS[e.name]!]));
  if (!alias.size) return f;
  const REF_KEYS = new Set(['effect', 'open', 'renew']);
  const walk = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REF_KEYS.has(k) && typeof x === 'string' ? (alias.get(x) ?? x) : walk(x)])) : v;
  const { effects: list, ...rest } = f;
  return { ...(walk(rest) as Omit<ConfigFile, 'effects'>), effects: list.map((e) => (alias.has(e.name) ? { ...e, name: alias.get(e.name)! } : e)) };
}

interface Deps {
  db: Db;
  settings: SettingsStore;
  assets: AssetStore;
  enterRules: EnterRuleStore;
  danmuRules: DanmuRuleStore;
  giftRules: GiftRuleStore;
  guardRules: GuardRuleStore;
  quickPlay: QuickPlayStore;
  blacklist: BlacklistStore;
  outputs: OutputStore;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clip = (xs: string[]) => (xs.length > 20 ? [...xs.slice(0, 20), `…… 还有 ${xs.length - 20} 条`] : xs);
const counts = (add: number, mod: number, del = 0) => [add && `新增 ${add}`, mod && `修改 ${mod}`, del && `删除 ${del}`].filter(Boolean).join(' · ') || '没有变化';

export class ConfigIO {
  private readonly d: Deps;
  constructor(deps: Deps) {
    this.d = deps;
  }

  // ---------- 导出 ----------

  export(): ConfigFile {
    const { db, settings } = this.d;
    const effectRows = db.select().from(effects).all();
    const assetRows = new Map(db.select().from(assets).all().map((a) => [a.id, a]));
    const nameOf = new Map(effectRows.map((e) => [e.id, e.name]));
    const ref = (id: number | null) => (id === null ? null : (nameOf.get(id) ?? null));
    const shaOf = (id: number | null) => (id === null ? null : (assetRows.get(id)?.sha256 ?? null));

    const all = settings.all();
    const usedAssets = new Set<number>();
    for (const e of effectRows) {
      if (e.assetId !== null) usedAssets.add(e.assetId);
      if (e.soundAssetId !== null) usedAssets.add(e.soundAssetId);
    }
    // 音效库里没被用到的音效也一起导出
    for (const a of assetRows.values()) if (a.kind === 'audio') usedAssets.add(a.id);

    const base = this.d.enterRules.base();
    const gift = this.d.giftRules.get();
    const guard = this.d.guardRules.get();
    const exclusives = this.d.enterRules.exclusives();
    return {
      format: CONFIG_FORMAT,
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, all[k]])),
      assets: [...usedAssets]
        .map((id) => assetRows.get(id)!)
        .map((a) => ({ sha256: a.sha256, kind: a.kind, filename: a.filename, ext: a.ext, size: a.size, width: a.width, height: a.height, durationMs: a.durationMs, hasAlpha: a.hasAlpha })),
      effects: effectRows.map((e) => ({
        name: e.name,
        builtin: e.builtin,
        style: e.style,
        asset: shaOf(e.assetId),
        sound: shaOf(e.soundAssetId),
        showText: e.showText,
        texts: e.texts,
        volume: e.volume,
        position: e.position,
        durationMs: e.durationMs,
        durationCustom: e.durationCustom,
        fadeIn: e.fadeIn,
        fadeOut: e.fadeOut,
        fadeInMs: e.fadeInMs,
        fadeOutMs: e.fadeOutMs,
        offsetX: e.offsetX,
        offsetY: e.offsetY,
        sizePct: e.sizePct,
        feather: e.feather,
        featherPct: e.featherPct,
        guardFrame: e.guardFrame,
        honorBadge: e.honorBadge,
        svgaMap: e.svgaMap,
      })),
      rules: {
        enter: {
          tiers: Object.fromEntries(TIERS.map((t) => [t, { effect: ref(base.tiers[t].effectId), cooldownMin: base.tiers[t].cooldownMin, enabled: base.tiers[t].enabled }])) as ConfigFile['rules']['enter']['tiers'],
          bands: base.bands.map((b) => ({ fromLevel: b.fromLevel, effect: ref(b.effectId), cooldownMin: b.cooldownMin, enabled: b.enabled })),
          honorBands: base.honorBands.map((b) => ({ fromLevel: b.fromLevel, effect: ref(b.effectId), cooldownMin: b.cooldownMin, enabled: b.enabled })),
        },
        exclusives: exclusives.map((x) => ({ uid: x.uid, name: x.name ?? '', effect: ref(x.effectId), cooldownMin: x.cooldownMin, until: x.until, enabled: x.enabled })),
        danmu: this.d.danmuRules.list().map((r) => ({ keywords: r.keywords, mode: r.mode, who: r.who, effect: ref(r.effectId), globalCdSec: r.globalCdSec, userCdMin: r.userCdMin, enabled: r.enabled })),
        gift: {
          specific: gift.specific.map((s) => ({ giftId: s.giftId, giftName: s.giftName, effect: ref(s.effectId), enabled: s.enabled })),
          bands: gift.bands.map((b) => ({ fromGold: b.fromGold, effect: ref(b.effectId), enabled: b.enabled })),
        },
        guard: Object.fromEntries((['gov', 'adm', 'cap'] as const).map((t) => [t, { open: ref(guard[t].openEffectId), renew: ref(guard[t].renewEffectId), enabled: guard[t].enabled }])) as ConfigFile['rules']['guard'],
      },
      blacklist: this.d.blacklist.list().map((b) => ({ uid: b.uid, name: b.name, note: b.note })),
      quickPlay: this.d.quickPlay.list().flatMap((b) => {
        const effect = ref(b.effectId);
        return effect === null ? [] : [{ effect, label: b.label, hotkey: b.hotkey, globalHotkey: b.globalHotkey }];
      }),
      outputs: this.d.outputs.list().map((o) => ({ name: o.name, app: o.app, orient: o.orient, width: o.width, height: o.height, safeTop: o.safeTop, safeBottom: o.safeBottom, marginX: o.marginX, scale: o.scale, liteMode: o.liteMode, chatEnabled: o.chatEnabled, chatSide: o.chatSide, chatSize: o.chatSize, chatMedal: o.chatMedal, chatMax: o.chatMax, chatFadeSec: o.chatFadeSec, giftsEnabled: o.giftsEnabled, giftsSide: o.giftsSide, giftsSize: o.giftsSize, giftsMax: o.giftsMax, giftsSpeed: o.giftsSpeed, giftsFilter: o.giftsFilter })),
    };
  }

  /** 配置里用到的文件（导出 zip 时一起打包） */
  exportFiles(file: ConfigFile): AssetRow[] {
    const want = new Set(file.assets.map((a) => a.sha256));
    return this.d.db.select().from(assets).all().filter((a) => want.has(a.sha256));
  }

  // ---------- 导入预览 ----------

  /** 本机已有的文件哈希 */
  private localShas(): Set<string> {
    return new Set(this.d.db.select({ s: assets.sha256 }).from(assets).all().map((r) => r.s));
  }

  /** 导入后哪些素材能用：本机已有的 + 文件里新建的（画面文件齐全的） */
  private resolvableEffects(file: ConfigFile, shas: Set<string>): { names: Set<string>; skipped: string[] } {
    const local = new Map(this.d.db.select({ name: effects.name, builtin: effects.builtin }).from(effects).all().map((e) => [e.name, e]));
    const names = new Set(local.keys());
    const skipped: string[] = [];
    for (const e of file.effects) {
      if (local.has(e.name)) continue;
      if (e.builtin) {
        skipped.push(`内置素材「${e.name}」在这个版本里没有`);
        continue;
      }
      if (e.asset === null && e.style === null) continue;
      if (e.asset !== null && !shas.has(e.asset)) {
        skipped.push(`素材「${e.name}」缺少画面文件，没有导入`);
        continue;
      }
      names.add(e.name);
    }
    return { names, skipped };
  }

  /**
   * 预览导入会带来的变化。extraShas：zip 里带的文件（导入时会先保存）
   */
  plan(file: ConfigFile, extraShas: Set<string> = new Set()): ImportPlan {
    const cur = this.export();
    const shas = new Set([...this.localShas(), ...extraShas]);
    const { names, skipped } = this.resolvableEffects(file, shas);
    const warnings = [...skipped];
    const missingRef = new Set<string>();
    const refOk = (n: string | null) => {
      if (n !== null && !names.has(n)) missingRef.add(n);
    };
    const sections: PlanSection[] = [];

    // 设置
    {
      const details: string[] = [];
      for (const k of SETTING_KEYS) {
        const v = file.settings[k];
        if (v !== undefined && !same(v, cur.settings[k])) details.push(`${SETTING_NAMES[k]}：${fmt(cur.settings[k])} → ${fmt(v)}`);
      }
      sections.push({ key: 'settings', label: '设置', summary: details.length ? `修改 ${details.length} 项` : '没有变化', changed: details.length > 0, details });
    }

    // 素材
    {
      const curBy = new Map(cur.effects.map((e) => [e.name, e]));
      const add: string[] = [];
      const mod: string[] = [];
      for (const e of file.effects) {
        const c = curBy.get(e.name);
        if (!c) {
          if (names.has(e.name)) add.push(`新增素材「${e.name}」`);
        } else if (!c.builtin && !e.builtin && !same(stripName(c), stripName(e))) {
          if (e.asset !== null && !shas.has(e.asset)) warnings.push(`素材「${e.name}」的新画面文件缺失，保留本机的文件`);
          mod.push(`更新素材「${e.name}」`);
        }
      }
      sections.push({ key: 'effects', label: '素材', summary: counts(add.length, mod.length), changed: add.length + mod.length > 0, details: clip([...add, ...mod]) });
    }

    // 进场规则
    {
      const r = file.rules.enter;
      for (const t of TIERS) refOk(r.tiers[t].effect);
      for (const b of r.bands) refOk(b.effect);
      for (const b of r.honorBands ?? []) refOk(b.effect);
      const details: string[] = [];
      for (const t of TIERS) if (!same(cur.rules.enter.tiers[t], r.tiers[t])) details.push(`${TIER_LABEL[t]}：${describeTier(cur.rules.enter.tiers[t])} → ${describeTier(r.tiers[t])}`);
      if (!same(cur.rules.enter.bands, r.bands)) details.push(`粉丝牌分档：${cur.rules.enter.bands.length} 档 → ${r.bands.length} 档`);
      const curHonor = cur.rules.enter.honorBands ?? [];
      if (r.honorBands && !same(curHonor, r.honorBands)) details.push(`荣耀等级分档：${curHonor.length} 档 → ${r.honorBands.length} 档`);
      sections.push({ key: 'enter', label: '进场规则', summary: details.length ? `修改 ${details.length} 处` : '没有变化', changed: details.length > 0, details });
    }

    // 专属用户（整体替换）
    {
      const curBy = new Map(cur.rules.exclusives.map((x) => [x.uid, x]));
      const fileBy = new Map(file.rules.exclusives.map((x) => [x.uid, x]));
      const details: string[] = [];
      let add = 0;
      let mod = 0;
      let del = 0;
      for (const x of file.rules.exclusives) {
        refOk(x.effect);
        const c = curBy.get(x.uid);
        const who = x.name || `UID ${x.uid}`;
        if (x.effect === null || !names.has(x.effect)) warnings.push(`专属用户 ${who} 的素材找不到，这条不会导入`);
        if (!c) {
          add++;
          details.push(`新增专属用户 ${who}`);
        } else if (!same({ ...c, name: '' }, { ...x, name: '' })) {
          mod++;
          details.push(`修改专属用户 ${who}`);
        }
      }
      for (const c of cur.rules.exclusives) {
        if (!fileBy.has(c.uid)) {
          del++;
          details.push(`删除专属用户 ${c.name || `UID ${c.uid}`}`);
        }
      }
      sections.push({ key: 'exclusive', label: '专属用户', summary: counts(add, mod, del), changed: add + mod + del > 0, details: clip(details) });
    }

    // 弹幕规则（整体替换）
    {
      for (const r of file.rules.danmu) refOk(r.effect);
      const changed = !same(cur.rules.danmu, file.rules.danmu);
      sections.push({
        key: 'danmu',
        label: '弹幕规则',
        summary: changed ? `${cur.rules.danmu.length} 条 → ${file.rules.danmu.length} 条` : '没有变化',
        changed,
        details: changed ? clip(file.rules.danmu.map((r, i) => `${i + 1}. 「${r.keywords.join(' / ')}」→ ${r.effect ?? '（未选素材）'}`)) : [],
      });
    }

    // 礼物规则
    {
      const g = file.rules.gift;
      for (const s of g.specific) refOk(s.effect);
      for (const b of g.bands) refOk(b.effect);
      const details: string[] = [];
      if (!same(cur.rules.gift.specific, g.specific)) details.push(`指定礼物：${cur.rules.gift.specific.length} 种 → ${g.specific.length} 种`);
      if (!same(cur.rules.gift.bands, g.bands)) details.push(`价值分档：${cur.rules.gift.bands.length} 档 → ${g.bands.length} 档`);
      sections.push({ key: 'gift', label: '礼物规则', summary: details.length ? `修改 ${details.length} 处` : '没有变化', changed: details.length > 0, details });
    }

    // 上舰规则
    {
      const details: string[] = [];
      for (const t of ['gov', 'adm', 'cap'] as const) {
        const f = file.rules.guard[t];
        refOk(f.open);
        refOk(f.renew);
        if (!same(cur.rules.guard[t], f)) details.push(`${TIER_LABEL[t]}：开通 ${f.open ?? '无'}，续费 ${f.renew ?? '无'}${f.enabled ? '' : '（停用）'}`);
      }
      sections.push({ key: 'guard', label: '上舰规则', summary: details.length ? `修改 ${details.length} 处` : '没有变化', changed: details.length > 0, details });
    }

    // 素材快捷播放（整体替换；旧版本导出的文件里没有，不动）
    if (file.quickPlay) {
      const fq = file.quickPlay;
      const changed = !same(cur.quickPlay, fq);
      for (const b of fq) if (!names.has(b.effect)) warnings.push(`快捷播放按钮「${b.label || b.effect}」的素材找不到，这个按钮不会导入`);
      sections.push({
        key: 'quickplay',
        label: '素材快捷播放',
        summary: changed ? `${cur.quickPlay?.length ?? 0} 个按钮 → ${fq.length} 个` : '没有变化',
        changed,
        details: changed ? clip(fq.map((b, i) => `${i + 1}. ${b.label || b.effect}${b.hotkey ? `（快捷键 ${b.hotkey}）` : ''}`)) : [],
      });
    }

    // 黑名单（合并）
    {
      const have = new Set(cur.blacklist.map((b) => b.uid));
      const add = file.blacklist.filter((b) => !have.has(b.uid));
      sections.push({ key: 'blacklist', label: '黑名单', summary: add.length ? `新增 ${add.length} 人（已有的保留）` : '没有变化', changed: add.length > 0, details: clip(add.map((b) => `加入 ${b.name || `UID ${b.uid}`}`)) });
    }

    // 输出
    {
      const curBy = new Map(cur.outputs.map((o) => [o.name, o]));
      const details: string[] = [];
      let add = 0;
      let mod = 0;
      for (const o of file.outputs) {
        const c = curBy.get(o.name);
        if (!c) {
          add++;
          details.push(`新建输出「${o.name}」（${o.width}×${o.height}，地址是新的）`);
        } else if (!same(c, o)) {
          mod++;
          details.push(`更新输出「${o.name}」的画布设置（地址不变）`);
        }
      }
      sections.push({ key: 'outputs', label: '直播软件输出', summary: counts(add, mod), changed: add + mod > 0, details });
    }

    for (const n of missingRef) warnings.push(`规则里用到的素材「${n}」找不到，这些规则会变成"未选素材"`);
    const needed = new Set(file.effects.filter((e) => !e.builtin).flatMap((e) => [e.asset, e.sound]).filter((x): x is string => x !== null));
    return { exportedAt: file.exportedAt, sections, warnings: [...new Set(warnings)], files: { needed: needed.size, missing: [...needed].filter((s) => !shas.has(s)).length } };
  }

  // ---------- 导入 ----------

  /** 应用配置文件。文件（zip 里带的）需要事先保存到素材库 */
  apply(file: ConfigFile): void {
    const { db } = this.d;
    const outputOps: Array<() => void> = [];
    db.$client.transaction(() => {
      // 1. 设置
      for (const k of SETTING_KEYS) {
        const v = file.settings[k];
        if (v !== undefined) this.d.settings.set(k, v as Settings[typeof k]);
      }

      // 2. 素材：按名称新建 / 更新
      const assetBySha = new Map(db.select().from(assets).all().map((a) => [a.sha256, a]));
      const idOfSha = (s: string | null) => (s === null ? null : (assetBySha.get(s)?.id ?? null));
      const soundOf = (s: string | null) => {
        const a = s === null ? undefined : assetBySha.get(s);
        return a && a.kind === 'audio' ? a.id : null;
      };
      const local = new Map(db.select().from(effects).all().map((e) => [e.name, e]));
      for (const e of file.effects) {
        const c = local.get(e.name);
        const assetId = idOfSha(e.asset);
        const values = { showText: e.showText, texts: e.texts, soundAssetId: soundOf(e.sound), volume: e.volume, position: e.position, durationMs: e.durationMs, durationCustom: e.durationCustom, fadeIn: e.fadeIn, fadeOut: e.fadeOut, fadeInMs: e.fadeInMs, fadeOutMs: e.fadeOutMs, offsetX: e.offsetX, offsetY: e.offsetY, sizePct: e.sizePct, feather: e.feather, featherPct: e.featherPct, guardFrame: e.guardFrame, honorBadge: e.honorBadge, svgaMap: e.svgaMap, updatedAt: Date.now() };
        if (c) {
          if (c.builtin || e.builtin) continue;
          // 新文件缺失时保留本机的画面
          const visual = e.asset === null ? { style: e.style, assetId: null } : assetId !== null ? { style: null, assetId } : {};
          if (e.asset === null && e.style === null) continue;
          db.update(effects).set({ ...values, ...visual }).where(eq(effects.id, c.id)).run();
        } else {
          if (e.builtin) continue;
          if (e.asset !== null ? assetId === null : e.style === null) continue;
          db.insert(effects).values({ name: e.name, builtin: false, style: e.asset === null ? e.style : null, assetId, ...values }).run();
        }
      }
      const idOf = new Map(db.select({ id: effects.id, name: effects.name }).from(effects).all().map((e) => [e.name, e.id]));
      const ref = (n: string | null) => (n === null ? null : (idOf.get(n) ?? null));

      // 3. 进场规则
      const r = file.rules;
      this.d.enterRules.setBase({
        tiers: Object.fromEntries(TIERS.map((t) => [t, { effectId: ref(r.enter.tiers[t].effect), cooldownMin: r.enter.tiers[t].cooldownMin, enabled: r.enter.tiers[t].enabled }])) as Record<Tier, { effectId: number | null; cooldownMin: number; enabled: boolean }>,
        bands: r.enter.bands.map((b) => ({ fromLevel: b.fromLevel, effectId: ref(b.effect), cooldownMin: b.cooldownMin, enabled: b.enabled })),
        honorBands: r.enter.honorBands ? r.enter.honorBands.map((b) => ({ fromLevel: b.fromLevel, effectId: ref(b.effect), cooldownMin: b.cooldownMin, enabled: b.enabled })) : this.d.enterRules.base().honorBands,
        cooldownMode: file.settings.cooldownMode ?? this.d.settings.get('cooldownMode'),
      });

      // 4. 专属用户：整体替换；找不到素材的跳过
      db.delete(ruleExclusive).run();
      for (const x of r.exclusives) {
        const effectId = ref(x.effect);
        if (effectId !== null) db.insert(ruleExclusive).values({ uid: x.uid, effectId, cooldownMin: x.cooldownMin, until: x.until, enabled: x.enabled }).run();
      }

      // 5. 弹幕规则：整体替换
      db.delete(ruleDanmu).run();
      for (const d of r.danmu) this.d.danmuRules.create({ keywords: d.keywords, mode: d.mode, who: d.who, effectId: ref(d.effect), globalCdSec: d.globalCdSec, userCdMin: d.userCdMin, enabled: d.enabled });

      // 6. 礼物、上舰
      const gift: GiftRules = {
        specific: r.gift.specific.map((s) => ({ giftId: s.giftId, giftName: s.giftName, effectId: ref(s.effect), enabled: s.enabled })),
        bands: r.gift.bands.map((b) => ({ fromGold: b.fromGold, effectId: ref(b.effect), enabled: b.enabled })),
        comboEnabled: file.settings.giftComboEnabled ?? this.d.settings.get('giftComboEnabled'),
        comboSec: file.settings.giftComboSec ?? this.d.settings.get('giftComboSec'),
      };
      this.d.giftRules.set(gift);
      const guard = Object.fromEntries((['gov', 'adm', 'cap'] as const).map((t) => [t, { openEffectId: ref(r.guard[t].open), renewEffectId: ref(r.guard[t].renew), enabled: r.guard[t].enabled }])) as GuardRules;
      this.d.guardRules.set(guard);

      // 7. 素材快捷播放：整体替换；找不到素材的跳过
      if (file.quickPlay) {
        const keep = file.quickPlay.flatMap((b) => {
          const effectId = ref(b.effect);
          return effectId === null ? [] : [{ effectId, label: b.label, hotkey: b.hotkey, globalHotkey: b.globalHotkey }];
        });
        this.d.quickPlay.save(keep);
      }

      // 8. 黑名单：合并
      const have = new Set(this.d.blacklist.list().map((b) => b.uid));
      for (const b of file.blacklist) if (!have.has(b.uid)) this.d.blacklist.add(b);

      // 9. 输出：提交后再改，改动会立刻推给在线的特效页
      const curOut = new Map(this.d.outputs.list().map((o) => [o.name, o]));
      for (const o of file.outputs) {
        const c = curOut.get(o.name);
        outputOps.push(c ? () => this.d.outputs.update(c.id, o) : () => this.d.outputs.create(o));
      }
    })();
    for (const op of outputOps) op();
  }
}

const TIER_LABEL: Record<string, string> = { gov: '总督', adm: '提督', cap: '舰长', mod: '房管', nor: '其他观众' };
const describeTier = (t: { effect: string | null; cooldownMin: number; enabled: boolean }) => `${t.effect ?? '未选素材'}，冷却 ${t.cooldownMin} 分钟${t.enabled ? '' : '（停用）'}`;
const stripName = ({ name: _n, ...rest }: ConfigFile['effects'][number]) => rest;
function fmt(v: unknown): string {
  if (v === true) return '开';
  if (v === false) return '关';
  const words: Record<string, string> = { live_only: '只在开播时', always: '一直连接', mute: '不播放', play: '照常播放', minutes: '按分钟', oncePerLive: '每场一次' };
  return typeof v === 'string' ? (words[v] ?? v) : String(v);
}
