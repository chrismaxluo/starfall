import { afterEach, describe, expect, it } from 'vitest';
import type { StdEvent, Viewer } from '@starfall/shared';
import { liveSessions, room } from '../db/schema.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });

const viewer = (name: string, guard: 0 | 1 | 2 | 3 = 0): Viewer => ({ uid: name.length, name, guard, isMod: false, mystery: false });

async function setup() {
  const t = await testApp();
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '主播' }).run();
  t.ctx.db.insert(liveSessions).values([{ id: 1, roomId: 30000, startedAt: 1_000, endedAt: 2_000 }, { id: 2, roomId: 30000, startedAt: 3_000, endedAt: 4_000 }]).run();
  const log = (ev: StdEvent, sessionId: number) => t.ctx.log.record(ev as never, { roomId: 30000, sessionId, rule: null, effectId: null, status: 'no_rule' }).id;
  const ids = {
    flower: log({ kind: 'gift', id: 'a', ts: 1_100, viewer: viewer('半糖主义'), giftId: 31036, giftName: '小花花', unitPrice: 100, count: 66, paid: true }, 1),
    free: log({ kind: 'gift', id: 'b', ts: 1_200, viewer: viewer('路人'), giftId: 1, giftName: '辣条', unitPrice: 100, count: 1, paid: false }, 1),
    guard: log({ kind: 'guard', id: 'c', ts: 1_300, viewer: viewer('长夜未央', 3), level: 3, months: 1, op: 'open', source: 'toast', priceGold: 198_000 }, 1),
    sc: log({ kind: 'sc', id: 'd', ts: 3_100, viewer: viewer('路过的猫'), text: '主播唱首歌吧', priceYuan: 30, scId: 's1' }, 2),
  };
  return { ...t, req: await t.login(), ids };
}

describe('送礼名单：挑记录、挂上', () => {
  it('场次列表（最新的在前，带条数）；某一场的记录（最新的在前，免费礼物不算）', async () => {
    const { req } = await setup();
    const s = (await req({ method: 'GET', url: '/api/gift-list/sessions' })).json();
    expect(s.sessions.map((x: { id: number; gifts: number }) => [x.id, x.gifts])).toEqual([[2, 1], [1, 3]]);
    const r = (await req({ method: 'GET', url: '/api/gift-list/records?session=1' })).json();
    expect(r.items.map((x: { kind: string }) => x.kind)).toEqual(['guard', 'gift']);
    expect(r.items[1]).toMatchObject({ kind: 'gift', value: 6600, viewer: { name: '半糖主义' }, gift: { name: '小花花', count: 66 } });
  });

  it('全部场次一起找：按观众名、UID、礼物名、醒目留言内容搜；按总价值筛', async () => {
    const { req } = await setup();
    const find = async (qs: string) => (await req({ method: 'GET', url: `/api/gift-list/records?session=all${qs}` })).json().items.map((x: { viewer: { name: string }; sessionId: number }) => `${x.viewer.name}@${x.sessionId}`);
    expect(await find('')).toEqual(['路过的猫@2', '长夜未央@1', '半糖主义@1']);
    expect(await find('&q=' + encodeURIComponent('半糖'))).toEqual(['半糖主义@1']);
    // 按 UID 找（测试数据里三个人的 UID 都是 4，路人是 2 而且送的是免费礼物）
    expect(await find('&q=4')).toEqual(['路过的猫@2', '长夜未央@1', '半糖主义@1']);
    expect(await find('&q=2')).toEqual([]);
    expect(await find('&q=' + encodeURIComponent('小花花'))).toEqual(['半糖主义@1']);
    expect(await find('&q=' + encodeURIComponent('唱首歌'))).toEqual(['路过的猫@2']);
    // 小花花 66 个 = 6.6 元；醒目留言 30 元；上舰 198 元
    expect(await find('&min=10000')).toEqual(['路过的猫@2', '长夜未央@1']);
    expect(await find('&min=100000')).toEqual(['长夜未央@1']);
    expect(await find('&min=100000&q=' + encodeURIComponent('半糖'))).toEqual([]);
    expect((await req({ method: 'GET', url: '/api/gift-list/records?session=1&min=10000' })).json().items.map((x: { kind: string }) => x.kind)).toEqual(['guard']);
  });

  it('挂上（不重复挂）、调顺序、撤下；送礼名单收到整份；免费礼物、不存在的记录不能挂', async () => {
    const { req, ids, ctx } = await setup();
    const pin = (eventId: number) => req({ method: 'POST', url: '/api/gift-list/pins', payload: { eventId } });
    await pin(ids.flower);
    await pin(ids.sc);
    const r = (await pin(ids.flower)).json();
    expect(r.pins.map((p: { eventId: number }) => p.eventId)).toEqual([ids.flower, ids.sc]);
    expect(ctx.hub.pins().map((p) => p.kind)).toEqual(['gift', 'sc']);
    expect((await pin(ids.free)).statusCode).toBe(404);
    expect((await pin(99_999)).statusCode).toBe(404);

    const [a, b] = r.pins.map((p: { id: number }) => p.id);
    const o = (await req({ method: 'PUT', url: '/api/gift-list/pins/order', payload: { ids: [b, a] } })).json();
    expect(o.pins.map((p: { eventId: number }) => p.eventId)).toEqual([ids.sc, ids.flower]);
    expect((await req({ method: 'PUT', url: '/api/gift-list/pins/order', payload: { ids: [a] } })).statusCode).toBe(400);

    const d = (await req({ method: 'DELETE', url: `/api/gift-list/pins/${b}` })).json();
    expect(d.pins.map((p: { eventId: number }) => p.eventId)).toEqual([ids.flower]);
    expect(ctx.hub.pins()).toHaveLength(1);
    // 事件记录删掉了也照样显示（挂上时存了一份）
    ctx.db.$client.prepare('delete from events').run();
    expect((await req({ method: 'GET', url: '/api/gift-list/pins' })).json().pins[0].item).toMatchObject({ gift: { name: '小花花' } });
  });

  it('送礼名单可以设成只显示挂上的记录', async () => {
    const { req } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    const giftsFilter = { mode: 'pinned', gifts: [], guard: true, sc: true };
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsFilter } })).json()).toMatchObject({ giftsFilter });
  });
});
