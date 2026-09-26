import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LiveClientOptions } from '@starfall/bili';
import type { StdEvent } from '@starfall/shared';
import { openDb } from '../db/index.ts';
import { account, liveSessions, room } from '../db/schema.ts';
import { seed } from '../db/seed.ts';
import { BiliAccount } from './bili-account.ts';
import { LiveService } from './live.ts';
import type { LiveDeps } from './live.ts';
import { RoomStore } from './room.ts';
import { Secret } from './secret.ts';
import { SettingsStore } from './settings.ts';

function setup(opts: { loggedIn?: boolean; room?: boolean; live?: boolean } = {}) {
  const db = openDb(':memory:');
  seed(db);
  const secret = new Secret(crypto.randomBytes(32));
  if (opts.loggedIn ?? true) db.insert(account).values({ id: 1, uid: 10001, cookiesEnc: secret.encrypt(JSON.stringify({ SESSDATA: 's', DedeUserID: '10001', bili_jct: 'c', buvid3: 'B3' })) }).run();
  if (opts.room ?? true) db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000 }).run();
  const state = { live: opts.live ?? false, liveSince: null as number | null, pollCookies: [] as string[], clients: [] as Array<{ opts: LiveClientOptions; stopped: boolean }> };
  let t = 1_000_000;
  const deps: LiveDeps = {
    getRoomInit: async (http) => { state.pollCookies.push(JSON.stringify(http.cookies)); return { roomId: 30000, shortId: 0, anchorUid: 20000, liveStatus: state.live ? 1 : 0, isPortrait: true, liveSince: state.liveSince }; },
    getRoomAdmins: async () => [{ uid: 555, name: '房管', face: '' }],
    getDanmuInfo: async () => ({ token: 't', hosts: [{ host: 'h', wssPort: 443 }] }),
    createClient: (o) => { const c = { opts: o, stopped: false }; state.clients.push(c); return { start: () => {}, stop: () => { c.stopped = true; }, state: 'connected' as const }; },
    now: () => (t += 1000),
  };
  const acc = new BiliAccount(db, secret);
  const roomStore = new RoomStore(db);
  const settings = new SettingsStore(db);
  const svc = new LiveService({ db, account: acc, room: roomStore, settings }, deps);
  const events: StdEvent[] = [];
  svc.onEvent((e) => events.push(e));
  const active = () => state.clients.filter((c) => !c.stopped);
  return { db, svc, state, settings, events, active, roomStore };
}

describe('只在开播时连接（F-BL-10）', () => {
  it('未开播时不连接，查询状态时不带登录信息', async () => {
    const { svc, state, active } = setup({ live: false });
    await svc.start(); svc.stop();
    expect(active()).toHaveLength(0);
    expect(svc.status()).toMatchObject({ live: false, reason: 'offline' });
    expect(state.pollCookies.every((c) => !c.includes('SESSDATA'))).toBe(true);
  });

  it('开播后用账号连接，新建直播场次，拉取房管名单', async () => {
    const { svc, db, active } = setup({ live: true });
    await svc.start();
    expect(active()).toHaveLength(1);
    expect(active()[0]!.opts).toMatchObject({ roomId: 30000, uid: 10001, buvid: 'B3' });
    expect(svc.status()).toMatchObject({ live: true, reason: 'ok', adminCount: 1 });
    expect(svc.isMod(555)).toBe(true);
    expect(db.select().from(liveSessions).all()).toHaveLength(1);
    svc.stop();
  });

  it('收到下播消息：结束场次并断开连接', async () => {
    const { svc, db, active, state } = setup({ live: true });
    await svc.start();
    state.live = false;
    active()[0]!.opts.onMessage({ cmd: 'PREPARING', roomid: '30000' });
    await new Promise((r) => setTimeout(r, 0));
    expect(active()).toHaveLength(0);
    expect(svc.status().live).toBe(false);
    expect(db.select().from(liveSessions).all()[0]!.endedAt).not.toBeNull();
    svc.stop();
  });

  it('"始终连接"时未开播也保持连接；收到开播消息后新建场次', async () => {
    const { svc, settings, active, db } = setup({ live: false });
    settings.set('connectMode', 'always');
    await svc.start();
    expect(active()).toHaveLength(1);
    expect(db.select().from(liveSessions).all()).toHaveLength(0);
    active()[0]!.opts.onMessage({ cmd: 'LIVE' });
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.status()).toMatchObject({ live: true });
    expect(db.select().from(liveSessions).all()).toHaveLength(1);
    svc.stop();
  });

  it('排练模式（未开播照常播放）需要连接', async () => {
    const { svc, settings, active } = setup({ live: false });
    settings.set('offlinePolicy', 'play');
    await svc.start();
    expect(active()).toHaveLength(1);
    svc.stop();
  });

  it('没有登录、没有设置房间时不连接，并说明原因', async () => {
    const a = setup({ loggedIn: false, live: true });
    await a.svc.start(); a.svc.stop();
    expect(a.active()).toHaveLength(0);
    expect(a.svc.status().reason).toBe('not_logged_in');
    const b = setup({ room: false, live: true });
    await b.svc.start(); b.svc.stop();
    expect(b.svc.status().reason).toBe('no_room');
  });

  it('服务重启时上一场还没结束：继续使用原来的场次', async () => {
    const { svc, db } = setup({ live: true });
    db.insert(liveSessions).values({ startedAt: 123 }).run();
    await svc.start(); svc.stop();
    expect(svc.status()).toMatchObject({ sessionId: 1, liveSince: 123 });
    expect(db.select().from(liveSessions).all()).toHaveLength(1);
  });

  it('服务重启时有没结束的场次，但比这一场的开播时间早：是上一场，关掉后新建', async () => {
    const { svc, db, state } = setup({ live: true });
    db.insert(liveSessions).values({ startedAt: 123 }).run();
    state.liveSince = 500_000;
    await svc.start(); svc.stop();
    const rows = db.select().from(liveSessions).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.endedAt).toBe(500_000);
    expect(svc.status()).toMatchObject({ sessionId: 2 });
  });

  it('同时触发两次连接检查：只建一个连接；停止后不再连接', async () => {
    const { svc, state, active } = setup({ live: true });
    await svc.start();
    expect(active()).toHaveLength(1);
    state.live = true;
    await Promise.all([svc.reconcile(), svc.reconcile(), svc.poll()]);
    expect(active()).toHaveLength(1);
    svc.stop();
    await svc.reconcile();
    expect(active()).toHaveLength(0);
  });

  it('服务重启时已经下播：把没结束的场次关掉', async () => {
    const { svc, db } = setup({ live: false });
    db.insert(liveSessions).values({ startedAt: 123 }).run();
    await svc.start(); svc.stop();
    expect(db.select().from(liveSessions).all()[0]!.endedAt).not.toBeNull();
  });
});

describe('消息转发', () => {
  it('解析后的事件交给监听者；进场按房管名单识别；解析失败计数', async () => {
    const { svc, active, events } = setup({ live: true });
    await svc.start();
    const onMessage = active()[0]!.opts.onMessage;
    onMessage({ cmd: 'DANMU_MSG', info: [[0, 0, 0, 0, 1000], '你好', [555, '房管A', 0], [], [], [], 0, 0] });
    onMessage({ cmd: 'INTERACT_WORD_V2', data: { pb: '////' } });
    onMessage({ cmd: 'ONLINE_RANK_COUNT' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'danmu', text: '你好', viewer: { uid: 555, isMod: true } });
    expect(svc.parseErrors).toBe(1);
    svc.stop();
  });
});
