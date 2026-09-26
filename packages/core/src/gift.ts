// 礼物匹配（需求 F-GF-01 ~ 04）：免费礼物不触发 → 指定礼物 → 按单次价值分档（高档优先，低于最低档不播）。
import { GOLD_PER_YUAN } from '@starfall/shared';
import type { GiftBand, GiftEvent, GiftRules } from '@starfall/shared';

export interface GiftMatch {
  effectId: number;
  /** 冷却 / 统计用的规则键 */
  key: string;
  label: string;
  /** 单次价值（金瓜子） */
  valueGold: number;
}

export const giftValue = (ev: Pick<GiftEvent, 'unitPrice' | 'count'>) => ev.unitPrice * ev.count;

export function yuanText(gold: number): string {
  const y = gold / GOLD_PER_YUAN;
  return `${y >= 100 ? Math.round(y) : Math.round(y * 10) / 10} 元`;
}

/** 分档从高到低排列，算出每档的上限（最高一档为 null） */
export function sortedGiftBands(bands: readonly GiftBand[]): Array<GiftBand & { toGold: number | null }> {
  const s = [...bands].sort((a, b) => b.fromGold - a.fromGold);
  return s.map((b, i) => ({ ...b, toGold: i === 0 ? null : s[i - 1]!.fromGold }));
}

export function giftBandLabel(fromGold: number, toGold: number | null): string {
  return toGold === null ? `≥ ${yuanText(fromGold)}` : `${yuanText(fromGold).replace(' 元', '')} – ${yuanText(toGold)}`;
}

export function matchGift(ev: Pick<GiftEvent, 'giftId' | 'giftName' | 'unitPrice' | 'count' | 'paid'>, rules: GiftRules): GiftMatch | null {
  if (!ev.paid) return null;
  const valueGold = giftValue(ev);
  const spec = rules.specific.find((s) => s.giftId === ev.giftId);
  if (spec && spec.enabled && spec.effectId !== null) {
    return { effectId: spec.effectId, key: `gift:spec:${spec.giftId}`, label: `礼物 · 「${spec.giftName || ev.giftName}」`, valueGold };
  }
  // 按价值落在唯一的一档；这一档停用就不播（不会落到更低的档）
  const band = sortedGiftBands(rules.bands).find((b) => valueGold >= b.fromGold);
  if (!band || !band.enabled || band.effectId === null) return null;
  return { effectId: band.effectId, key: `gift:band:${band.fromGold}`, label: `礼物 · 单次 ${giftBandLabel(band.fromGold, band.toGold)}`, valueGold };
}
