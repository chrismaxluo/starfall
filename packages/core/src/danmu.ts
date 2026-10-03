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

/** 英文不分大小写、全角半角字母数字当成一样（观众发「ＡＷＳＬ」「awsl」都算） */
export function normText(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

export function keywordHit(rule: Pick<DanmuRule, 'keywords' | 'mode'>, text: string): boolean {
  const t = normText(text.trim());
  return rule.keywords.some((k) => {
    const kk = normText(k.trim());
    return kk !== '' && (rule.mode === 'exact' ? t === kk : t.includes(kk));
  });
}

/**
 * 被前面的规则抢先、永远轮不到的关键词：前面有一条打开的「包含」规则，它的某个词就在这个词里面
 * （弹幕里有「晚安啦」就一定有「晚安」）。只看关键词，不管"谁发的才算"。
 * 返回 { 规则序号（从 0 起）: [{ word, by: 抢先的规则序号, byWord }] }
 */
export function shadowedKeywords(rules: ReadonlyArray<Pick<DanmuRule, 'keywords' | 'mode' | 'enabled'>>): Record<number, Array<{ word: string; by: number; byWord: string }>> {
  const out: Record<number, Array<{ word: string; by: number; byWord: string }>> = {};
  rules.forEach((r, i) => {
    for (const word of r.keywords) {
      const w = normText(word.trim());
      for (let j = 0; j < i; j++) {
        const p = rules[j]!;
        if (!p.enabled) continue;
        const byWord = p.keywords.find((k) => {
          const kk = normText(k.trim());
          return kk !== '' && (p.mode === 'exact' ? r.mode === 'exact' && kk === w : w.includes(kk));
        });
        if (byWord !== undefined) {
          (out[i] ??= []).push({ word, by: j, byWord });
          break;
        }
      }
    }
  });
  return out;
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
