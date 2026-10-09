import { describe, expect, it } from 'vitest';
import { chatHeight, DANMU_WHO_DEFAULT, DanmuWhoSchema, giftListShows, goldToYuan } from './index.ts';
import type { GiftListItem, GiftsFilter } from './index.ts';

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

describe('新建弹幕规则的默认发送人', () => {
  it('只算主播、房管和大航海，且能通过校验', () => {
    expect(DANMU_WHO_DEFAULT).toMatchObject({ all: false, mod: true, guards: [1, 2, 3], anchor: true, fanMin: null, honorMin: null, uids: [] });
    expect(DanmuWhoSchema.safeParse(DANMU_WHO_DEFAULT).success).toBe(true);
  });
});
