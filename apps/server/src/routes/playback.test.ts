import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import { room } from '../db/schema.ts';
import { formFile, media, testApp } from '../testing.ts';

let close: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.unstubAllGlobals(); });

async function setup() {
  const t = await testApp();
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '主播' }).run();
  const req = await t.login();
  const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: t.password } });
  const session = login.cookies.find((c) => c.name === 'sf_session')!.value;
  const [output] = t.ctx.outputs.list();
  /** 连上 WebSocket，收集收到的消息和关闭码 */
  const connect = async (url: string, headers: Record<string, string> = {}) => {
    const msgs: Array<{ type: string; [k: string]: unknown }> = [];
    let resolveClose!: (c: number) => void;
    const closed = new Promise<number>((r) => (resolveClose = r));
    const ws: WebSocket = await t.app.injectWS(url, { headers }, {
      onInit: (s) => {
        s.on('message', (d) => msgs.push(JSON.parse(String(d))));
        s.on('close', (code) => resolveClose(code));
      },
    });
    close.push(() => ws.terminate());
    const waitFor = async (type: string) => {
      await vi.waitFor(() => expect(msgs.some((m) => m.type === type)).toBe(true));
      return msgs.filter((m) => m.type === type).at(-1)!;
    };
    return { ws, msgs, closed, waitFor };
  };
  const overlay = () => connect(`/ws/overlay?output=${output!.id}&key=${output!.key}`);
  return { ...t, req, session, output: output!, connect, overlay };
}

