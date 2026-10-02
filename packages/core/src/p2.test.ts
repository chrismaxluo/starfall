import { describe, expect, it } from 'vitest';
import { DANMU_WHO_ALL, danmuWhoFromOld } from '@starfall/shared';
import type { DanmuRule, DanmuWho, GiftEvent, GiftRules, GuardEvent, GuardRules } from '@starfall/shared';
import { GiftComboMerger, GuardDeduper } from './combo.ts';
import { keywordClashes, matchDanmu, shadowedKeywords, whoNamed, whoOk } from './danmu.ts';
import { giftBandLabel, matchGift, sortedGiftBands, yuanText } from './gift.ts';
import { matchGuard } from './guard.ts';
import { ANCHOR, medal, viewer } from './testing.ts';

const rule = (p: Partial<DanmuRule> = {}): DanmuRule => ({ id: 1, keywords: ['生日快乐'], mode: 'contains', who: DANMU_WHO_ALL, effectId: 7, globalCdSec: 30, userCdMin: 10, enabled: true, ...p });

describe('弹幕匹配', () => {
  it('包含 / 完全一致', () => {
    expect(matchDanmu('主播生日快乐！', viewer(), [rule()], ANCHOR)).toMatchObject({ ruleId: 1, effectId: 7, globalCdSec: 30, userCdMin: 10, label: '弹幕 · 「生日快乐」' });
    expect(matchDanmu('上船', viewer(), [rule({ keywords: ['上船'], mode: 'exact' })], ANCHOR)).not.toBeNull();
    expect(matchDanmu(' 上船 ', viewer(), [rule({ keywords: ['上船'], mode: 'exact' })], ANCHOR)).not.toBeNull();
    expect(matchDanmu('我要上船', viewer(), [rule({ keywords: ['上船'], mode: 'exact' })], ANCHOR)).toBeNull();
    // 英文不分大小写、全角半角一样
    expect(matchDanmu('AWSL！', viewer(), [rule({ keywords: ['awsl'] })], ANCHOR)).not.toBeNull();
    expect(matchDanmu('ａｗｓｌ', viewer(), [rule({ keywords: ['AWSL'], mode: 'exact' })], ANCHOR)).not.toBeNull();
  });

  it('从上到下，命中第一条即停；停用和没选素材的跳过', () => {
    const rules = [rule({ id: 1, enabled: false }), rule({ id: 2, effectId: null }), rule({ id: 3, keywords: ['晚安', '生日'] }), rule({ id: 4 })];
    expect(matchDanmu('生日快乐', viewer(), rules, ANCHOR)?.ruleId).toBe(3);
    expect(matchDanmu('随便说说', viewer(), rules, ANCHOR)).toBeNull();
  });

  it('发送人条件：以前的单选换成多选后结果不变', () => {
    const plain = viewer();
    const fan = viewer({ medal: medal(5) });
    const fan12 = viewer({ medal: medal(12) });
    const other = viewer({ medal: medal(30, 999) });
    const cap = viewer({ guard: 3 });
    const mod = viewer({ isMod: true });
    const old = (w: 'fan' | 'fan10' | 'guard' | 'mod') => danmuWhoFromOld(w);
    expect([plain, fan, other, cap, mod].map((v) => whoOk(old('fan'), v, ANCHOR))).toEqual([false, true, false, true, true]);
    expect([fan, fan12, other].map((v) => whoOk(old('fan10'), v, ANCHOR))).toEqual([false, true, false]);
    expect([plain, cap].map((v) => whoOk(old('guard'), v, ANCHOR))).toEqual([false, true]);
    expect([plain, mod].map((v) => whoOk(old('mod'), v, ANCHOR))).toEqual([false, true]);
    expect(matchDanmu('生日快乐', plain, [rule({ who: old('guard') })], ANCHOR)).toBeNull();
  });

  it('发送人条件：多选、主播、只要总督、粉丝牌等级、指定观众', () => {
    const none: DanmuWho = { ...DANMU_WHO_ALL, all: false };
    const anchor = viewer({ uid: ANCHOR });
    const gov = viewer({ uid: 2, guard: 1 });
    const cap = viewer({ uid: 3, guard: 3 });
    const mod = viewer({ uid: 4, isMod: true });
    const fan20 = viewer({ uid: 5, medal: medal(20) });
    const fan19 = viewer({ uid: 6, medal: medal(19) });
    const friend = viewer({ uid: 777 });
    const w: DanmuWho = { ...none, anchor: true, mod: true, guards: [1], fanMin: 20, uids: [777] };
    expect([anchor, gov, cap, mod, fan20, fan19, friend, viewer()].map((v) => whoOk(w, v, ANCHOR))).toEqual([true, true, false, true, true, false, true, false]);
    expect([anchor, mod, friend].map((v) => whoNamed(w, v, ANCHOR))).toEqual([true, false, true]);
    // 发送人是主播本人或登录的账号（默认不触发）：只看点了 TA 名的规则；「所有人」不算点名
    const rules = [rule({ id: 1 }), rule({ id: 2, who: { ...none, anchor: true } })];
    expect(matchDanmu('生日快乐', anchor, rules, ANCHOR)?.ruleId).toBe(1);
    expect(matchDanmu('生日快乐', anchor, rules, ANCHOR, true)?.ruleId).toBe(2);
    expect(matchDanmu('生日快乐', anchor, [rule({ id: 1 })], ANCHOR, true)).toBeNull();
  });

  it('发送人条件：荣耀等级不低于某级（和别的条件满足任意一项就算）', () => {
    const none: DanmuWho = { ...DANMU_WHO_ALL, all: false };
    const h30 = viewer({ uid: 8, honor: 30 });
    const h29 = viewer({ uid: 9, honor: 29 });
    const w: DanmuWho = { ...none, honorMin: 30 };
    expect([h30, h29, viewer()].map((v) => whoOk(w, v, ANCHOR))).toEqual([true, false, false]);
    expect(whoOk({ ...w, mod: true }, viewer({ uid: 4, isMod: true }), ANCHOR)).toBe(true);
    // 旧数据里没有这一项：当作不按荣耀等级
    const { honorMin: _h, ...old } = { ...none, fanMin: 1 };
    expect(whoOk(old as DanmuWho, h30, ANCHOR)).toBe(false);
  });

  it('关键词重复提示；标签最多显示 3 个关键词', () => {
    expect(keywordClashes([rule({ keywords: ['晚安', '好梦'] }), rule({ keywords: ['生日'] }), rule({ keywords: ['好梦', '好梦'] })])).toEqual({ 好梦: [1, 3] });
    expect(matchDanmu('d', viewer(), [rule({ keywords: ['a', 'b', 'c', 'd'] })], ANCHOR)?.label).toBe('弹幕 · 「a / b / c …」');
  });
});

