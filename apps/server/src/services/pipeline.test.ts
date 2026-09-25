import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnterEvent, ServerToOverlay, StdEvent, Viewer } from '@starfall/shared';
import { room } from '../db/schema.ts';
import { testApp } from '../testing.ts';
import { Hub } from './hub.ts';
import { Pipeline } from './pipeline.ts';
import type { LiveStatus } from './live.ts';

const ANCHOR = 20000;

function fakeLive() {
  const listeners = new Set<(ev: StdEvent, raw: unknown) => void>();
  const state: Pick<LiveStatus, 'live' | 'sessionId'> = { live: true, sessionId: 1 };
  return {
    state,
    onEvent: (fn: (ev: StdEvent, raw: unknown) => void) => (listeners.add(fn), () => listeners.delete(fn)),
    status: () => ({ ...state, liveSince: 0, connection: 'connected' as const, connectionDetail: null, reason: 'ok' as const, adminCount: 0 }),
    emit: (ev: StdEvent, raw?: unknown) => { for (const fn of listeners) fn(ev, raw); },
  };
}

function fakeSock() {
  const sent: ServerToOverlay[] = [];
  return { sent, closed: [] as number[], send(d: string) { sent.push(JSON.parse(d)); }, close(code?: number) { this.closed.push(code ?? 1000); } };
}

let seq = 0;
const v = (p: Partial<Viewer> = {}): Viewer => ({ uid: 10001, name: '小星', guard: 0, isMod: false, mystery: false, ...p });
const enter = (p: Partial<Viewer> = {}, source: EnterEvent['source'] = 'interact'): EnterEvent => ({ kind: 'enter', id: `e${++seq}`, ts: Date.now(), viewer: v(p), source });
const medal = (level: number, anchorUid = ANCHOR) => ({ name: '星临', level, anchorUid });

let cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const c of cleanup) await c(); cleanup = []; vi.useRealTimers(); });

async function setup(opts: { overlay?: boolean } = {}) {
  const t = await testApp();
  cleanup.push(() => t.app.close());
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-09-25T12:00:00+08:00') });
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: ANCHOR, anchorName: '主播' }).run();
  const live = fakeLive();
  const hub = new Hub();
  const p = new Pipeline({ ...t.ctx, live, hub, timeZone: 'Asia/Shanghai', rng: () => 0 });
  p.start();
  cleanup.push(() => p.stop());
  const sock = fakeSock();
  if (opts.overlay !== false) hub.addOverlay(sock, t.ctx.outputs.list()[0]!, []);
  const plays = () => sock.sent.filter((m) => m.type === 'play').map((m) => (m as Extract<ServerToOverlay, { type: 'play' }>).item);
  const events = () => t.ctx.log.query({ limit: 200 }).events.reverse();
  const statuses = () => events().map((e) => e.status);
  return { ...t, live, hub, p, sock, plays, events, statuses };
}

