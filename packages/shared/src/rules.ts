// 素材与规则的数据格式。用 Zod 定义，既做接口校验，也生成 TypeScript 类型，前后端共用。
import { FEATHER_MAX } from './overlay.ts';
import { z } from 'zod';

export * from './labels.ts';

// ---------- 素材 ----------

export const POSITIONS = ['bl', 'br', 'top', 'center'] as const;
export type Position = (typeof POSITIONS)[number];

/** 欢迎语按事件分开写；没写的事件使用 enter（通用） */
export const EffectTextsSchema = z.object({
  enter: z.array(z.string().max(100)).max(20),
  danmu: z.array(z.string().max(100)).max(20).optional(),
  gift: z.array(z.string().max(100)).max(20).optional(),
  guard: z.array(z.string().max(100)).max(20).optional(),
});
export type EffectTexts = z.infer<typeof EffectTextsSchema>;

/** 渐入、渐出时长的范围和默认值（毫秒） */
export const FADE_MIN_MS = 100;
export const FADE_MAX_MS = 5000;
export const FADE_DEFAULT_MS = 500;
/** 上传的素材在选好的位置上再挪动多少：画面宽、高的百分比（正数往右、往下） */
export const OFFSET_MAX = 100;
/** 上传的素材显示大小：程序自动算出的大小的百分比 */
export const SIZE_MIN = 20;
export const SIZE_MAX = 200;
/** 上下羽化：跟随全局设置 / 这个素材自己设置 / 不羽化；宽度是素材高度的百分比 */
export const FEATHER_MODES = ['global', 'custom', 'off'] as const;
export type FeatherMode = (typeof FEATHER_MODES)[number];
export const FEATHER_DEFAULT = 10;
/** SVGA 的图层播放时换成什么：头像（圆形 / 方形）、头像框、身份图标（船锚）、昵称、欢迎语 */
export const SVGA_ROLES = ['avatar', 'avatarSquare', 'frame', 'badge', 'honor', 'name', 'welcome'] as const;
export type SvgaRole = (typeof SVGA_ROLES)[number];
/** 按图层名字猜它是什么（买来的 SVGA 常见写法：avatar / head / 头像、nickname / name、frame / kuang ……）；猜不出为 null */
export function guessSvgaRole(key: string): SvgaRole | null {
  const k = key.toLowerCase();
  if (/frame|kuang|border|头像框|txk/.test(k)) return 'frame';
  if (/avatar|head|touxiang|portrait|face|userpic|user_?img|头像|^tx\d*$/.test(k)) return 'avatar';
  if (/honou?r|wealth|glory|rongyao|荣耀/.test(k)) return 'honor';
  if (/badge|guard|anchor|medal|rank|身份|船锚|图标/.test(k)) return 'badge';
  if (/nick|name|uname|昵称|用户名/.test(k)) return 'name';
  if (/welcome|text|msg|message|desc|content|slogan|欢迎|文字|文案/.test(k)) return 'welcome';
  return null;
}
export function guessSvgaMap(slots: Array<{ key: string }>): Record<string, SvgaRole> {
  const out: Record<string, SvgaRole> = {};
  for (const s of slots) { const r = guessSvgaRole(s.key); if (r) out[s.key] = r; }
  return out;
}