const gifts = (p: Partial<GiftRules> = {}): GiftRules => ({
  specific: [{ giftId: 25, giftName: '小电视飞船', effectId: 1, enabled: true }],
  bands: [{ fromGold: 10_000, effectId: 6, enabled: true }, { fromGold: 100_000, effectId: 1, enabled: true }, { fromGold: 1000, effectId: 8, enabled: false }],
  comboEnabled: true,
  comboSec: 3,
  ...p,
});
const gift = (p: Partial<GiftEvent> = {}): GiftEvent => ({ kind: 'gift', id: 'g1', ts: 0, viewer: viewer(), giftId: 31036, giftName: '小花花', unitPrice: 100, count: 1, paid: true, ...p });

describe('礼物匹配', () => {
  it('免费礼物不触发', () => {
    expect(matchGift(gift({ paid: false, unitPrice: 0 }), gifts())).toBeNull();
  });
  it('指定礼物优先（按礼物 ID）', () => {
    expect(matchGift(gift({ giftId: 25, giftName: '小电视飞船', unitPrice: 1_245_000 }), gifts())).toEqual({ effectId: 1, key: 'gift:spec:25', label: '礼物 · 「小电视飞船」', valueGold: 1_245_000 });
    // 指定礼物停用时按价值分档
    expect(matchGift(gift({ giftId: 25, unitPrice: 1_245_000 }), gifts({ specific: [{ giftId: 25, giftName: '', effectId: 1, enabled: false }] }))?.key).toBe('gift:band:100000');
  });
  it('按单次价值（数量 × 单价）分档，高档优先；低于最低档、落在停用档都不播', () => {
    expect(matchGift(gift({ unitPrice: 1000, count: 99 }), gifts())).toMatchObject({ key: 'gift:band:10000', label: '礼物 · 单次 10 – 100 元', valueGold: 99_000 });
    expect(matchGift(gift({ unitPrice: 100_000, count: 1 }), gifts())).toMatchObject({ key: 'gift:band:100000', label: '礼物 · 单次 ≥ 100 元' });
    expect(matchGift(gift({ unitPrice: 1000, count: 3 }), gifts())).toBeNull();
    expect(matchGift(gift({ unitPrice: 100, count: 3 }), gifts())).toBeNull();
    expect(matchGift(gift({ unitPrice: 100_000 }), gifts({ bands: [{ fromGold: 100_000, effectId: null, enabled: true }] }))).toBeNull();
  });
  it('金额显示', () => {
    expect(yuanText(100)).toBe('0.1 元');
    expect(yuanText(22_000)).toBe('22 元');
    expect(yuanText(1_245_000)).toBe('1245 元');
    expect(sortedGiftBands(gifts().bands).map((b) => [b.fromGold, b.toGold])).toEqual([[100_000, null], [10_000, 100_000], [1000, 10_000]]);
    expect(giftBandLabel(1000, 10_000)).toBe('1 – 10 元');
  });
});

