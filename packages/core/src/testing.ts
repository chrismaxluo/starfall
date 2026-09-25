// 测试用的辅助数据（不在正式代码中使用）
import type { EnterRules, Viewer } from '@starfall/shared';

export const ANCHOR = 375189050;

export function viewer(p: Partial<Viewer> = {}): Viewer {
  return { uid: 1001, name: '测试观众', guard: 0, isMod: false, mystery: false, ...p };
}

export function medal(level: number, anchorUid = ANCHOR) {
  return { name: '咕惑宰', level, anchorUid };
}

/** 与需求文档附录 B 的默认规则一致（素材编号：1 星冕 2 流星 3 流光 4 巡场 5 霜玻 6 一行字 7 专属） */
export function defaultRules(p: Partial<EnterRules> = {}): EnterRules {
  return {
    tiers: {
      gov: { effectId: 1, cooldownMin: 5, enabled: true },
      adm: { effectId: 2, cooldownMin: 5, enabled: true },
      cap: { effectId: 3, cooldownMin: 5, enabled: true },
      mod: { effectId: 4, cooldownMin: 10, enabled: true },
      nor: { effectId: 6, cooldownMin: 30, enabled: false },
    },
    bands: [
      { fromLevel: 21, effectId: 5, cooldownMin: 10, enabled: true },
      { fromLevel: 1, effectId: 5, cooldownMin: 15, enabled: true },
    ],
    exclusives: [],
    cooldownMode: 'minutes',
    ...p,
  };
}
