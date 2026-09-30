import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuardPage, ListViewer, OnlineRank } from '@starfall/bili';
import type { StdEvent } from '@starfall/shared';
import { room } from '../db/schema.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.restoreAllMocks(); });

const lv = (uid: number, p: Partial<ListViewer> = {}): ListViewer => ({ uid, name: `观众${uid}`, face: '', guard: 0, honor: 0, mystery: false, ...p });

async function setup(fakes: { online?: () => OnlineRank; guards?: (page: number) => GuardPage } = {}) {
  const fetchOnline = vi.fn(async () => fakes.online?.() ?? { count: 0, items: [] });
  const fetchGuards = vi.fn(async (_h: unknown, _r: number, _a: number, page: number) => fakes.guards?.(page) ?? { total: 0, pages: 1, items: [] });
  const t = await testApp({ audience: { fetchOnline, fetchGuards, sleep: async () => undefined } });
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '主播' }).run();
  const req = await t.login();
  type Trig = Exclude<StdEvent, { kind: 'live' }>;
  const record = (ev: Trig, roomId = 30000) => t.ctx.log.record(ev, { roomId, sessionId: null, rule: null, effectId: null, status: 'no_rule' });
  const viewer = (uid: number, p: object = {}) => ({ uid, name: `观众${uid}`, guard: 0 as const, isMod: false, mystery: false, ...p });
  const gift = (uid: number, name: string, unitPrice: number, count: number, paid = true, roomId = 30000) =>
    record({ kind: 'gift', id: `g${Math.random()}`, ts: Date.now(), viewer: viewer(uid), giftId: 1, giftName: name, unitPrice, count, paid }, roomId);
  const enter = (uid: number, p: object = {}, ts = Date.now()) => record({ kind: 'enter', id: `e${Math.random()}`, ts, source: 'interact', viewer: viewer(uid, p) });
  const goLive = () => vi.spyOn(t.ctx.live, 'status').mockReturnValue({ ...t.ctx.live.status(), live: true, liveSince: Date.now() - 3600_000 });
  const guard = (uid: number, priceGold?: number, raw?: unknown) =>
    t.ctx.log.record({ kind: 'guard', id: `u${Math.random()}`, ts: Date.now(), viewer: viewer(uid, { guard: 3 }), level: 3, months: 1, op: 'open', source: 'toast', ...(priceGold ? { priceGold } : {}) }, { roomId: 30000, sessionId: null, rule: null, effectId: null, status: 'no_rule', raw });
  return { ...t, req, fetchOnline, fetchGuards, gift, enter, guard, goLive, viewer };
}