export const EffectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(40),
  builtin: z.boolean(),
  visual: z.discriminatedUnion('type', [
    z.object({ type: z.literal('builtin_style'), style: z.string().min(1) }),
    z.object({ type: z.literal('asset'), assetId: z.number().int().positive() }),
  ]),
  /** 是否在画面上叠加头像和欢迎语（上传的素材默认不叠加） */
  showText: z.boolean(),
  texts: EffectTextsSchema,
  soundAssetId: z.number().int().positive().nullable(),
  volume: z.number().int().min(0).max(100),
  position: z.enum(POSITIONS),
  durationMs: z.number().int().min(500).max(30_000),
  /** 有时长的素材（视频、SVGA、Lottie、动图）：手动设置时长（最长到素材本身的长度）；关着时按素材时长完整播放 */
  durationCustom: z.boolean(),
  /** 上传的素材：开头淡入 / 结尾淡出（内置样式有自己的动画，不用这两项） */
  fadeIn: z.boolean(),
  fadeOut: z.boolean(),
  /** 渐入、渐出各用多久（毫秒） */
  fadeInMs: z.number().int().min(FADE_MIN_MS).max(FADE_MAX_MS),
  fadeOutMs: z.number().int().min(FADE_MIN_MS).max(FADE_MAX_MS),
  /** 上传的素材：在「位置」的基础上左右、上下挪动（画面宽、高的百分比，正数往右、往下） */
  offsetX: z.number().min(-OFFSET_MAX).max(OFFSET_MAX),
  offsetY: z.number().min(-OFFSET_MAX).max(OFFSET_MAX),
  /** 上传的素材：大小（自动大小的百分比，100 = 不变） */
  sizePct: z.number().int().min(SIZE_MIN).max(SIZE_MAX),
  /** 上传的素材：上下边缘羽化（跟随全局时只对没有透明通道的素材生效） */
  feather: z.enum(FEATHER_MODES),
  /** 自己设置时的羽化宽度（素材高度的百分比） */
  featherPct: z.number().int().min(0).max(FEATHER_MAX),
  /** 上传的素材：大航海观众的头像套上 B 站的头像框（头像和欢迎语里） */
  guardFrame: z.boolean(),
  /** 观众名字旁边显示 B 站的荣耀等级勋章（内置样式，或者叠加的头像和欢迎语里） */
  honorBadge: z.boolean(),
  /** SVGA：图层名 → 播放时换成什么（没列出的图层不替换） */
  svgaMap: z.record(z.string().min(1).max(120), z.enum(SVGA_ROLES)).refine((m) => Object.keys(m).length <= 60, { message: '图层太多' }),
});
export type Effect = z.infer<typeof EffectSchema>;

// ---------- 进场规则 ----------

const cooldownMin = z.number().int().min(0).max(1440);

export const TierRuleSchema = z.object({
  effectId: z.number().int().positive().nullable(),
  cooldownMin,
  enabled: z.boolean(),
});
export type TierRule = z.infer<typeof TierRuleSchema>;


/** 粉丝牌分档：只存起始等级，区间由相邻两档推出，所以不会重叠 */
/** 粉丝牌等级上限（B 站现在最高 120 级）：进场分段、弹幕「谁发的才算」、模拟都用这个 */
export const MEDAL_LEVEL_MAX = 120;
/** 荣耀等级上限（B 站目前到 80 级） */
export const HONOR_LEVEL_MAX = 80;
export const MedalBandSchema = z.object({
  fromLevel: z.number().int().min(1).max(MEDAL_LEVEL_MAX),
  effectId: z.number().int().positive().nullable(),
  cooldownMin,
  enabled: z.boolean(),
});
export type MedalBand = z.infer<typeof MedalBandSchema>;

/** 进场荣耀等级分档：和粉丝牌一样只存起始等级；低于最低一档的人不算（按其他观众处理） */
export const HonorBandSchema = z.object({
  fromLevel: z.number().int().min(1).max(HONOR_LEVEL_MAX),
  effectId: z.number().int().positive().nullable(),
  cooldownMin,
  enabled: z.boolean(),
});
export type HonorBand = z.infer<typeof HonorBandSchema>;
/** 新装的和升级上来的默认分档（都先关着、没选特效） */
export const HONOR_BANDS_DEFAULT: readonly HonorBand[] = [
  { fromLevel: 50, effectId: null, cooldownMin: 10, enabled: false },
  { fromLevel: 40, effectId: null, cooldownMin: 10, enabled: false },
  { fromLevel: 30, effectId: null, cooldownMin: 10, enabled: false },
];

export const ExclusiveSchema = z.object({
  uid: z.number().int().positive(),
  effectId: z.number().int().positive(),
  cooldownMin,
  /** 有效期截止日（含当天），格式 YYYY-MM-DD；不填为长期 */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  enabled: z.boolean(),
});
export type Exclusive = z.infer<typeof ExclusiveSchema>;