describe('进场 → 播放', () => {
  it('舰长进场：命中舰长档，推送给特效页，事件记录为已播放', async () => {
    const { live, plays, events } = await setup();
    live.emit(enter({ guard: 3, medal: medal(12), face: 'https://i0.hdslb.com/f.jpg' }), { cmd: 'INTERACT_WORD_V2' });
    const [item] = plays();
    expect(item).toMatchObject({ kind: 'enter', text: '欢迎舰长 小星 登船', effect: { name: '流光', visual: { type: 'builtin_style', style: 'flow' }, showText: true }, viewer: { name: '小星', guard: 3, face: 'https://i0.hdslb.com/f.jpg', medal: { level: 12 } } });
    expect(events()).toMatchObject([{ kind: 'enter', uid: 10001, rule: '进场 · 舰长', status: 'played' }]);
    expect(events()[0]!.viewer).toMatchObject({ guard: 3 });
  });

  it('原始消息写进记录；观众昵称写进缓存', async () => {
    const { live, ctx } = await setup();
    live.emit(enter({ guard: 3 }), { cmd: 'INTERACT_WORD_V2', data: { pb: 'xx' } });
    const row = ctx.db.$client.prepare('select raw from events').get() as { raw: string };
    expect(JSON.parse(row.raw)).toEqual({ cmd: 'INTERACT_WORD_V2', data: { pb: 'xx' } });
    expect(ctx.viewers.cached(10001)?.name).toBe('小星');
  });

  it('ENTRY_EFFECT 先到：等 INTERACT_WORD_V2 合并成一条；只有 ENTRY_EFFECT 时 1.6 秒后单独处理', async () => {
    const { live, events, plays } = await setup();
    live.emit(enter({ guard: 3 }, 'entry_effect'));
    vi.advanceTimersByTime(1000);
    expect(events()).toHaveLength(0);
    live.emit(enter({ guard: 0, medal: medal(25) }));
    expect(events()).toHaveLength(1);
    expect(events()[0]!.viewer).toMatchObject({ guard: 3, medal: { level: 25 } });

    live.emit(enter({ uid: 10002, name: '小月', guard: 2 }, 'entry_effect'));
    vi.advanceTimersByTime(1500);
    expect(events()).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(events()).toHaveLength(2);
    expect(events()[1]).toMatchObject({ uid: 10002, rule: '进场 · 提督', status: 'queued' });
    expect(plays()).toHaveLength(1);
  });

  it('按分钟冷却：同一个人冷却期内再进来记录为冷却中，过了冷却再播', async () => {
    const { live, statuses } = await setup();
    live.emit(enter({ guard: 3 }));
    vi.advanceTimersByTime(60_000);
    live.emit(enter({ guard: 3 }));
    vi.advanceTimersByTime(5 * 60_000);
    live.emit(enter({ guard: 3 }));
    expect(statuses()).toEqual(['played', 'cooldown', 'played']);
  });

  it('每场一次：本场播过就不再播；换一场重新计算；服务重启后从记录恢复', async () => {
    const t = await setup();
    t.ctx.settings.set('cooldownMode', 'oncePerLive');
    t.live.emit(enter({ guard: 3 }));
    vi.advanceTimersByTime(3 * 3600_000);
    t.live.emit(enter({ guard: 3 }));
    expect(t.statuses()).toEqual(['played', 'once']);

    // 模拟重启：新的管道从事件记录恢复
    const p2 = new Pipeline({ ...t.ctx, live: t.live, hub: t.hub, timeZone: 'Asia/Shanghai' });
    t.p.stop();
    p2.start();
    cleanup.push(() => p2.stop());
    vi.advanceTimersByTime(4000);
    t.live.emit(enter({ guard: 3 }));
    expect(t.statuses().at(-1)).toBe('once');

    t.live.state.sessionId = 2;
    vi.advanceTimersByTime(4000);
    t.live.emit(enter({ guard: 3 }));
    expect(t.statuses().at(-1)).toBe('played');
  });

  it('未开播：默认不播；排练模式照常播', async () => {
    const t = await setup();
    t.live.state.live = false;
    t.live.state.sessionId = null;
    t.live.emit(enter({ guard: 3 }));
    t.ctx.settings.set('offlinePolicy', 'play');
    t.live.emit(enter({ uid: 10002, guard: 3 }));
    expect(t.statuses()).toEqual(['offline', 'played']);
  });

  it('特效页不在线时不积压', async () => {
    const t = await setup({ overlay: false });
    t.live.emit(enter({ guard: 3 }));
    expect(t.statuses()).toEqual(['no_overlay']);
  });

  it('黑名单：名单里的人、主播本人不触发；关闭"屏蔽主播本人"后主播进场照常播', async () => {
    const t = await setup();
    t.ctx.blacklist.add({ uid: 10001 });
    t.live.emit(enter({ guard: 3 }));
    t.live.emit(enter({ uid: ANCHOR, guard: 0, isMod: true }));
    t.ctx.settings.set('blockAnchor', false);
    vi.advanceTimersByTime(4000);
    t.live.emit(enter({ uid: ANCHOR, guard: 0, isMod: true }));
    expect(t.statuses()).toEqual(['blacklist', 'blacklist', 'played']);
  });

  it('没有命中规则：普通观众默认关闭；别的主播的粉丝牌不算', async () => {
    const t = await setup();
    t.live.emit(enter({ uid: 1 }));
    t.live.emit(enter({ uid: 2, medal: medal(30, 99999) }));
    t.live.emit(enter({ uid: 3, medal: medal(30) }));
    expect(t.events().map((e) => [e.status, e.rule])).toEqual([['no_rule', null], ['no_rule', null], ['played', '进场 · 粉丝牌 21 级及以上']]);
  });

  it('专属用户：有效期内优先；过期后按身份档位（按主播时区算今天）', async () => {
    const t = await setup();
    const special = t.ctx.effects.list().find((e) => e.name === '星冕')!.id;
    // 北京时间 2026-09-25 12:00，UTC 同一天；把时间调到北京时间 26 日 01:00（UTC 还是 25 日）
    vi.setSystemTime(new Date('2026-09-26T01:00:00+08:00'));
    t.ctx.enterRules.addExclusive({ uid: 10001, effectId: special, cooldownMin: 0, until: '2026-09-25', enabled: true });
    t.ctx.enterRules.addExclusive({ uid: 10002, effectId: special, cooldownMin: 0, until: '2026-09-26', enabled: true });
    t.live.emit(enter({ guard: 3 }));
    t.live.emit(enter({ uid: 10002, guard: 3 }));
    expect(t.events().map((e) => e.rule)).toEqual(['进场 · 舰长', '进场 · 专属']);
  });
});

