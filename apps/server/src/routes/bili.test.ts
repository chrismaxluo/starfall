import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importSpikeAccount } from '../context.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.unstubAllGlobals(); });
const setup = async () => { const t = await testApp(); close.push(() => t.app.close()); return t; };

describe('B 站账号与直播间接口', () => {
  it('未登录时账号状态为未登录；状态接口汇总连接、账号、直播间', async () => {
    const { login } = await setup();
    const req = await login();
    expect((await req({ method: 'GET', url: '/api/bili/account' })).json()).toEqual({ loggedIn: false });
    const s = (await req({ method: 'GET', url: '/api/status' })).json();
    expect(s).toMatchObject({ account: { loggedIn: false }, room: null, paused: false, live: { live: false } });
  });

  it('设置房间号：B 站报错时返回 502 和中文说明', async () => {
    const { login } = await setup();
    const req = await login();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 60004, message: '直播间不存在' })));
    const res = await req({ method: 'PUT', url: '/api/room', payload: { id: 999 } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toContain('直播间不存在');
  });

  it('设置房间号参数校验', async () => {
    const { login } = await setup();
    const req = await login();
    expect((await req({ method: 'PUT', url: '/api/room', payload: { id: 'abc' } })).statusCode).toBe(400);
  });

  it('修改设置：只接受已知的键和取值', async () => {
    const { login } = await setup();
    const req = await login();
    const ok = await req({ method: 'PUT', url: '/api/settings', payload: { cooldownMode: 'oncePerLive', queueMax: 15 } });
    expect(ok.json()).toMatchObject({ cooldownMode: 'oncePerLive', queueMax: 15, connectMode: 'live_only' });
    expect((await req({ method: 'PUT', url: '/api/settings', payload: { unknown: 1 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/settings', payload: { queueMax: 100 } })).statusCode).toBe(400);
  });

  it('新手引导：默认没完成，完成或跳过后记住；导出配置时不包含', async () => {
    const t = await setup();
    const req = await t.login();
    expect((await req({ method: 'GET', url: '/api/settings' })).json().onboarded).toBe(false);
    expect((await req({ method: 'PUT', url: '/api/settings', payload: { onboarded: true } })).json().onboarded).toBe(true);
    expect(t.ctx.io.export().settings).not.toHaveProperty('onboarded');
  });
});

describe('导入技术验证时的登录信息', () => {
  it('加密导入数据库后删除明文文件', async () => {
    const t = await setup();
    const file = path.join(t.dataDir, 'bili-account.json');
    fs.writeFileSync(file, JSON.stringify({ cookies: { SESSDATA: 'secret-value', DedeUserID: '10001', bili_jct: 'c' }, refreshToken: 'rt', sessdataExpires: 'Wed, 24 Mar 2027 19:01:44 GMT' }));
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, data: { card: { mid: '10001', name: '测试', face: 'f' } } })));
    expect(await importSpikeAccount(t.ctx)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(t.ctx.account.status()).toMatchObject({ loggedIn: true, uid: 10001, name: '测试', expiresAt: Date.parse('Wed, 24 Mar 2027 19:01:44 GMT') });
    const row = t.ctx.db.$client.prepare('select cookies_enc from account').get() as { cookies_enc: string };
    expect(row.cookies_enc).not.toContain('secret-value');
    expect(t.ctx.account.http()?.cookies.SESSDATA).toBe('secret-value');
  });
});
