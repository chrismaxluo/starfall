import { afterEach, describe, expect, it, vi } from 'vitest';
import { DANMU_WHO_ALL, MUSIC_DEFAULTS } from '@starfall/shared';
import type { MusicState, PlayItem, ServerToOverlay, StdEvent, Viewer } from '@starfall/shared';
import type { NeteaseSong } from '@starfall/music';
import { room } from '../db/schema.ts';
import { testApp } from '../testing.ts';
import { Hub } from './hub.ts';
import type { LiveStatus } from './live.ts';
import { MUSIC_GAP_MS, MUSIC_LOAD_TIMEOUT_MS, MusicService, effectHasSound } from './music.ts';

const ANCHOR = 20000;

function fakeLive(live = true) {
  const events = new Set<(ev: StdEvent, raw: unknown) => void>();
  const status = new Set<(s: LiveStatus) => void>();
  const state = { live };
  const snap = () => ({ live: state.live, sessionId: 1, liveSince: 0, connection: 'connected' as const, connectionDetail: null, reason: 'ok' as const, loginInvalid: false, adminCount: 0 }) as unknown as LiveStatus;
  return {
    state,
    onEvent: (fn: (ev: StdEvent, raw: unknown) => void) => (events.add(fn), () => events.delete(fn)),
    onStatus: (fn: (s: LiveStatus) => void) => (status.add(fn), () => status.delete(fn)),
    status: snap,
    emit: (ev: StdEvent) => { for (const fn of events) fn(ev, undefined); },
    setLive: (v: boolean) => { state.live = v; for (const fn of status) fn(snap()); },
  };
}

function fakeSock() {
  const sent: ServerToOverlay[] = [];
  return { sent, send(d: string) { sent.push(JSON.parse(d)); }, close() {} };
}

const ns = (id: number, name: string, artists: string[], p: Partial<NeteaseSong> = {}): NeteaseSong => ({ id, name, alias: [], artists, artistAlias: [], album: '', cover: `https://p1.music.126.net/${id}.jpg`, durationMs: 200_000, fee: 0, playable: true, ...p });

function fakeNetease(catalog: NeteaseSong[]) {
  const calls = { url: 0 };
  const urls = new Map<number, string | null>();
  return {
    calls,
    urls,
    client: {
      search: async (q: string) => catalog.filter((s) => q.split(/\s+/).some((w) => s.name.includes(w) || s.artists.some((a) => a.includes(w)))),
      songUrl: async (id: number) => {
        calls.url++;
        const u = urls.has(id) ? urls.get(id)! : `https://m701.music.126.net/${id}-${calls.url}.mp3`;
        return u ? { url: u, br: 320000 } : null;
      },
      lyric: async () => ({ lrc: '[00:01.00]第一句\n[00:05.00]第二句', trans: '' }),
    },
  };
}

let seq = 0;
const v = (p: Partial<Viewer> = {}): Viewer => ({ uid: 10001, name: '小星', guard: 0, isMod: false, mystery: false, ...p });
const danmu = (text: string, p: Partial<Viewer> = {}): StdEvent => ({ kind: 'danmu', id: `d${++seq}`, ts: Date.now(), viewer: v(p), text });
/** 等异步的找歌、拿地址做完 */
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };

let cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const c of cleanup) await c(); cleanup = []; vi.useRealTimers(); });

const CATALOG = [ns(1, '起风了', ['买辣椒也用券']), ns(2, '孤勇者', ['陈奕迅']), ns(3, '平凡之路', ['朴树']), ns(4, '会员歌', ['某人'], { playable: false, fee: 1 }), ns(5, '晴天(深情版)', ['Lucky小爱'])];

async function setup(opts: { live?: boolean; settings?: Partial<typeof MUSIC_DEFAULTS>; player?: boolean } = {}) {
  const t = await testApp();
  cleanup.push(() => t.app.close());
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-10-10T20:00:00+08:00') });
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: ANCHOR, anchorName: '主播' }).run();
  const live = fakeLive(opts.live ?? true);
  const hub = new Hub();
  const ne = fakeNetease(CATALOG);
  let playing: PlayItem | null = null;
  const effectListeners = new Set<() => void>();
  const effects = { playingItem: () => playing, onQueueChange: (fn: () => void) => (effectListeners.add(fn), () => effectListeners.delete(fn)) };
  const setEffect = (item: PlayItem | null) => { playing = item; for (const fn of effectListeners) fn(); };
  const m = new MusicService({ ...t.ctx, live, hub, account: { client: () => ne.client as never, vip: () => false }, library: t.ctx.musicLibrary, fx: effects });
  m.updateSettings({ ...MUSIC_DEFAULTS, enabled: true, userCdSec: 0, ...opts.settings });
  m.start();
  cleanup.push(() => m.stop());
  const output = t.ctx.outputs.list()[0]!;
  const sock = fakeSock();
  let client: ReturnType<Hub['addOverlay']> | null = null;
  const connect = () => (client = hub.addOverlay(sock, output, [], Date.now(), 'music'));
  if (opts.player !== false) connect();
  const last = (s = sock): { state: MusicState; player: boolean } => s.sent.filter((x) => x.type === 'music').at(-1) as never;
  const notices = () => m.snapshot().notices.map((n) => `${n.ok ? '✓' : '✗'} ${n.who}：${n.text}`).reverse();
  const queue = () => m.snapshot().queue.map((i) => i.song.name);
  const say = async (text: string, p: Partial<Viewer> = {}) => { live.emit(danmu(text, p)); await settle(); };
  return { ...t, m, live, hub, ne, sock, client: () => client!, connect, last, notices, queue, say, setEffect, output };
}