describe('播放队列', () => {
  it('一次播一个，按时长 + 0.3 秒间隔播下一个', async () => {
    const t = await setup();
    t.live.emit(enter({ uid: 1, guard: 3 }));
    t.live.emit(enter({ uid: 2, guard: 3 }));
    expect(t.plays()).toHaveLength(1);
    expect(t.statuses()).toEqual(['played', 'queued']);
    expect(t.p.snapshot()).toMatchObject({ playing: { effectName: '流光' }, items: [{ viewerName: '小星' }] });
    vi.advanceTimersByTime(4200 + 299);
    expect(t.plays()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.plays()).toHaveLength(2);
    expect(t.statuses()).toEqual(['played', 'played']);
  });

  it('队列满时丢弃优先级最低中最早进入的一项', async () => {
    const t = await setup();
    t.ctx.settings.set('queueMax', 3);
    for (let uid = 1; uid <= 5; uid++) t.live.emit(enter({ uid, guard: 3 }));
    expect(t.statuses()).toEqual(['played', 'dropped', 'queued', 'queued', 'queued']);
  });

  it('排队期间特效页全部掉线：轮到时记录为特效页不在线', async () => {
    const t = await setup();
    t.live.emit(enter({ uid: 1, guard: 3 }));
    t.live.emit(enter({ uid: 2, guard: 3 }));
    t.hub.removeOverlay([...(t.hub as unknown as { overlays: Set<never> }).overlays][0]!);
    vi.advanceTimersByTime(5000);
    expect(t.statuses()).toEqual(['played', 'no_overlay']);
  });

  it('紧急暂停：停止画面、清空队列；暂停期间的事件照常记录', async () => {
    const t = await setup();
    t.live.emit(enter({ uid: 1, guard: 3 }));
    t.live.emit(enter({ uid: 2, guard: 3 }));
    t.p.pause();
    expect(t.sock.sent.at(-1)).toEqual({ type: 'stop' });
    t.live.emit(enter({ uid: 3, guard: 3 }));
    expect(t.statuses()).toEqual(['played', 'paused', 'paused']);
    expect(t.p.snapshot()).toEqual({ playing: null, items: [] });
    t.p.resume();
    t.live.emit(enter({ uid: 4, guard: 3 }));
    expect(t.statuses().at(-1)).toBe('played');
  });

  it('清空队列：正在播的播完，排队的记录为已清空', async () => {
    const t = await setup();
    for (let uid = 1; uid <= 3; uid++) t.live.emit(enter({ uid, guard: 3 }));
    expect(t.p.clear()).toBe(2);
    expect(t.statuses()).toEqual(['played', 'cleared', 'cleared']);
    expect(t.sock.sent.some((m) => m.type === 'stop')).toBe(false);
  });

  it('测试播放插到队首，不写事件记录；特效页不在线、已暂停时拒绝', async () => {
    const t = await setup();
    const star = t.ctx.effects.list().find((e) => e.name === '星冕')!.id;
    t.live.emit(enter({ uid: 1, guard: 3 }));
    t.live.emit(enter({ uid: 2, guard: 3 }));
    t.p.test(star);
    expect(t.p.snapshot().items.map((i) => i.test)).toEqual([true, false]);
    vi.advanceTimersByTime(4500);
    expect(t.plays().at(-1)).toMatchObject({ test: true, text: '舰长 测试观众 驾临', effect: { name: '星冕' } });
    expect(t.events()).toHaveLength(2);
    t.p.pause();
    expect(() => t.p.test(star)).toThrow('已暂停');
    t.p.resume();
    t.hub.removeOverlay([...(t.hub as unknown as { overlays: Set<never> }).overlays][0]!);
    expect(() => t.p.test(star)).toThrow('特效页不在线');
  });

  it('上传的素材：推送文件地址、音效；播放用入队时的快照', async () => {
    const t = await setup();
    const e = t.ctx.effects.list().find((x) => x.name === '流光')!;
    const copy = t.ctx.effects.copy(e.id, { replaceRefs: true });
    t.live.emit(enter({ uid: 1, guard: 3 }));
    t.live.emit(enter({ uid: 2, guard: 3 }));
    t.ctx.effects.update(copy.id, { texts: { enter: ['改过的 {name}'] } });
    vi.advanceTimersByTime(5000);
    expect(t.plays().map((p) => p.text)).toEqual(['欢迎舰长 小星 登船', '欢迎舰长 小星 登船']);
  });
});

