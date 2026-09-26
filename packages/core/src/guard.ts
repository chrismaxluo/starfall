// 上舰匹配（需求 F-GD-01 ~ 02）：按等级 + 开通 / 续费选素材。
import type { GuardEvent, GuardRules } from '@starfall/shared';

export const GUARD_KEY = { 1: 'gov', 2: 'adm', 3: 'cap' } as const;
export const GUARD_LABEL = { 1: '总督', 2: '提督', 3: '舰长' } as const;

export interface GuardMatch {
  effectId: number;
  label: string;
}

export function matchGuard(ev: Pick<GuardEvent, 'level' | 'op'>, rules: GuardRules): GuardMatch | null {
  const r = rules[GUARD_KEY[ev.level]];
  const effectId = ev.op === 'renew' ? r.renewEffectId : r.openEffectId;
  if (!r.enabled || effectId === null) return null;
  return { effectId, label: `上舰 · ${ev.op === 'renew' ? '续费' : '开通'}${GUARD_LABEL[ev.level]}` };
}
