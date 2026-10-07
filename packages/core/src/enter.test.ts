import { describe, expect, it } from 'vitest';
import { EnterRulesSchema } from '@starfall/shared';
import { bandLabel, enterRuleKey, matchEnter, sortedBands } from './enter.ts';
import { ANCHOR, defaultRules, medal, viewer } from './testing.ts';

const ctx = (rules = defaultRules(), today = '2026-09-25') => ({ rules, anchorUid: ANCHOR, today });

describe('进场匹配顺序（F-EN-01）', () => {
  it('总督 / 提督 / 舰长各自命中对应档位', () => {
    expect(matchEnter(viewer({ guard: 1 }), ctx())?.label).toBe('进场 · 总督');
    expect(matchEnter(viewer({ guard: 2 }), ctx())?.label).toBe('进场 · 提督');
    expect(matchEnter(viewer({ guard: 3 }), ctx())?.label).toBe('进场 · 舰长');
  });

  it('大航海优先于房管和粉丝牌', () => {
    const m = matchEnter(viewer({ guard: 2, isMod: true, medal: medal(39) }), ctx());
    expect(m?.rule).toEqual({ kind: 'tier', tier: 'adm' });
  });

  it('房管优先于粉丝牌', () => {
    expect(matchEnter(viewer({ isMod: true, medal: medal(30) }), ctx())?.rule).toEqual({ kind: 'tier', tier: 'mod' });
  });

  it('专属用户最先匹配，哪怕 TA 是总督', () => {
    const rules = defaultRules({ exclusives: [{ uid: 1001, effectId: 7, cooldownMin: 10, until: null, enabled: true }] });
    const m = matchEnter(viewer({ guard: 1 }), ctx(rules));
    expect(m).toMatchObject({ rule: { kind: 'exclusive', uid: 1001 }, effectId: 7, label: '进场 · 专属' });
  });

  it('普通观众默认关闭，不命中（F-EN-05）', () => {
    expect(matchEnter(viewer(), ctx())).toBeNull();
  });

  it('普通观众开启后命中', () => {
    const r = defaultRules();
    r.tiers.nor.enabled = true;
    expect(matchEnter(viewer(), ctx(r))?.rule).toEqual({ kind: 'tier', tier: 'nor' });
  });
});

describe('只计算本直播间（F-EN-03）', () => {
  it('别的直播间的粉丝牌按普通观众处理', () => {
    const r = defaultRules();
    r.tiers.nor.enabled = true;
    expect(matchEnter(viewer({ medal: medal(40, 999) }), ctx(r))?.rule).toEqual({ kind: 'tier', tier: 'nor' });
  });
});

describe('粉丝牌分档（F-EN-04）', () => {
  const rules = defaultRules({
    bands: [
      { fromLevel: 1, effectId: 11, cooldownMin: 15, enabled: true },
      { fromLevel: 31, effectId: 13, cooldownMin: 10, enabled: true },
      { fromLevel: 21, effectId: 12, cooldownMin: 10, enabled: true },
    ],
  });

  it('按等级落进唯一的一档，与输入顺序无关', () => {
    expect(matchEnter(viewer({ medal: medal(1) }), ctx(rules))?.effectId).toBe(11);
    expect(matchEnter(viewer({ medal: medal(20) }), ctx(rules))?.effectId).toBe(11);
    expect(matchEnter(viewer({ medal: medal(21) }), ctx(rules))?.effectId).toBe(12);
    expect(matchEnter(viewer({ medal: medal(30) }), ctx(rules))?.effectId).toBe(12);
    expect(matchEnter(viewer({ medal: medal(31) }), ctx(rules))?.effectId).toBe(13);
    expect(matchEnter(viewer({ medal: medal(60) }), ctx(rules))?.effectId).toBe(13);
  });

  it('区间由相邻两档推出，标签正确', () => {
    const b = sortedBands(rules.bands);
    expect(b.map((x) => bandLabel(x.fromLevel, x.toLevel))).toEqual(['31 级及以上', '21 – 30 级', '1 – 20 级']);
    expect(matchEnter(viewer({ medal: medal(25) }), ctx(rules))?.label).toBe('进场 · 粉丝牌 21 – 30 级');
  });

  it('等级低于最低一档时不命中分档', () => {
    const r = defaultRules({ bands: [{ fromLevel: 10, effectId: 5, cooldownMin: 10, enabled: true }] });
    expect(matchEnter(viewer({ medal: medal(9) }), ctx(r))).toBeNull();
  });

  it('所在档停用时不会落到更低的档，而是继续匹配普通观众', () => {
    const r = defaultRules();
    r.bands[0]!.enabled = false; // 21 级及以上停用
    expect(matchEnter(viewer({ medal: medal(25) }), ctx(r))).toBeNull();
    r.tiers.nor.enabled = true;
    expect(matchEnter(viewer({ medal: medal(25) }), ctx(r))?.rule).toEqual({ kind: 'tier', tier: 'nor' });
  });

  it('起始等级重复时校验不通过', () => {
    const r = defaultRules({
      bands: [
        { fromLevel: 21, effectId: 5, cooldownMin: 10, enabled: true },
        { fromLevel: 21, effectId: 6, cooldownMin: 10, enabled: true },
      ],
    });
    expect(EnterRulesSchema.safeParse(r).success).toBe(false);
  });
});

