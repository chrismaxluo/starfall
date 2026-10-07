// 素材（需求 F-AS-01 ~ 15）：内置素材只读；被规则使用时不能删除；复制时可以把原来用它的地方换成副本。
import path from 'node:path';
import { eq, inArray, like } from 'drizzle-orm';
import { bandLabel, danmuLabel, giftBandLabel, sortedBands, sortedGiftBands } from '@starfall/core';
import { EffectSchema, TIER_NAMES, guessSvgaMap } from '@starfall/shared';
import type { Effect, SvgaRole } from '@starfall/shared';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import { effects, quickPlay, ruleDanmu, ruleEnterBands, ruleEnterTiers, ruleExclusive, ruleGiftBands, ruleGiftSpecific, ruleGuard, viewers } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { assetDto } from './assets.ts';
import type { AssetDto, AssetRow, AssetStore } from './assets.ts';

type EffectRow = typeof effects.$inferSelect;

export interface EffectUse {
  /** 规则所在页面，界面据此跳转 */
  page: 'enter' | 'danmu' | 'gift' | 'guard';
  label: string;
}

export interface EffectDto extends Effect {
  asset: AssetDto | null;
  sound: AssetDto | null;
  usedBy: EffectUse[];
  createdAt: number;
  updatedAt: number;
}

export const EffectPatchSchema = EffectSchema.pick({ name: true, showText: true, texts: true, soundAssetId: true, volume: true, position: true, durationMs: true, durationCustom: true, fadeIn: true, fadeOut: true, fadeInMs: true, fadeOutMs: true, offsetX: true, offsetY: true, sizePct: true, feather: true, featherPct: true, guardFrame: true, honorBadge: true, svgaMap: true })
  .partial()
  .strict();
export type EffectPatch = z.infer<typeof EffectPatchSchema>;

const clampDuration = (ms: number | null, fallback: number) => (ms ? Math.min(30_000, Math.max(500, ms)) : fallback);

/**
 * 实际播放时长：有时长的素材（视频、SVGA、Lottie、动图）默认按素材本身的时长完整播放，不受 30 秒上限限制；
 * 手动设置时用设置的时长，但不超过素材本身；静态图片和内置样式用设置的时长
 */
export function playDuration(assetMs: number | null | undefined, custom: boolean, durationMs: number): number {
  if (!assetMs) return durationMs;
  return custom ? Math.min(durationMs, assetMs) : assetMs;
}

/** 换了 SVGA 文件：新文件里还有的图层保留原来的设置，其他的按名字猜 */
function remapSvga(old: Record<string, SvgaRole>, slots: Array<{ key: string }>): Record<string, SvgaRole> {
  const out = guessSvgaMap(slots);
  for (const s of slots) if (old[s.key]) out[s.key] = old[s.key]!;
  return out;
}

export class EffectStore {
  private readonly db: Db;
  private readonly assets: AssetStore;
  private readonly listeners = new Set<(id: number) => void>();

  constructor(db: Db, assets: AssetStore) {
    this.db = db;
    this.assets = assets;
  }

