// 弹幕匹配（需求 F-DM-01 ~ 04）：从上到下，命中第一条即停。
import { isOwnMedal } from '@starfall/shared';
import type { DanmuRule, DanmuWho, Viewer } from '@starfall/shared';

export interface DanmuMatch {
  ruleId: number;
  effectId: number;
  globalCdSec: number;
  userCdMin: number;
  label: string;
}

/** 规则里点了这个人的名：勾了「主播」而 TA 是主播，或者 UID 在指定观众里 */
export function whoNamed(who: DanmuWho, v: Viewer, anchorUid: number): boolean {
  return (who.anchor && v.uid === anchorUid) || who.uids.includes(v.uid);
}

/** 发送人是否满足条件（多选，满足任意一项就算） */
export function whoOk(who: DanmuWho, v: Viewer, anchorUid: number): boolean {
  if (who.all || whoNamed(who, v, anchorUid)) return true;
  if (who.mod && v.isMod) return true;
  if (v.guard !== 0 && who.guards.includes(v.guard)) return true;
  if (who.honorMin != null && (v.honor ?? 0) >= who.honorMin) return true;
  return who.fanMin !== null && isOwnMedal(v, anchorUid) && v.medal!.level >= who.fanMin;
}

export function keywordHit(rule: Pick<DanmuRule, 'keywords' | 'mode'>, text: string): boolean {
  const t = text.trim();
  return rule.keywords.some((k) => k && (rule.mode === 'exact' ? t === k : t.includes(k)));
}

export function danmuLabel(rule: Pick<DanmuRule, 'keywords'>): string {
  return `弹幕 · 「${rule.keywords.slice(0, 3).join(' / ')}${rule.keywords.length > 3 ? ' …' : ''}」`;
}

/**
 * onlyNamed：发送人是主播本人或登录的账号（默认不触发），这时只看点了 TA 名的规则。
 */
export function matchDanmu(text: string, viewer: Viewer, rules: readonly DanmuRule[], anchorUid: number, onlyNamed = false): DanmuMatch | null {
  for (const r of rules) {
    if (!r.enabled || r.effectId === null || !keywordHit(r, text)) continue;
    if (onlyNamed ? !whoNamed(r.who, viewer, anchorUid) : !whoOk(r.who, viewer, anchorUid)) continue;
    return { ruleId: r.id, effectId: r.effectId, globalCdSec: r.globalCdSec, userCdMin: r.userCdMin, label: danmuLabel(r) };
  }
  return null;
}

/** 同一关键词出现在多条规则里：返回 { 关键词: [规则序号…] }（F-DM-04，界面提示"排在前面的优先"） */
export function keywordClashes(rules: readonly DanmuRule[]): Record<string, number[]> {
  const seen = new Map<string, number[]>();
  rules.forEach((r, i) => {
    for (const k of new Set(r.keywords)) seen.set(k, [...(seen.get(k) ?? []), i + 1]);
  });
  return Object.fromEntries([...seen].filter(([, v]) => v.length > 1));
}