describe('停用的档位视为不存在', () => {
  it('停用舰长档后，舰长按粉丝牌处理', () => {
    const r = defaultRules();
    r.tiers.cap.enabled = false;
    expect(matchEnter(viewer({ guard: 3, medal: medal(27) }), ctx(r))?.rule).toMatchObject({ kind: 'band', fromLevel: 21 });
  });

  it('档位没有选素材时也视为不命中', () => {
    const r = defaultRules();
    r.tiers.gov.effectId = null;
    r.tiers.nor.enabled = true;
    expect(matchEnter(viewer({ guard: 1 }), ctx(r))?.rule).toEqual({ kind: 'tier', tier: 'nor' });
  });
});

describe('专属用户（F-EN-06 ~ 07）', () => {
  const ex = (p: object) => defaultRules({ exclusives: [{ uid: 1001, effectId: 7, cooldownMin: 10, until: null, enabled: true, ...p }] });

  it('有效期当天仍然有效，第二天失效并回到身份档位', () => {
    const r = ex({ until: '2026-09-25' });
    expect(matchEnter(viewer({ guard: 3 }), ctx(r, '2026-09-25'))?.rule.kind).toBe('exclusive');
    expect(matchEnter(viewer({ guard: 3 }), ctx(r, '2026-09-26'))?.rule).toEqual({ kind: 'tier', tier: 'cap' });
  });

  it('停用后回到身份档位', () => {
    expect(matchEnter(viewer({ guard: 3 }), ctx(ex({ enabled: false })))?.rule).toEqual({ kind: 'tier', tier: 'cap' });
  });

  it('同一 UID 只能有一条（校验）', () => {
    const r = defaultRules({
      exclusives: [
        { uid: 1001, effectId: 7, cooldownMin: 10, until: null, enabled: true },
        { uid: 1001, effectId: 8, cooldownMin: 10, until: null, enabled: true },
      ],
    });
    expect(EnterRulesSchema.safeParse(r).success).toBe(false);
  });
});

describe('荣耀等级分档', () => {
  it('按荣耀等级落进唯一的一档，标签正确', () => {
    expect(matchEnter(viewer({ honor: 30 }), ctx())?.effectId).toBe(21);
    expect(matchEnter(viewer({ honor: 39 }), ctx())?.effectId).toBe(21);
    expect(matchEnter(viewer({ honor: 45 }), ctx())?.label).toBe('进场 · 荣耀等级 40 – 49 级');
    expect(matchEnter(viewer({ honor: 72 }), ctx())?.rule).toEqual({ kind: 'honor', fromLevel: 50, toLevel: null });
  });

  it('低于最低一档、没有荣耀等级时按其他观众处理', () => {
    expect(matchEnter(viewer({ honor: 29 }), ctx())).toBeNull();
    expect(matchEnter(viewer(), ctx())).toBeNull();
    const r = defaultRules();
    r.tiers.nor.enabled = true;
    expect(matchEnter(viewer({ honor: 29 }), ctx(r))?.rule).toEqual({ kind: 'tier', tier: 'nor' });
  });

  it('排在粉丝牌后面：戴本房间粉丝牌的按粉丝牌，大航海、房管也优先', () => {
    expect(matchEnter(viewer({ honor: 60, medal: medal(5) }), ctx())?.effectId).toBe(5);
    expect(matchEnter(viewer({ honor: 60, guard: 3 }), ctx())?.effectId).toBe(3);
    expect(matchEnter(viewer({ honor: 60, isMod: true }), ctx())?.effectId).toBe(4);
    // 别的直播间的牌子不算，按荣耀等级
    expect(matchEnter(viewer({ honor: 60, medal: medal(25, 999) }), ctx())?.effectId).toBe(23);
  });

  it('粉丝牌那一档关着时，接着按荣耀等级', () => {
    const r = defaultRules();
    r.bands[0]!.enabled = false;
    expect(matchEnter(viewer({ honor: 42, medal: medal(25) }), ctx(r))?.effectId).toBe(22);
  });

  it('所在档关着或没选特效时不落到更低的档', () => {
    const r = defaultRules();
    r.honorBands[1]!.enabled = false; // 40 – 49 级
    expect(matchEnter(viewer({ honor: 45 }), ctx(r))).toBeNull();
    r.honorBands[0]!.effectId = null; // 50 级及以上
    expect(matchEnter(viewer({ honor: 55 }), ctx(r))).toBeNull();
  });

  it('一档都没有时也能用；起始等级重复时校验不通过', () => {
    expect(matchEnter(viewer({ honor: 60 }), ctx(defaultRules({ honorBands: [] })))).toBeNull();
    expect(EnterRulesSchema.safeParse(defaultRules({ honorBands: [] })).success).toBe(true);
    const dup = defaultRules({ honorBands: [{ fromLevel: 30, effectId: 1, cooldownMin: 0, enabled: true }, { fromLevel: 30, effectId: 2, cooldownMin: 0, enabled: true }] });
    expect(EnterRulesSchema.safeParse(dup).success).toBe(false);
  });
});

describe('冷却键', () => {
  it('同一条规则共用一个键', () => {
    expect(enterRuleKey({ kind: 'tier', tier: 'cap' })).toBe('enter:tier:cap');
    expect(enterRuleKey({ kind: 'band', fromLevel: 21, toLevel: 30 })).toBe('enter:band:21');
    expect(enterRuleKey({ kind: 'exclusive', uid: 5 })).toBe('enter:exclusive:5');
    expect(enterRuleKey({ kind: 'honor', fromLevel: 40, toLevel: 49 })).toBe('enter:honor:40');
  });
});