const guardRules: GuardRules = {
  gov: { openEffectId: 1, renewEffectId: 1, enabled: true },
  adm: { openEffectId: 2, renewEffectId: null, enabled: true },
  cap: { openEffectId: 3, renewEffectId: 6, enabled: false },
};
describe('上舰匹配', () => {
  it('按等级 + 开通 / 续费；停用或没选素材不播', () => {
    expect(matchGuard({ level: 1, op: 'open' }, guardRules)).toEqual({ effectId: 1, label: '上舰 · 开通总督' });
    expect(matchGuard({ level: 1, op: 'renew' }, guardRules)).toEqual({ effectId: 1, label: '上舰 · 续费总督' });
    expect(matchGuard({ level: 2, op: 'renew' }, guardRules)).toBeNull();
    expect(matchGuard({ level: 3, op: 'open' }, guardRules)).toBeNull();
  });
});

describe('礼物连击合并', () => {
  it('窗口内连续送同一种礼物合并，数量相加；窗口结束后输出', () => {
    const m = new GiftComboMerger(3000);
    expect(m.push(gift({ id: 'a', count: 1 }), 0)).toEqual([]);
    expect(m.push(gift({ id: 'b', count: 2 }), 1000)).toEqual([]);
    expect(m.push(gift({ id: 'c', giftId: 1, count: 1 }), 1500)).toEqual([]);
    expect(m.pendingCount).toBe(2);
    expect(m.flush(3900)).toEqual([]);
    const out = m.flush(4000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', count: 3 });
    expect(m.flush(4500)).toMatchObject([{ id: 'c', count: 1 }]);
  });
  it('不同人分开合并；一直连击最多合并 30 秒', () => {
    const m = new GiftComboMerger(3000);
    m.push(gift({ viewer: viewer({ uid: 1 }) }), 0);
    m.push(gift({ viewer: viewer({ uid: 2 }) }), 0);
    expect(m.pendingCount).toBe(2);
    const m2 = new GiftComboMerger(3000);
    let out: GiftEvent[] = [];
    for (let t = 0; t <= 31_000 && !out.length; t += 1000) out = m2.push(gift(), t);
    expect(out[0]?.count).toBe(31);
    m2.push(gift(), 40_000);
    expect(m2.flush(70_000)).toHaveLength(1);
  });
  it('关闭合并时立即输出', () => {
    expect(new GiftComboMerger(3000, false).push(gift(), 0)).toHaveLength(1);
  });
});

const guardEv = (p: Partial<GuardEvent> = {}): GuardEvent => ({ kind: 'guard', id: 'x', ts: 0, viewer: viewer({ uid: 5 }), level: 3, months: 1, op: 'open', source: 'toast', dedupeKey: 'pay1', ...p });
describe('上舰去重', () => {
  it('两条 toast（同一流水号）只保留一条；随后的 GUARD_BUY 丢弃', () => {
    const d = new GuardDeduper(3000);
    expect(d.push(guardEv(), 0)).toHaveLength(1);
    expect(d.push(guardEv({ id: 'y' }), 100)).toHaveLength(0);
    expect(d.push(guardEv({ source: 'guard_buy', dedupeKey: undefined }), 200)).toHaveLength(0);
    expect(d.flush(5000)).toHaveLength(0);
  });
  it('GUARD_BUY 先到：等待期间 toast 到了就用 toast；只有 GUARD_BUY 时 3 秒后单独输出', () => {
    const d = new GuardDeduper(3000);
    expect(d.push(guardEv({ source: 'guard_buy', dedupeKey: undefined }), 0)).toHaveLength(0);
    expect(d.push(guardEv(), 500)).toMatchObject([{ source: 'toast' }]);
    expect(d.flush(4000)).toHaveLength(0);

    const d2 = new GuardDeduper(3000);
    d2.push(guardEv({ source: 'guard_buy', dedupeKey: undefined, viewer: viewer({ uid: 9 }) }), 0);
    expect(d2.flush(2999)).toHaveLength(0);
    expect(d2.flush(3000)).toMatchObject([{ source: 'guard_buy' }]);
    // 之后 60 秒内同一人同等级的 toast（没有流水号）视为同一次
    expect(d2.push(guardEv({ viewer: viewer({ uid: 9 }), dedupeKey: undefined }), 4000)).toHaveLength(0);
    // 过期记录会被清理
    expect(d2.flush(70_000)).toHaveLength(0);
    expect(d2.push(guardEv({ viewer: viewer({ uid: 9 }), dedupeKey: undefined }), 70_001)).toHaveLength(1);
  });
  it('GUARD_BUY 已经单独输出后，晚到的带流水号的 toast 是同一次购买，不再播一次', () => {
    const d = new GuardDeduper(3000);
    d.push(guardEv({ source: 'guard_buy', dedupeKey: undefined }), 0);
    expect(d.flush(3000)).toMatchObject([{ source: 'guard_buy' }]);
    expect(d.push(guardEv({ op: 'renew', dedupeKey: 'late-pay' }), 4500)).toHaveLength(0);
    expect(d.push(guardEv({ op: 'renew', dedupeKey: 'late-pay', id: 'v1' }), 4600)).toHaveLength(0);
    // 之后真正的另一次购买照常输出
    expect(d.push(guardEv({ dedupeKey: 'pay-2' }), 20_000)).toHaveLength(1);
  });
});

describe('被前面的规则抢先的关键词', () => {
  it('前面「包含」规则的词在这个词里面：这个词轮不到', () => {
    const rules = [rule({ id: 1, keywords: ['晚安'] }), rule({ id: 2, keywords: ['晚安啦', '早安'] }), rule({ id: 3, keywords: ['晚安'], mode: 'exact' })];
    expect(shadowedKeywords(rules)).toEqual({ 1: [{ word: '晚安啦', by: 0, byWord: '晚安' }], 2: [{ word: '晚安', by: 0, byWord: '晚安' }] });
  });
  it('前面的规则关着、或者是「整条就是」时不算抢先（除非后面也是整条一样的词）', () => {
    expect(shadowedKeywords([rule({ keywords: ['晚安'], enabled: false }), rule({ keywords: ['晚安啦'] })])).toEqual({});
    expect(shadowedKeywords([rule({ keywords: ['晚安'], mode: 'exact' }), rule({ keywords: ['晚安啦'] })])).toEqual({});
    expect(shadowedKeywords([rule({ keywords: ['AWSL'], mode: 'exact' }), rule({ keywords: ['awsl'], mode: 'exact' })])).toEqual({ 1: [{ word: 'awsl', by: 0, byWord: 'AWSL' }] });
  });
});
