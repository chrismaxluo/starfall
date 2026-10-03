// 进场匹配（需求 F-EN-01 ~ 08）：
// 专属用户 → 总督 → 提督 → 舰长 → 房管 → 粉丝牌分档（等级从高到低）→ 普通观众，命中第一条即停止。
//
// 停用的规则：
// - 专属用户、身份档位停用时视为不存在，继续往下匹配（例如停用了舰长档，舰长会按粉丝牌或普通观众处理）。
// - 粉丝牌分档按等级落在唯一的一档里；这一档停用时，粉丝牌部分整体跳过，继续匹配普通观众，
//   不会落到更低的档（否则区间就不再是"这个等级放这个特效"了）。
import { isOwnMedal } from '@starfall/shared';
import type { EnterRules, Exclusive, MedalBand, Tier, Viewer } from '@starfall/shared';

export type EnterRuleRef =
  | { kind: 'exclusive'; uid: number }
  | { kind: 'tier'; tier: Tier }
  | { kind: 'band'; fromLevel: number; toLevel: number | null };

export interface EnterMatch {
  rule: EnterRuleRef;
  effectId: number;
  cooldownMin: number;
  /** 给人看的规则说明，写进事件记录，例如"进场 · 舰长" */
  label: string;
}

const GUARD_TIER = { 1: 'gov', 2: 'adm', 3: 'cap' } as const;
const TIER_LABEL: Record<Tier, string> = { gov: '总督', adm: '提督', cap: '舰长', mod: '房管', nor: '其他观众' };

/** 专属规则在 today（YYYY-MM-DD）是否有效 */
export function isExclusiveActive(x: Exclusive, today: string): boolean {
  return x.enabled && (x.until === null || x.until >= today);
}

/** 分档按起始等级从高到低排列，并算出每档的结束等级（最高一档为 null，表示"及以上"） */
export function sortedBands(bands: readonly MedalBand[]): Array<MedalBand & { toLevel: number | null }> {
  const sorted = [...bands].sort((a, b) => b.fromLevel - a.fromLevel);
  return sorted.map((b, i) => ({ ...b, toLevel: i === 0 ? null : sorted[i - 1]!.fromLevel - 1 }));
}

export function bandLabel(fromLevel: number, toLevel: number | null): string {
  if (toLevel === null) return `${fromLevel} 级及以上`;
  return fromLevel === toLevel ? `${fromLevel} 级` : `${fromLevel} – ${toLevel} 级`;
}

export interface EnterContext {
  rules: EnterRules;
  /** 主播 UID，用来判断粉丝牌是否属于本直播间 */
  anchorUid: number;
  /** 今天的日期 YYYY-MM-DD（按主播所在时区），用于专属规则的有效期 */
  today: string;
}

export function matchEnter(viewer: Viewer, ctx: EnterContext): EnterMatch | null {
  const { rules } = ctx;

  const ex = rules.exclusives.find((x) => x.uid === viewer.uid);
  if (ex && isExclusiveActive(ex, ctx.today)) {
    return { rule: { kind: 'exclusive', uid: ex.uid }, effectId: ex.effectId, cooldownMin: ex.cooldownMin, label: '进场 · 专属' };
  }

  const tierHit = (tier: Tier): EnterMatch | null => {
    const t = rules.tiers[tier];
    if (!t.enabled || t.effectId === null) return null;
    return { rule: { kind: 'tier', tier }, effectId: t.effectId, cooldownMin: t.cooldownMin, label: `进场 · ${TIER_LABEL[tier]}` };
  };

  if (viewer.guard !== 0) {
    const hit = tierHit(GUARD_TIER[viewer.guard]);
    if (hit) return hit;
  }
  if (viewer.isMod) {
    const hit = tierHit('mod');
    if (hit) return hit;
  }
  if (isOwnMedal(viewer, ctx.anchorUid)) {
    const level = viewer.medal!.level;
    const band = sortedBands(rules.bands).find((b) => level >= b.fromLevel);
    if (band && band.enabled && band.effectId !== null) {
      return {
        rule: { kind: 'band', fromLevel: band.fromLevel, toLevel: band.toLevel },
        effectId: band.effectId,
        cooldownMin: band.cooldownMin,
        label: `进场 · 粉丝牌 ${bandLabel(band.fromLevel, band.toLevel)}`,
      };
    }
  }
  return tierHit('nor');
}

/** 冷却使用的规则键：同一条规则、同一个人共享一个冷却 */
export function enterRuleKey(ref: EnterRuleRef): string {
  if (ref.kind === 'exclusive') return `enter:exclusive:${ref.uid}`;
  if (ref.kind === 'tier') return `enter:tier:${ref.tier}`;
  return `enter:band:${ref.fromLevel}`;
}