export const EnterRulesSchema = z
  .object({
    tiers: z.object({ gov: TierRuleSchema, adm: TierRuleSchema, cap: TierRuleSchema, mod: TierRuleSchema, nor: TierRuleSchema }),
    bands: z.array(MedalBandSchema).min(1).max(20),
    /** 荣耀等级分档（排在粉丝牌后面、其他观众前面）；可以一档都没有 */
    honorBands: z.array(HonorBandSchema).max(20),
    exclusives: z.array(ExclusiveSchema).max(2000),
    /** 冷却方式：按分钟，或每场直播每人只播一次 */
    cooldownMode: z.enum(['minutes', 'oncePerLive']),
  })
  .superRefine((r, ctx) => {
    const levels = r.bands.map((b) => b.fromLevel);
    if (new Set(levels).size !== levels.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: '粉丝牌分档的起始等级不能重复' });
    const honors = r.honorBands.map((b) => b.fromLevel);
    if (new Set(honors).size !== honors.length) ctx.addIssue({ code: 'custom', path: ['honorBands'], message: '荣耀等级分档的起始等级不能重复' });
    const uids = r.exclusives.map((x) => x.uid);
    if (new Set(uids).size !== uids.length) ctx.addIssue({ code: 'custom', path: ['exclusives'], message: '同一个 UID 只能设一条专属规则' });
  });
export type EnterRules = z.infer<typeof EnterRulesSchema>;

// ---------- 弹幕规则（需求 F-DM-01 ~ 04） ----------

/** 以前的发送人条件（单选）：导入旧版本的配置文件、升级旧数据时换成下面的多选 */
export const DANMU_WHO_OLD = ['all', 'fan', 'fan10', 'guard', 'mod'] as const;

/** 一条规则最多指定多少位观众 */
export const DANMU_UIDS_MAX = 100;

/**
 * 发送人条件（多选，满足任意一项就算）：所有人、主播、房管、总督 / 提督 / 舰长、戴本房间粉丝牌且不低于某级、荣耀等级不低于某级、指定观众。
 * 点了名的（勾了主播、填了 UID）不受「主播本人不触发」「登录的账号不触发」限制；手动拉黑的照样不触发。
 */
export const DanmuWhoSchema = z
  .object({
    all: z.boolean(),
    anchor: z.boolean(),
    mod: z.boolean(),
    guards: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3),
    /** 戴本房间粉丝牌、不低于这个等级；null 为不按粉丝牌 */
    fanMin: z.number().int().min(1).max(MEDAL_LEVEL_MAX).nullable(),
    /** 荣耀等级不低于这个等级；null 为不按荣耀等级（旧配置没有这一项） */
    honorMin: z.number().int().min(1).max(HONOR_LEVEL_MAX).nullable().default(null),
    uids: z.array(z.number().int().positive()).max(DANMU_UIDS_MAX),
  })
  .strict()
  .refine((w) => w.all || w.anchor || w.mod || w.guards.length > 0 || w.fanMin !== null || w.honorMin !== null || w.uids.length > 0, { message: '至少选一种人' });
export type DanmuWho = z.infer<typeof DanmuWhoSchema>;

export const DANMU_WHO_ALL: DanmuWho = { all: true, anchor: false, mod: false, guards: [], fanMin: null, honorMin: null, uids: [] };

/** 以前的单选换成多选（「戴本房间粉丝牌」以前也算上大航海和房管） */
export function danmuWhoFromOld(w: (typeof DANMU_WHO_OLD)[number]): DanmuWho {
  const none = { ...DANMU_WHO_ALL, all: false };
  switch (w) {
    case 'all':
      return DANMU_WHO_ALL;
    case 'fan':
      return { ...none, mod: true, guards: [1, 2, 3], fanMin: 1 };
    case 'fan10':
      return { ...none, fanMin: 10 };
    case 'guard':
      return { ...none, guards: [1, 2, 3] };
    case 'mod':
      return { ...none, mod: true };
  }
}

export const DanmuRuleSchema = z.object({
  id: z.number().int().positive(),
  keywords: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
  /** 包含 / 完全一致 */
  mode: z.enum(['contains', 'exact']),
  who: DanmuWhoSchema,
  effectId: z.number().int().positive().nullable(),
  /** 全局冷却（秒）：这条规则播放后，任何人再触发都要等 */
  globalCdSec: z.number().int().min(0).max(3600),
  /** 每人冷却（分钟） */
  userCdMin: z.number().int().min(0).max(1440),
  enabled: z.boolean(),
});
export type DanmuRule = z.infer<typeof DanmuRuleSchema>;

// ---------- 礼物规则（需求 F-GF-01 ~ 05） ----------

