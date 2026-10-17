import { describe, expect, it } from 'vitest';
import { chatHeight, DANMU_WHO_DEFAULT, DanmuWhoSchema, giftBoardAdd, giftListShows, giftRowsSorted, giftRowsTrim, giftsHeight, giftsSourceSize, goldToYuan } from './index.ts';
import type { GiftListItem, GiftRankRow, GiftRow, GiftsFilter } from './index.ts';

describe('goldToYuan', () => {
  it('按 1 元 = 1000 金瓜子换算', () => {
    expect(goldToYuan(100)).toBe(0.1); // 小花花
    expect(goldToYuan(19900)).toBe(19.9); // 告白花束
    expect(goldToYuan(1245000)).toBe(1245); // 小电视飞船
  });
});

describe('弹幕列表建议高度', () => {
  it('默认 8 条、标准字号是 900；字号大、条数多时更高；按 50 取整，至少 300', () => {
    expect(chatHeight(8, 'normal')).toBe(900);
    expect(chatHeight(8, 'large')).toBe(1100);
    expect(chatHeight(20, 'normal')).toBe(2250);
    expect(chatHeight(1, 'normal')).toBe(300);
    for (let n = 1; n < 20; n++) expect(chatHeight(n + 1, 'normal')).toBeGreaterThan(chatHeight(n, 'normal') - 1);
  });
});

describe('送礼名单显示哪些', () => {
  const gift = (value: number, id = 1): GiftListItem => ({ id: `g${value}`, ts: 0, kind: 'gift', viewer: { name: 'a', guard: 0 }, value, gift: { id, name: '礼物', count: 1 } });
  const guard: GiftListItem = { id: 'u', ts: 0, kind: 'guard', viewer: { name: 'a', guard: 3 }, value: 138_000, guard: { level: 3, months: 1, op: 'open' } };
  const base: GiftsFilter = { mode: 'all', gifts: [], guard: true, sc: true };
  it('全部礼物：最低金额按总价值算，不管上舰', () => {
    expect(giftListShows(base, gift(100))).toBe(true);
    const min1 = { ...base, minGold: 1000 };
    expect(giftListShows(min1, gift(100))).toBe(false);
    expect(giftListShows(min1, gift(1000))).toBe(true);
    expect(giftListShows({ ...min1, minGold: 200_000 }, guard)).toBe(true);
  });
  it('只要这几种：不看最低金额', () => {
    expect(giftListShows({ ...base, mode: 'only', gifts: [{ id: 1, name: '礼物' }], minGold: 1000 }, gift(100))).toBe(true);
    expect(giftListShows({ ...base, mode: 'only', gifts: [{ id: 2, name: '别的' }] }, gift(100))).toBe(false);
  });
});