describe('总览右侧面板', () => {
  it('礼物榜：只算付费礼物，按总价值排，带最贵的一件；别的直播间不算', async () => {
    const t = await setup();
    t.gift(1, '小花花', 100, 10);
    t.gift(1, '告白花束', 220_000, 1);
    t.gift(2, '天空之翼', 1_314_000, 1);
    t.gift(3, '辣条', 100, 50, false);
    t.gift(4, '小电视', 1_245_000, 1, true, 999);
    const r = (await t.req({ method: 'GET', url: '/api/stats/gifts?scope=today' })).json();
    expect(r).toMatchObject({ scope: 'today', people: 2, gold: 1_314_000 + 221_000 });
    expect(r.rows.map((x: { uid: number; gold: number; times: number; topGift: string }) => [x.uid, x.gold, x.times, x.topGift])).toEqual([[2, 1_314_000, 1, '天空之翼'], [1, 221_000, 2, '告白花束']]);
    expect(r.rows[0].viewer).toMatchObject({ uid: 2, name: '观众2' });
    // 本场：从来没开播过就没有
    expect((await t.req({ method: 'GET', url: '/api/stats/gifts?scope=live' })).json()).toMatchObject({ from: null, people: 0, rows: [] });
  });

  it('礼物榜算上上舰（实付价格）和醒目留言；醒目留言同一条推两次只记一次，不触发特效', async () => {
    const t = await setup();
    t.gift(1, '小花花', 100, 10);
    t.guard(1, 168_000);
    t.guard(2, 138_000);
    t.guard(4);
    const sc = { kind: 'sc' as const, id: 'sc1', ts: Date.now(), viewer: t.viewer(3), text: '晚上好', priceYuan: 30, scId: '777' };
    t.ctx.pipeline.handle(sc);
    t.ctx.pipeline.handle({ ...sc, id: 'sc2' });
    const r = (await t.req({ method: 'GET', url: '/api/stats/gifts?scope=today' })).json();
    expect(r).toMatchObject({ people: 3, gold: 1000 + 168_000 + 138_000 + 30_000 });
    expect(r.rows.map((x: Record<string, unknown>) => [x.uid, x.gold, x.times, x.guards, x.scs])).toEqual([[1, 169_000, 1, 1, 0], [2, 138_000, 0, 1, 0], [3, 30_000, 0, 0, 1]]);
    expect(r.rows[1].topGift).toBe('');
    const scs = t.ctx.log.query({ kind: 'sc' }).events;
    expect(scs).toHaveLength(1);
    expect(scs[0]).toMatchObject({ status: 'no_rule', rule: null, payload: { text: '晚上好', price: 30, scId: '777' } });
    expect(t.ctx.pipeline.snapshot().items).toHaveLength(0);
    // 事件记录可以只看醒目留言
    expect((await t.req({ method: 'GET', url: '/api/events?kind=sc' })).json().events).toHaveLength(1);
  });

  it('以前记录的上舰从原始消息里补上价格', async () => {
    const t = await setup();
    const raw = { cmd: 'USER_TOAST_MSG', data: { uid: 5, username: 'a', guard_level: 3, num: 1, unit: '月', price: 138_000, payflow_id: 'p', toast_msg: '<%a%> 开通了舰长' } };
    t.guard(5, undefined, raw);
    t.guard(6);
    const { parseMessage } = await import('@starfall/bili');
    const n = t.ctx.log.backfillGuardPrices((x) => { const ev = parseMessage(x as never, { newId: () => 'x', now: Date.now }); return ev?.kind === 'guard' ? ev.priceGold : undefined; });
    expect(n).toBe(1);
    expect(t.ctx.log.query({ kind: 'guard' }).events.map((e) => (e.payload as { price?: number }).price)).toEqual([undefined, 138_000]);
  });

  it('大航海：来了谁、几次、最后一次；舰队名单读全部页，缓存 15 分钟', async () => {
    const t = await setup({ guards: (page) => ({ total: 4, pages: 2, items: page === 1 ? [lv(1, { guard: 3 }), lv(2, { guard: 1 }), lv(5, { guard: 3 })] : [lv(6, { guard: 2 }), lv(5, { guard: 3 })] }) });
    t.enter(1, { guard: 3 }, Date.now() - 60_000);
    t.enter(1, { guard: 3 });
    t.enter(2, { guard: 1 }, Date.now() - 30_000);
    t.enter(3);
    const r = (await t.req({ method: 'GET', url: '/api/stats/fleet?scope=today' })).json();
    expect(r.came.map((c: { uid: number; times: number }) => [c.uid, c.times])).toEqual([[1, 2], [2, 1]]);
    expect(r.fleet).toMatchObject({ total: 4 });
    expect(r.fleet.members.map((m: { uid: number }) => m.uid)).toEqual([1, 2, 5, 6]);
    expect(t.fetchGuards).toHaveBeenCalledTimes(2);
    await t.req({ method: 'GET', url: '/api/stats/fleet?scope=today' });
    expect(t.fetchGuards).toHaveBeenCalledTimes(2);
    // 统计里的荣耀等级分布
    t.enter(7, { honor: 25 });
    t.enter(8, { honor: 68 });
    expect((await t.req({ method: 'GET', url: '/api/stats?scope=today' })).json().honor).toEqual({ l1: 0, l21: 1, l41: 0, l61: 1, none: 3 });
  });

  it('舰队名单读不到时只给来了的人，带上原因', async () => {
    const t = await setup({ guards: () => { throw new Error('连不上'); } });
    t.enter(1, { guard: 3 });
    const r = (await t.req({ method: 'GET', url: '/api/stats/fleet?scope=today' })).json();
    expect(r).toMatchObject({ fleet: null, came: [{ uid: 1 }] });
    expect(r.fleetError).toContain('连不上');
  });

  it('在线观众：没开播时是空的；开播后读一次（B 站只给前 100 位，没贡献的也在），20 秒内不重复读', async () => {
    const page = (): OnlineRank => ({ count: 130, items: Array.from({ length: 100 }, (_, i) => ({ ...lv(i + 1, { honor: 10 }), rank: i + 1, score: Math.max(0, 70 - i) })) });
    const t = await setup({ online: page });
    expect((await t.req({ method: 'GET', url: '/api/online' })).json()).toEqual({ live: false, count: 0, items: [], updatedAt: null });
    expect(t.fetchOnline).not.toHaveBeenCalled();
    t.goLive();
    // B 站的名单里没有房管，按本直播间的房管名单补上
    vi.spyOn(t.ctx.live, 'isMod').mockImplementation((uid) => uid === 2);
    const r = (await t.req({ method: 'GET', url: '/api/online' })).json();
    expect(r).toMatchObject({ live: true, count: 130 });
    expect(r.items).toHaveLength(100);
    expect(r.items[0]).toMatchObject({ uid: 1, rank: 1, score: 70, honor: 10, isMod: false });
    expect(r.items[1]).toMatchObject({ uid: 2, isMod: true });
    expect(r.items[99]).toMatchObject({ score: 0 });
    expect(t.fetchOnline).toHaveBeenCalledTimes(1);
    await t.req({ method: 'GET', url: '/api/online' });
    expect(t.fetchOnline).toHaveBeenCalledTimes(1);
  });

  it('在线观众读失败：以前读到过就用以前的，从来没读到过返回 502', async () => {
    let fail = true;
    const t = await setup({ online: () => { if (fail) throw new Error('风控'); return { count: 1, items: [{ ...lv(1), rank: 1, score: 5 }] }; } });
    t.goLive();
    const bad = await t.req({ method: 'GET', url: '/api/online' });
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.message).toContain('风控');
    fail = false;
    expect((await t.req({ method: 'GET', url: '/api/online' })).json().count).toBe(1);
  });
});