describe('弹幕点歌', () => {
  it('点歌 → 找歌 → 交给出声的窗口；只有它拿到播放地址，歌词一起发', async () => {
    const t = await setup();
    const view = fakeSock();
    t.hub.addOverlay(view, t.output, [], Date.now() + 1, 'music', true);
    await t.say('点歌 起风了');
    expect(t.notices()).toEqual(['✓ 小星：点了《起风了》，马上播放']);
    const s = t.last().state;
    expect(t.last().player).toBe(true);
    expect(s.now).toMatchObject({ item: { song: { source: 'netease', id: '1', name: '起风了', artists: '买辣椒也用券', cover: 'https://p1.music.126.net/1.jpg?param=300y300' }, by: { name: '小星' } }, url: 'https://m701.music.126.net/1-1.mp3', paused: true, lyric: [{ t: 1000, text: '第一句' }, { t: 5000, text: '第二句' }] });
    // 浏览器查看页只显示，拿不到地址
    expect(t.last(view).player).toBe(false);
    expect(t.last(view).state.now?.url).toBeUndefined();
    // 不是点歌的弹幕、只写了指令的不理
    await t.say('主播晚上好');
    await t.say('点歌');
    expect(t.notices()).toHaveLength(1);
  });

  it('播放：开始了位置往前走，放完停一下放下一首；切歌、取消点歌', async () => {
    const t = await setup();
    await t.say('点歌 起风了');
    await t.say('点歌 孤勇者', { uid: 2, name: '阿二' });
    await t.say('点歌 平凡之路', { uid: 3, name: '阿三' });
    expect(t.notices().slice(1)).toEqual(['✓ 阿二：点了《孤勇者》，排在第 2 首', '✓ 阿三：点了《平凡之路》，排在第 3 首']);
    const id = t.last().state.now!.item.id;
    t.m.playerStarted(t.client(), id, 1);
    vi.advanceTimersByTime(3000);
    expect(t.m.state().now).toMatchObject({ paused: false, posMs: 3000 });
    t.m.playerPos(t.client(), id, 2500);
    expect(t.m.state().now?.posMs).toBe(2500);
    // 不是出声的窗口发来的不算
    t.m.playerEnded({}, id);
    expect(t.m.state().now?.item.id).toBe(id);
    t.m.playerEnded(t.client(), id);
    expect(t.m.state().now).toBeNull();
    vi.advanceTimersByTime(MUSIC_GAP_MS);
    await settle();
    expect(t.m.state().now?.item.song.name).toBe('孤勇者');
    // 别人发「切歌」不算；点这首歌的人能切
    await t.say('切歌', { uid: 3, name: '阿三' });
    expect(t.m.state().now?.item.song.name).toBe('孤勇者');
    await t.say('切歌', { uid: 2, name: '阿二' });
    expect(t.notices().at(-1)).toBe('✓ 阿二：切掉了《孤勇者》');
    // 取消点歌：撤掉自己还没放的
    await t.say('取消点歌', { uid: 3, name: '阿三' });
    expect(t.notices().at(-1)).toBe('✓ 阿三：取消了《平凡之路》');
    vi.advanceTimersByTime(MUSIC_GAP_MS);
    await settle();
    expect(t.m.state().now).toBeNull();
    expect(t.m.history().map((h) => `${h.item.song.name} ${h.status}`)).toEqual(['平凡之路 cancelled', '孤勇者 skipped', '起风了 played']);
  });

  it('规则：谁能点、不让点的人、每人几首、间隔、列表满、重复的歌', async () => {
    const t = await setup({ player: false, settings: { who: { ...DANMU_WHO_ALL, all: false, guards: [1, 2, 3] }, userCdSec: 60, queueMax: 3, bannedUids: [7] } });
    await t.say('点歌 起风了');
    expect(t.notices().at(-1)).toBe('✗ 小星：没有点歌的权限');
    await t.say('点歌 起风了', { guard: 3 });
    await t.say('点歌 孤勇者', { guard: 3 });
    expect(t.notices().at(-1)).toBe('✗ 小星：你点的歌还没放，放完再点');
    // 主播不受限制
    await t.say('点歌 孤勇者', { uid: ANCHOR, name: '主播' });
    await t.say('点歌 起风了', { uid: 5, name: '阿五', guard: 2 });
    expect(t.notices().at(-1)).toBe('✗ 阿五：《起风了》已经在列表里了');
    await t.say('点歌 平凡之路', { uid: 5, name: '阿五', guard: 2 });
    await t.say('点歌 平凡之路', { uid: 6, name: '阿六', guard: 2 });
    expect(t.notices().at(-1)).toBe('✗ 阿六：列表满了（3 首），等放完几首再点');
    await t.say('点歌 起风了', { uid: 7, name: '阿七', guard: 1 });
    expect(t.notices().at(-1)).toBe('✗ 阿七：没有点歌的权限');
    // 间隔：放完了也要等够时间
    for (const it of t.m.snapshot().queue) t.m.remove(it.id);
    await t.say('点歌 平凡之路', { guard: 3 });
    expect(t.notices().at(-1)).toMatch(/^✗ 小星：点得太快了，\d+ 秒后再点$/);
  });

  it('找不到、放不了、歌手不对时说明原因', async () => {
    const t = await setup();
    await t.say('点歌 不存在的歌');
    await t.say('点歌 会员歌', { uid: 2, name: '阿二' });
    await t.say('点歌 晴天 周杰伦', { uid: 3, name: '阿三' });
    expect(t.notices()).toEqual(['✗ 小星：没有找到「不存在的歌」', '✗ 阿二：《会员歌》需要会员或者暂时放不了', '✗ 阿三：没有找到「周杰伦」的版本']);
  });

  it('大航海点的歌排在普通观众前面', async () => {
    const t = await setup({ player: false });
    await t.say('点歌 起风了', { uid: 1 });
    await t.say('点歌 孤勇者', { uid: 2 });
    await t.say('点歌 平凡之路', { uid: 3, guard: 3 });
    expect(t.queue()).toEqual(['平凡之路', '起风了', '孤勇者']);
    t.m.reorder([t.m.snapshot().queue[2]!.id]);
    expect(t.queue()).toEqual(['孤勇者', '平凡之路', '起风了']);
  });

  it('没有点歌窗口、后台暂停、没开播时不放；正在放的停在原处，恢复后接着放', async () => {
    const t = await setup({ player: false, live: false });
    await t.say('点歌 起风了');
    expect(t.m.state()).toMatchObject({ hold: 'offline', now: null, total: 1 });
    // 没开播时在后台点「继续」：放（下播前不再自动暂停）
    t.m.setPaused(false);
    expect(t.m.state().hold).toBe('no_player');
    t.connect();
    await settle();
    const id = t.m.state().now!.item.id;
    t.m.playerStarted(t.client(), id, 1);
    vi.advanceTimersByTime(10_000);
    t.m.setPaused(true);
    expect(t.last().state).toMatchObject({ hold: 'manual', now: { paused: true, posMs: 10_000 } });
    vi.advanceTimersByTime(5000);
    t.m.setPaused(false);
    vi.advanceTimersByTime(1000);
    expect(t.m.state().now?.posMs).toBe(11_000);
    // 开播又下播：自动暂停
    t.live.setLive(true);
    t.live.setLive(false);
    expect(t.m.state()).toMatchObject({ hold: 'offline', now: { paused: true } });
    t.live.setLive(true);
    expect(t.m.state().hold).toBeNull();
  });

  it('出声的窗口换了：新窗口从停住的地方重新加载', async () => {
    const t = await setup();
    await t.say('点歌 起风了');
    const id = t.m.state().now!.item.id;
    t.m.playerStarted(t.client(), id, 1);
    vi.advanceTimersByTime(4000);
    t.hub.removeOverlay(t.client());
    expect(t.m.state()).toMatchObject({ hold: 'no_player', now: { posMs: 4000, paused: true } });
    const sock2 = fakeSock();
    const c2 = t.hub.addOverlay(sock2, t.output, [], Date.now(), 'music');
    expect(t.last(sock2)).toMatchObject({ player: true, state: { now: { posMs: 4000, paused: true, url: expect.any(String) } } });
    t.m.playerStarted(c2, id, 1);
    vi.advanceTimersByTime(1000);
    expect(t.m.state().now?.posMs).toBe(5000);
  });

  it('放不了：网易云的先重新拿一次地址，还不行就跳过；窗口一直不出声也算放不了', async () => {
    const t = await setup();
    await t.say('点歌 起风了');
    await t.say('点歌 孤勇者', { uid: 2, name: '阿二' });
    const id = t.m.state().now!.item.id;
    t.m.playerError(t.client(), id, 1, 'MEDIA_ERR_NETWORK');
    await settle();
    expect(t.last().state.now).toMatchObject({ load: 2, url: 'https://m701.music.126.net/1-2.mp3' });
    // 旧的那次加载报的错不算
    t.m.playerError(t.client(), id, 1, '旧的');
    t.m.playerError(t.client(), id, 2, 'MEDIA_ERR_NETWORK');
    await settle();
    expect(t.notices().at(-1)).toBe('✗ 小星：《起风了》放不了，已跳过');
    vi.advanceTimersByTime(MUSIC_GAP_MS);
    await settle();
    expect(t.m.state().now?.item.song.name).toBe('孤勇者');
    // 一直不出声
    t.ne.urls.set(2, null);
    vi.advanceTimersByTime(MUSIC_LOAD_TIMEOUT_MS + 2000);
    await settle();
    expect(t.notices().at(-1)).toBe('✗ 阿二：《孤勇者》放不了，已跳过');
    expect(t.m.history()[0]).toMatchObject({ status: 'failed', note: '20 秒内没有开始播放' });
  });

  it('拿不到播放地址（会员歌、没有版权）：跳过，说明原因', async () => {
    const t = await setup();
    t.ne.urls.set(1, null);
    await t.say('点歌 起风了');
    expect(t.notices()).toEqual(['✓ 小星：点了《起风了》，马上播放', '✗ 小星：《起风了》放不了（可能需要会员，或者暂时没有版权），已跳过']);
    expect(t.m.state().now).toBeNull();
  });

  it('有带声音的特效在播：让出声的窗口把音乐调小，播完恢复', async () => {
    const t = await setup({ settings: { duckPct: 25 } });
    const item = { effect: { volume: 80, sound: { url: '/files/a.mp3' }, visual: { type: 'builtin_style', style: 'frost' } } } as unknown as PlayItem;
    t.setEffect(item);
    t.setEffect(item);
    t.setEffect(null);
    expect(t.sock.sent.filter((x) => x.type === 'music_duck')).toEqual([{ type: 'music_duck', on: true, pct: 25 }, { type: 'music_duck', on: false, pct: 25 }]);
    expect(effectHasSound(item)).toBe(true);
    expect(effectHasSound({ effect: { volume: 0, sound: { url: 'x' }, visual: { type: 'builtin_style', style: 'x' } } } as unknown as PlayItem)).toBe(false);
    expect(effectHasSound({ effect: { volume: 50, sound: null, visual: { type: 'asset', kind: 'video' } } } as unknown as PlayItem)).toBe(true);
    expect(effectHasSound({ effect: { volume: 50, sound: null, visual: { type: 'asset', kind: 'image' } } } as unknown as PlayItem)).toBe(false);
  });

  it('后台：模拟点歌、直接加歌（不受规则限制）、清空；重启后正在放的回到最前面', async () => {
    const t = await setup({ player: false, settings: { who: { ...DANMU_WHO_ALL, all: false, mod: true } } });
    expect(await t.m.simulate('点歌 起风了')).toMatchObject({ ok: false, text: '没有点歌的权限' });
    expect(await t.m.simulate('你好')).toMatchObject({ ok: false, text: '点歌弹幕要以「点歌」开头，后面写歌名' });
    t.m.add({ source: 'netease', id: '3', name: '平凡之路', artists: '朴树', durationMs: 1000 });
    t.m.add({ source: 'netease', id: '2', name: '孤勇者', artists: '陈奕迅', durationMs: 1000 }, true);
    expect(() => t.m.add({ source: 'netease', id: '2', name: '孤勇者', artists: '陈奕迅', durationMs: 1000 })).toThrow('已经在列表里了');
    expect(t.m.snapshot().queue.map((i) => `${i.song.name} ${i.by.name}`)).toEqual(['孤勇者 主播', '平凡之路 主播']);
    // 假装上次正在放
    t.ctx.db.$client.prepare("update music_requests set status = 'playing' where name = '平凡之路'").run();
    const again = new MusicService({ ...t.ctx, live: t.live, hub: t.hub, account: { client: () => t.ne.client as never, vip: () => false }, library: t.ctx.musicLibrary });
    again.start();
    cleanup.push(() => again.stop());
    expect(again.snapshot().queue.map((i) => i.song.name)).toEqual(['平凡之路', '孤勇者']);
    expect(again.clear()).toBe(2);
    expect(again.snapshot().queue).toEqual([]);
  });
});