describe('送礼名单：合并、按人合计、排序', () => {
  let n = 0;
  const base: GiftsFilter = { mode: 'all', gifts: [], guard: true, sc: true };
  const gift = (uid: number, value: number, giftId = 1, p: Partial<GiftListItem> = {}): GiftListItem => ({ id: `log-${++n}`, ts: n * 1000, kind: 'gift', viewer: { uid, name: `观众${uid}`, guard: 0 }, value, gift: { id: giftId, name: giftId === 1 ? '小花花' : '极速超跑', count: value / (giftId === 1 ? 100 : 100_000), ...(giftId === 2 ? { img: 'car.png' } : {}) }, ...p });
  const add = (f: GiftsFilter, items: GiftListItem[]) => {
    const rows = new Map<string, GiftRow>();
    const changed = items.map((it) => giftBoardAdd(rows, f, it));
    return { rows, changed };
  };

  it('一份一条：每份一行，按时间旧的在上；按金额时大的在上', () => {
    const items = [gift(1, 500), gift(2, 100_000, 2), gift(1, 300)];
    const { rows } = add(base, items);
    expect(giftRowsSorted(rows.values(), base).map((r) => r.value)).toEqual([500, 100_000, 300]);
    expect(giftRowsSorted(rows.values(), { ...base, sort: 'value' }).map((r) => r.value)).toEqual([100_000, 500, 300]);
  });

  it('合并同一个人的同一种礼物：数量、价值加起来，时间是最近一次；别人的、别的礼物不合', () => {
    const f = { ...base, merge: true };
    const { rows, changed } = add(f, [gift(1, 500), gift(2, 200), gift(1, 300), gift(1, 100_000, 2)]);
    expect(rows.size).toBe(3);
    expect(changed[2]).toMatchObject({ id: 'm:1:1', value: 800, times: 2, gift: { count: 8 } });
    expect(giftRowsSorted(rows.values(), f).map((r) => r.id)).toEqual(['m:2:1', 'm:1:1', 'm:1:2']);
  });

  it('按人合计：每人一行，总价值从多到少；记下送礼次数、醒目留言、上过的最高的舰、最贵的礼物；头像名字用最新的', () => {
    const f: GiftsFilter = { ...base, view: 'viewer' };
    const sc: GiftListItem = { id: 'log-sc', ts: 99_000, kind: 'sc', viewer: { uid: 2, name: '改了名', guard: 0 }, value: 30_000, sc: { text: '你好', price: 30 } };
    const cap: GiftListItem = { id: 'log-g', ts: 99_500, kind: 'guard', viewer: { uid: 1, name: '观众1', guard: 3 }, value: 198_000, guard: { level: 3, months: 1, op: 'open' } };
    const { rows } = add(f, [gift(1, 500), gift(2, 100_000, 2), gift(1, 300), sc, cap]);
    const [a, b] = giftRowsSorted(rows.values(), f) as GiftRankRow[];
    expect(a).toMatchObject({ id: 'v:1', value: 198_800, times: 2, scs: 0, guard: 3, top: { name: '小花花', price: 100 }, viewer: { guard: 3 } });
    expect(b).toMatchObject({ id: 'v:2', value: 130_000, times: 1, scs: 1, top: { name: '极速超跑', img: 'car.png', price: 100_000 }, viewer: { name: '改了名' } });
  });

  it('按筛选不显示的不算进来；只显示挂上的记录时一条都不算', () => {
    expect(add({ ...base, view: 'viewer', minGold: 1000 }, [gift(1, 500)]).rows.size).toBe(0);
    expect(add({ ...base, mode: 'pinned' }, [gift(1, 500)]).changed).toEqual([null]);
  });

  it('超过上限：按时间留最新的，按金额留最多的', () => {
    const items = Array.from({ length: 5 }, (_, i) => gift(i + 1, (5 - i) * 100));
    const byTime = add(base, items).rows;
    expect(giftRowsTrim(byTime, base, 3)).toHaveLength(2);
    expect([...byTime.values()].map((r) => r.value)).toEqual([300, 200, 100]);
    const byValue = add({ ...base, sort: 'value' }, items).rows;
    giftRowsTrim(byValue, { ...base, sort: 'value' }, 3);
    expect(giftRowsSorted(byValue.values(), { ...base, sort: 'value' }).map((r) => r.value)).toEqual([500, 400, 300]);
  });

  it('浏览器源高度：有标题时多出一行', () => {
    expect(giftsHeight(6, 'normal')).toBe(650);
    expect(giftsHeight(6, 'normal', true)).toBeGreaterThan(giftsHeight(6, 'normal'));
  });

  it('浏览器源大小按滚法：竖着 640 宽，跑马灯一整行 1080 宽、高度只跟字号走', () => {
    const c = { giftsMax: 6, giftsSize: 'normal' as const, giftsTitle: '' };
    for (const giftsMotion of ['credits', 'step', 'page'] as const) expect(giftsSourceSize({ ...c, giftsMotion })).toEqual({ w: 640, h: 650 });
    expect(giftsSourceSize({ ...c, giftsMotion: 'marquee' })).toEqual({ w: 1080, h: 150 });
    expect(giftsSourceSize({ ...c, giftsMax: 12, giftsTitle: '本场礼物', giftsSize: 'large', giftsMotion: 'marquee' })).toEqual({ w: 1080, h: 190 });
  });
});

describe('新建弹幕规则的默认发送人', () => {
  it('只算主播、房管和大航海，且能通过校验', () => {
    expect(DANMU_WHO_DEFAULT).toMatchObject({ all: false, mod: true, guards: [1, 2, 3], anchor: true, fanMin: null, honorMin: null, uids: [] });
    expect(DanmuWhoSchema.safeParse(DANMU_WHO_DEFAULT).success).toBe(true);
  });
});