  /** 素材修改后通知（特效页据此更新预加载） */
  onChange(fn: (id: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(id: number): void {
    for (const fn of this.listeners) fn(id);
  }

  row(id: number): EffectRow {
    const r = this.db.select().from(effects).where(eq(effects.id, id)).get();
    if (!r) throw new HttpError(404, 'not_found', '素材不存在');
    return r;
  }

  exists(id: number): boolean {
    return Boolean(this.db.select({ id: effects.id }).from(effects).where(eq(effects.id, id)).get());
  }

  list(): EffectDto[] {
    const uses = this.allUses();
    const files = new Map(this.assets.list().map((a) => [a.id, a]));
    return this.db
      .select()
      .from(effects)
      .orderBy(effects.id)
      .all()
      .map((r) => this.dto(r, files, uses.get(r.id) ?? []));
  }

  /** uses: false 时不统计"被哪些规则使用"（播放判断每个事件都要查一次，用不到这一项） */
  get(id: number, opts: { uses?: boolean } = {}): EffectDto {
    const r = this.row(id);
    const files = new Map<number, AssetRow>();
    for (const aid of [r.assetId, r.soundAssetId]) {
      const a = aid === null ? undefined : this.assets.get(aid);
      if (a) files.set(a.id, a);
    }
    return this.dto(r, files, opts.uses === false ? [] : (this.allUses().get(id) ?? []));
  }

  private dto(r: EffectRow, files: Map<number, AssetRow>, usedBy: EffectUse[]): EffectDto {
    const asset = r.assetId === null ? undefined : files.get(r.assetId);
    const sound = r.soundAssetId === null ? undefined : files.get(r.soundAssetId);
    return {
      id: r.id,
      name: r.name,
      builtin: r.builtin,
      visual: r.assetId !== null ? { type: 'asset', assetId: r.assetId } : { type: 'builtin_style', style: r.style ?? 'line' },
      showText: r.showText,
      texts: r.texts,
      soundAssetId: r.soundAssetId,
      volume: r.volume,
      position: r.position,
      durationMs: playDuration(asset?.durationMs, r.durationCustom, r.durationMs),
      durationCustom: r.durationCustom,
      fadeIn: r.fadeIn,
      fadeOut: r.fadeOut,
      fadeInMs: r.fadeInMs,
      fadeOutMs: r.fadeOutMs,
      offsetX: r.offsetX,
      offsetY: r.offsetY,
      sizePct: r.sizePct,
      feather: r.feather,
      featherPct: r.featherPct,
      guardFrame: r.guardFrame,
      honorBadge: r.honorBadge,
      svgaMap: r.svgaMap,
      asset: asset ? assetDto(asset) : null,
      sound: sound ? assetDto(sound) : null,
      usedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** 每个素材被哪些规则使用 */
  private allUses(): Map<number, EffectUse[]> {
    const out = new Map<number, EffectUse[]>();
    const add = (id: number | null, u: EffectUse) => {
      if (id === null) return;
      const list = out.get(id) ?? [];
      list.push(u);
      out.set(id, list);
    };
    for (const t of this.db.select().from(ruleEnterTiers).all()) add(t.effectId, { page: 'enter', label: `进场 · ${TIER_NAMES[t.tier]}` });
    for (const b of sortedBands(this.db.select().from(ruleEnterBands).all())) add(b.effectId, { page: 'enter', label: `进场 · 粉丝牌 ${bandLabel(b.fromLevel, b.toLevel)}` });
    // 只查专属用户的昵称（观众表会越来越大，不能每次整张读出来）
    const exclusives = this.db.select().from(ruleExclusive).all();
    const uids = exclusives.map((x) => x.uid);
    const names = new Map(uids.length ? this.db.select({ uid: viewers.uid, name: viewers.name }).from(viewers).where(inArray(viewers.uid, uids)).all().map((v) => [v.uid, v.name]) : []);
    for (const x of exclusives) add(x.effectId, { page: 'enter', label: `进场 · 专属 ${names.get(x.uid) ?? `UID ${x.uid}`}` });
    for (const r of this.db.select().from(ruleDanmu).orderBy(ruleDanmu.sort).all()) add(r.effectId, { page: 'danmu', label: danmuLabel(r) });
    for (const g of this.db.select().from(ruleGiftSpecific).all()) add(g.effectId, { page: 'gift', label: `礼物 · 「${g.giftName || g.giftId}」` });
    for (const b of sortedGiftBands(this.db.select().from(ruleGiftBands).all())) add(b.effectId, { page: 'gift', label: `礼物 · 单次 ${giftBandLabel(b.fromGold, b.toGold)}` });
    const GUARD = { gov: '总督', adm: '提督', cap: '舰长' } as const;
    for (const g of this.db.select().from(ruleGuard).all()) {
      add(g.openEffectId, { page: 'guard', label: `上舰 · 开通${GUARD[g.tier]}` });
      add(g.renewEffectId, { page: 'guard', label: `上舰 · 续费${GUARD[g.tier]}` });
    }
    return out;
  }

  /** 生成不重复的名称：同名时加序号 */
  uniqueName(base: string): string {
    const b = base.trim().slice(0, 36) || '素材';
    const taken = new Set(this.db.select({ name: effects.name }).from(effects).where(like(effects.name, `${b}%`)).all().map((r) => r.name));
    if (!taken.has(b)) return b;
    for (let i = 2; ; i++) if (!taken.has(`${b} ${i}`)) return `${b} ${i}`;
  }

  private checkName(name: string, selfId?: number): void {
    const r = this.db.select({ id: effects.id }).from(effects).where(eq(effects.name, name)).get();
    if (r && r.id !== selfId) throw new HttpError(409, 'name_taken', `已经有叫"${name}"的素材了`);
  }

  private checkSound(id: number | null | undefined): void {
    if (id === null || id === undefined) return;
    const a = this.assets.get(id);
    if (!a || a.kind !== 'audio') throw new HttpError(400, 'invalid_sound', '所选的音效不存在');
  }

  /** 上传动画文件后自动生成素材：名称取文件名，居中，默认不叠加文字、不淡入淡出（F-AS-02、F-AS-08） */
  createFromAsset(a: AssetRow): EffectDto {
    const name = this.uniqueName(path.parse(a.filename).name);
    const r = this.db
      .insert(effects)
      .values({ name, assetId: a.id, showText: false, texts: { enter: ['{name} 来了'] }, position: 'center', durationMs: clampDuration(a.durationMs, 5000), fadeIn: false, fadeOut: false, svgaMap: guessSvgaMap(a.slots ?? []) })
      .returning()
      .get();
    return this.get(r.id);
  }

  update(id: number, patch: EffectPatch): EffectDto {
    const r = this.row(id);
    if (r.builtin) throw new HttpError(403, 'builtin_readonly', '内置素材不能修改，请先"复制并编辑"');
    if (patch.name !== undefined) this.checkName(patch.name, id);
    this.checkSound(patch.soundAssetId);
    this.db.update(effects).set({ ...patch, updatedAt: Date.now() }).where(eq(effects.id, id)).run();
    this.changed(id);
    return this.get(id);
  }

  /** 替换文件：所有用到这个素材的规则自动生效；旧文件没人用时删除（F-AS-07） */
  async replaceFile(id: number, stream: Readable, filename: string): Promise<EffectDto> {
    const r = this.row(id);
    if (r.builtin) {
      stream.resume();
      throw new HttpError(403, 'builtin_readonly', '内置素材不能修改，请先"复制并编辑"');
    }
    const { asset } = await this.assets.ingest(stream, filename, ['video', 'image', 'fx']);
    this.db
      .update(effects)
      .set({ assetId: asset.id, style: null, durationMs: clampDuration(asset.durationMs, r.durationMs), durationCustom: false, svgaMap: remapSvga(r.svgaMap, asset.slots ?? []), updatedAt: Date.now() })
      .where(eq(effects.id, id))
      .run();
    if (r.assetId !== asset.id) this.assets.removeIfUnused(r.assetId);
    this.changed(id);
    return this.get(id);
  }

  /** 复制素材；replaceRefs 为真时把原来用它的规则（和快捷播放按钮）都换成副本（F-AS-13） */
  copy(id: number, opts: { name?: string; replaceRefs?: boolean }): EffectDto {
    const src = this.row(id);
    const name = opts.name ?? this.uniqueName(`${src.name} 副本`);
    this.checkName(name);
    const newId = this.db.transaction((tx) => {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
      const n = tx.insert(effects).values({ ...rest, name, builtin: false }).returning({ id: effects.id }).get().id;
      if (opts.replaceRefs) {
        tx.update(ruleEnterTiers).set({ effectId: n }).where(eq(ruleEnterTiers.effectId, id)).run();
        tx.update(ruleEnterBands).set({ effectId: n }).where(eq(ruleEnterBands.effectId, id)).run();
        tx.update(ruleExclusive).set({ effectId: n }).where(eq(ruleExclusive.effectId, id)).run();
        tx.update(ruleDanmu).set({ effectId: n }).where(eq(ruleDanmu.effectId, id)).run();
        tx.update(ruleGiftSpecific).set({ effectId: n }).where(eq(ruleGiftSpecific.effectId, id)).run();
        tx.update(ruleGiftBands).set({ effectId: n }).where(eq(ruleGiftBands.effectId, id)).run();
        tx.update(ruleGuard).set({ openEffectId: n }).where(eq(ruleGuard.openEffectId, id)).run();
        tx.update(ruleGuard).set({ renewEffectId: n }).where(eq(ruleGuard.renewEffectId, id)).run();
        tx.update(quickPlay).set({ effectId: n }).where(eq(quickPlay.effectId, id)).run();
      }
      return n;
    });
    return this.get(newId);
  }

  /** 删除素材；被规则使用时返回 409 和使用位置；文件没有其他素材使用时一并删除（F-AS-14） */
  remove(id: number): void {
    const r = this.row(id);
    if (r.builtin) throw new HttpError(403, 'builtin_readonly', '内置素材不能删除');
    const usedBy = this.allUses().get(id) ?? [];
    if (usedBy.length) throw new HttpError(409, 'in_use', `这个素材正在被 ${usedBy.length} 条规则使用，请先在规则里换掉`, { usedBy });
    this.db.delete(effects).where(eq(effects.id, id)).run();
    this.assets.removeIfUnused(r.assetId);
    this.changed(id);
  }
}