describe('其他', () => {
  it('弹幕、礼物、上舰先照常记录（第二期接规则）', async () => {
    const t = await setup();
    t.live.emit({ kind: 'danmu', id: 'd1', ts: Date.now(), viewer: v(), text: '晚上好' });
    t.live.emit({ kind: 'live', id: 'l1', ts: Date.now(), live: true });
    expect(t.events()).toMatchObject([{ kind: 'danmu', status: 'no_rule', payload: { text: '晚上好' } }]);
  });

  it('模拟：返回命中规则和结果，不入队、不记录、不影响冷却', async () => {
    const t = await setup();
    expect(t.p.simulate(v({ guard: 1 }))).toEqual({ rule: '进场 · 总督', effect: { id: expect.any(Number), name: '星冕' }, status: 'played' });
    expect(t.p.simulate(v({ guard: 1 }))).toMatchObject({ status: 'played' });
    expect(t.p.simulate(v({ uid: 5 }))).toEqual({ rule: null, effect: null, status: 'no_rule' });
    expect(t.events()).toHaveLength(0);
    expect(t.plays()).toHaveLength(0);
    t.live.emit(enter({ guard: 1 }));
    expect(t.statuses()).toEqual(['played']);
  });

  it('事件记录查询：按类型、状态、昵称或 UID 筛选，分页', async () => {
    const t = await setup();
    for (let uid = 1; uid <= 5; uid++) t.live.emit(enter({ uid, name: `观众${uid}`, guard: uid % 2 ? 3 : 0 }));
    t.live.emit({ kind: 'danmu', id: 'd1', ts: Date.now(), viewer: v({ uid: 3, name: '观众3' }), text: 'hi' });
    expect(t.ctx.log.query({ kind: 'danmu' }).events).toHaveLength(1);
    expect(t.ctx.log.query({ status: ['no_rule'] }).events).toHaveLength(3);
    expect(t.ctx.log.query({ q: '3' }).events.map((e) => e.kind)).toEqual(['danmu', 'enter']);
    expect(t.ctx.log.query({ q: '%' }).events).toHaveLength(0);
    const p1 = t.ctx.log.query({ limit: 4 });
    expect(p1.events).toHaveLength(4);
    const p2 = t.ctx.log.query({ limit: 4, cursor: p1.nextCursor! });
    expect(p2).toMatchObject({ nextCursor: null });
    expect(p2.events).toHaveLength(2);
  });

  it('清理：超过保留期的事件删除，7 天前的原始消息清空', async () => {
    const t = await setup();
    t.live.emit(enter({ uid: 1, guard: 3 }), { cmd: 'X' });
    vi.advanceTimersByTime(8 * 24 * 3600_000);
    t.live.emit(enter({ uid: 2, guard: 3 }), { cmd: 'Y' });
    expect(t.ctx.log.prune(Date.now(), 90)).toEqual({ deleted: 0, rawCleared: 1 });
    expect(t.ctx.log.prune(Date.now() + 100 * 24 * 3600_000, 0)).toEqual({ deleted: 0, rawCleared: 1 });
    expect(t.ctx.log.prune(Date.now() + 100 * 24 * 3600_000, 90)).toEqual({ deleted: 2, rawCleared: 0 });
  });
});