export const GiftSpecificSchema = z.object({
  giftId: z.number().int().positive(),
  giftName: z.string().max(40),
  effectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GiftSpecific = z.infer<typeof GiftSpecificSchema>;

/** 按单次价值分档：只存起始价值（金瓜子），区间由相邻两档推出 */
export const GiftBandSchema = z.object({
  fromGold: z.number().int().min(1).max(100_000_000),
  effectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GiftBand = z.infer<typeof GiftBandSchema>;

export const GiftRulesSchema = z
  .object({
    specific: z.array(GiftSpecificSchema).max(200),
    bands: z.array(GiftBandSchema).min(1).max(20),
    /** 连击合并：同一人在 comboSec 秒内连续送同一种礼物，合并为一次 */
    comboEnabled: z.boolean(),
    comboSec: z.number().int().min(1).max(15),
  })
  .superRefine((r, ctx) => {
    const ids = r.specific.map((x) => x.giftId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['specific'], message: '同一种礼物只能设一条规则' });
    const golds = r.bands.map((b) => b.fromGold);
    if (new Set(golds).size !== golds.length) ctx.addIssue({ code: 'custom', path: ['bands'], message: '礼物分档的起始价值不能重复' });
  });
export type GiftRules = z.infer<typeof GiftRulesSchema>;

// ---------- 上舰规则（需求 F-GD-01 ~ 02） ----------

export const GuardRuleSchema = z.object({
  openEffectId: z.number().int().positive().nullable(),
  renewEffectId: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type GuardRule = z.infer<typeof GuardRuleSchema>;

export const GuardRulesSchema = z.object({ gov: GuardRuleSchema, adm: GuardRuleSchema, cap: GuardRuleSchema });
export type GuardRules = z.infer<typeof GuardRulesSchema>;


// ---------- 素材快捷播放 ----------

/** 最多多少个按钮 */
export const QUICK_MAX = 40;
/** 后台页面里的快捷键：单个数字或字母（不带 Ctrl 等，小键盘数字也算） */
export const QUICK_KEY_RE = /^[0-9A-Z]$/;
/** 电脑版的全局快捷键（在游戏、直播软件里也能按）：至少一个 Ctrl / Alt / Shift 加数字、字母或 F1–F12，例如 Ctrl+Alt+1 */
export const QUICK_GLOBAL_RE = /^(?:(?:Ctrl|Alt|Shift)\+){1,3}(?:[0-9A-Z]|F[1-9]|F1[0-2])$/;

export const QuickButtonSchema = z.object({
  id: z.number().int().positive(),
  effectId: z.number().int().positive(),
  /** 按钮上显示的名字；空的时候显示素材名 */
  label: z.string().trim().max(20),
  hotkey: z.string().regex(QUICK_KEY_RE, '快捷键只能是一个数字或字母').nullable(),
  globalHotkey: z.string().regex(QUICK_GLOBAL_RE, '全局快捷键要带 Ctrl、Alt 或 Shift，例如 Ctrl+Alt+1').nullable(),
});
export type QuickButton = z.infer<typeof QuickButtonSchema>;

/** 保存整个按钮列表（按顺序）：快捷键不能重复 */
export const QuickButtonsInputSchema = z
  .array(QuickButtonSchema.omit({ id: true }))
  .max(QUICK_MAX)
  .superRefine((list, ctx) => {
    const dup = (xs: Array<string | null>) => {
      const seen = new Set<string>();
      return xs.findIndex((x) => x !== null && (seen.has(x) || !seen.add(x)));
    };
    const k = dup(list.map((b) => b.hotkey));
    if (k >= 0) ctx.addIssue({ code: 'custom', path: [k, 'hotkey'], message: `快捷键 ${list[k]!.hotkey} 被两个按钮用了` });
    const g = dup(list.map((b) => b.globalHotkey));
    if (g >= 0) ctx.addIssue({ code: 'custom', path: [g, 'globalHotkey'], message: `全局快捷键 ${list[g]!.globalHotkey} 被两个按钮用了` });
    list.forEach((b, i) => {
      const mods = b.globalHotkey?.split('+').slice(0, -1) ?? [];
      if (new Set(mods).size !== mods.length) ctx.addIssue({ code: 'custom', path: [i, 'globalHotkey'], message: '全局快捷键里有重复的按键' });
    });
  });
export type QuickButtonsInput = z.infer<typeof QuickButtonsInputSchema>;