describe('特效页 WebSocket', () => {
  it('密钥正确：收到 hello（输出配置 + 预加载文件）；密钥错误直接断开', async () => {
    const t = await setup();
    const { effect } = (await t.req({ method: 'POST', url: '/api/assets', ...formFile('a.webm', media('alpha.webm')) })).json();
    const rules = (await t.req({ method: 'GET', url: '/api/rules/enter' })).json();
    rules.tiers.cap.effectId = effect.id;
    await t.req({ method: 'PUT', url: '/api/rules/enter', payload: rules });

    const o = await t.overlay();
    const hello = await o.waitFor('hello');
    expect(hello).toMatchObject({ config: { outputId: t.output.id, orient: 'portrait', width: 1080, height: 1920, safeTop: 12 }, preload: [effect.asset.url] });
    expect(t.ctx.hub.overlayCount()).toBe(1);

    const bad = await t.connect(`/ws/overlay?output=${t.output.id}&key=wrong`);
    expect(await bad.closed).toBe(4003);
    const none = await t.connect('/ws/overlay');
    expect(await none.closed).toBe(4003);
    expect(t.ctx.hub.overlayCount()).toBe(1);
  });

  it('修改输出设置时即时推送；重置密钥后断开旧连接', async () => {
    const t = await setup();
    const o = await t.overlay();
    await o.waitFor('hello');
    await t.req({ method: 'PUT', url: `/api/outputs/${t.output.id}`, payload: { scale: 130 } });
    expect(await o.waitFor('config')).toMatchObject({ config: { scale: 130 } });
    await t.req({ method: 'POST', url: `/api/outputs/${t.output.id}/reset-key` });
    expect(await o.closed).toBe(4003);
    expect(t.ctx.hub.overlayCount()).toBe(0);
  });

  it('上报运行环境；断开后下线（用真实端口：模拟连接收不到关闭）', async () => {
    const t = await setup();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/overlay?output=${t.output.id}&key=${t.output.key}`);
    close.push(() => ws.close());
    await new Promise((r) => ws.addEventListener('message', r, { once: true }));
    ws.send(JSON.stringify({ type: 'report', env: { app: 'obs', chrome: 127, webmAlpha: true } }));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'hack', x: 1 }));
    await vi.waitFor(() => expect(t.ctx.hub.overlayList()[0]?.env).toEqual({ app: 'obs', chrome: 127, webmAlpha: true }));
    const pb = (await t.req({ method: 'GET', url: '/api/playback' })).json();
    expect(pb.overlays).toHaveLength(1);
    ws.close();
    await vi.waitFor(() => expect(t.ctx.hub.overlayCount()).toBe(0), { timeout: 3000 });
  });
});

describe('管理后台 WebSocket', () => {
  it('需要登录；只接受同源页面', async () => {
    const t = await setup();
    const anon = await t.connect('/ws/admin');
    expect(await anon.closed).toBe(4401);
    const evil = await t.connect('/ws/admin', { cookie: `sf_session=${t.session}`, origin: 'https://evil.example', host: 'localhost:80' });
    expect(await evil.closed).toBe(4003);
  });

  it('连上后收到当前状态，之后实时收到事件、队列、特效页上下线', async () => {
    const t = await setup();
    const a = await t.connect('/ws/admin', { cookie: `sf_session=${t.session}` });
    expect(await a.waitFor('hello')).toMatchObject({ status: { paused: false, overlays: 0, room: { roomId: 30000 } }, queue: { playing: null, items: [] } });
    const o = await t.overlay();
    await o.waitFor('hello');
    await a.waitFor('overlays');
    t.ctx.settings.set('offlinePolicy', 'play');
    t.ctx.pipeline.handle({ kind: 'enter', id: 'x', ts: Date.now(), source: 'interact', viewer: { uid: 10001, name: '小星', guard: 3, isMod: false, mystery: false } });
    expect(await a.waitFor('event')).toMatchObject({ event: { uid: 10001, rule: '进场 · 舰长', status: 'queued' } });
    expect(await a.waitFor('event_status')).toMatchObject({ status: 'played' });
    expect(await a.waitFor('queue')).toMatchObject({ queue: { playing: { viewerName: '小星' } } });
    expect(await o.waitFor('play')).toMatchObject({ item: { text: '欢迎舰长 小星 登船' } });
  });
});

describe('播放控制接口', () => {
  it('暂停、恢复、清空；状态接口显示暂停和在线特效页', async () => {
    const t = await setup();
    const o = await t.overlay();
    await o.waitFor('hello');
    expect((await t.req({ method: 'POST', url: '/api/playback/pause' })).json()).toEqual({ paused: true });
    expect((await t.req({ method: 'GET', url: '/api/status' })).json()).toMatchObject({ paused: true, overlays: 1, queue: { playing: false, size: 0 } });
    const star = t.ctx.effects.list().find((e) => e.name === '星冕')!.id;
    const refused = await t.req({ method: 'POST', url: '/api/playback/test', payload: { effectId: star } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('暂停');
    await t.req({ method: 'POST', url: '/api/playback/resume' });
    const ok = await t.req({ method: 'POST', url: '/api/playback/test', payload: { effectId: star } });
    expect(ok.statusCode).toBe(200);
    expect(await o.waitFor('play')).toMatchObject({ item: { test: true, effect: { name: '星冕' } } });
    expect((await t.req({ method: 'POST', url: '/api/playback/clear' })).json()).toEqual({ cleared: 0 });
    expect((await t.req({ method: 'POST', url: '/api/playback/test', payload: { effectId: 9999 } })).statusCode).toBe(404);
  });

  it('模拟：返回命中规则和不播放的原因；没开播、暂停、特效页不在线时也能模拟，只给提醒', async () => {
    const t = await setup();
    const sim = (viewer: object) => t.req({ method: 'POST', url: '/api/simulate', payload: { viewer } }).then((r) => r.json());
    expect(await sim({ guard: 3 })).toMatchObject({ rule: '进场 · 舰长', effect: { name: '流光' }, status: 'played', notes: ['现在没开播，开播后才会真的播放', '特效页现在不在线，直播画面里看不到'] });
    t.ctx.settings.set('paused', true);
    expect((await sim({ guard: 3 })).notes[0]).toBe('现在是暂停状态，恢复播放后才会真的播放');
    t.ctx.settings.set('paused', false);
    t.ctx.settings.set('offlinePolicy', 'play');
    expect(await sim({ guard: 3 })).toMatchObject({ status: 'played', notes: ['特效页现在不在线，直播画面里看不到'] });
    expect(await sim({ medal: { level: 25 } })).toMatchObject({ rule: '进场 · 粉丝牌 21 级及以上', effect: { name: '霜玻' } });
    expect(await sim({ medal: { level: 25, own: false } })).toMatchObject({ rule: null, status: 'no_rule' });
    expect(await sim({ uid: 20000, isMod: true })).toMatchObject({ status: 'blacklist', notes: [] });
    expect((await t.req({ method: 'POST', url: '/api/simulate', payload: { viewer: { guard: 5 } } })).statusCode).toBe(400);
  });

  it('事件记录查询参数', async () => {
    const t = await setup();
    t.ctx.pipeline.handle({ kind: 'danmu', id: 'd', ts: Date.now(), viewer: { uid: 10001, name: '小星', guard: 0, isMod: false, mystery: false }, text: 'hi' });
    expect((await t.req({ method: 'GET', url: '/api/events?kind=danmu&status=no_rule,played&q=小星&limit=10' })).json()).toMatchObject({ events: [{ kind: 'danmu' }], nextCursor: null });
    expect((await t.req({ method: 'GET', url: '/api/events?status=bogus' })).statusCode).toBe(400);
    expect((await t.req({ method: 'GET', url: '/api/events?limit=1000' })).statusCode).toBe(400);
  });

  it('黑名单：添加时查昵称，重复添加 409，删除', async () => {
    const t = await setup();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { card: { mid: '10009', name: '捣乱的', face: '' } } })));
    const add = await t.req({ method: 'POST', url: '/api/blacklist', payload: { uid: 10009, note: '刷屏' } });
    expect(add.json()).toMatchObject({ uid: 10009, name: '捣乱的', note: '刷屏' });
    expect((await t.req({ method: 'POST', url: '/api/blacklist', payload: { uid: 10009 } })).statusCode).toBe(409);
    expect((await t.req({ method: 'GET', url: '/api/blacklist' })).json().blacklist).toHaveLength(1);
    expect(t.ctx.blacklist.reason(10009)).toBe('list');
    expect((await t.req({ method: 'DELETE', url: '/api/blacklist/10009' })).statusCode).toBe(200);
    expect(t.ctx.blacklist.reason(10009)).toBeNull();
    expect((await t.req({ method: 'DELETE', url: '/api/blacklist/10009' })).statusCode).toBe(404);
  });
});

describe('预览与统计', () => {
  it('预览：返回播放内容，不入队、不写记录', async () => {
    const t = await setup();
    const star = t.ctx.effects.list().find((e) => e.name === '星冕')!.id;
    const r = (await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: star, viewer: { name: '长夜未央', guard: 1, medalLevel: null } } })).json();
    expect(r).toMatchObject({ test: true, text: '总督 长夜未央 驾临', effect: { name: '星冕' }, viewer: { name: '长夜未央', guard: 1 } });
    expect(r.viewer.medal).toBeUndefined();
    expect(t.ctx.pipeline.snapshot().items).toHaveLength(0);
    expect(t.ctx.log.query({}).events).toHaveLength(0);
    expect((await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: 9999 } })).statusCode).toBe(404);
    // 预览还没保存的修改
    const d = (await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: star, draft: { texts: { enter: ['改了 {name}'] }, position: 'top', durationMs: 2000 } } })).json();
    expect(d).toMatchObject({ text: '改了 测试观众', effect: { position: 'top', durationMs: 2000 } });
    expect(t.ctx.effects.get(star).texts.enter).toEqual(['{guard} {name} 驾临']);
    expect((await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: star, draft: { name: 'x' } } })).statusCode).toBe(400);
  });

  it('今日统计：进场去重、播放次数、身份构成（每人取最后一次）', async () => {
    const t = await setup();
    t.ctx.settings.set('offlinePolicy', 'play');
    const v = (uid: number, p: object = {}) => ({ uid, name: `观众${uid}`, guard: 0 as const, isMod: false, mystery: false, ...p });
    const enter = (viewer: ReturnType<typeof v>) => t.ctx.pipeline.handle({ kind: 'enter', id: `e${Math.random()}`, ts: Date.now(), source: 'interact', viewer });
    enter(v(1, { guard: 3 }));
    enter(v(2, { isMod: true }));
    enter(v(3, { medal: { name: '牌', level: 5, anchorUid: 20000 } }));
    enter(v(4, { medal: { name: '牌', level: 5, anchorUid: 999 } }));
    enter(v(5));
    const s = (await t.req({ method: 'GET', url: '/api/stats/today' })).json();
    expect(s).toMatchObject({ enterUnique: 5, composition: { gov: 0, adm: 0, cap: 1, mod: 1, fan: 1, nor: 2 } });
    expect(s.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('按时区算当天 0 点', async () => {
    const { dayStart } = await import('./playback.ts');
    expect(dayStart('2026-09-25', 'Asia/Shanghai')).toBe(Date.parse('2026-09-25T00:00:00+08:00'));
    expect(dayStart('2026-09-25', 'UTC')).toBe(Date.parse('2026-09-25T00:00:00Z'));
  });
});
