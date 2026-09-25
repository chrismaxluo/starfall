import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });
const setup = async () => { const t = await testApp(); close.push(() => t.app.close()); return t; };

describe('健康检查', () => {
  it('不需要登录', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, name: '星临' });
  });
});

describe('后台登录（F-UI-10）', () => {
  it('未登录访问接口返回 401 和中文说明', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized', message: '请先登录' } });
  });

  it('密码错误返回 401；正确则下发 HttpOnly、SameSite=Strict 的会话 Cookie', async () => {
    const { app, password } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
    expect(ok.statusCode).toBe(200);
    const c = ok.cookies.find((x) => x.name === 'sf_session')!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
  });

  it('登录后可以访问；修改密码后旧会话失效', async () => {
    const { app, password, login } = await setup();
    const req = await login();
    expect((await req({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(200);
    const bad = await req({ method: 'PUT', url: '/api/auth/password', payload: { current: password, next: 'short' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('至少 8 位');
    expect((await req({ method: 'PUT', url: '/api/auth/password', payload: { current: password, next: 'new-password-1' } })).statusCode).toBe(200);
    expect((await req({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'new-password-1' } })).statusCode).toBe(200);
  });

  it('登录接口限流：每分钟最多 5 次', async () => {
    const { app } = await setup();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('修改类接口不接受表单格式（防跨站请求伪造）', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'password=x' });
    expect(res.statusCode).toBe(415);
  });
});

describe('特效页静态文件', () => {
  it('构建后由服务提供；入口页不缓存，带哈希的资源长期缓存', async () => {
    const fsm = await import('node:fs');
    const pathm = await import('node:path');
    const { testApp } = await import('./testing.ts');
    const t = await testApp();
    const dist = t.ctx.config.overlayDist;
    if (!fsm.existsSync(pathm.join(dist, 'index.html'))) return void (await t.app.close());
    const page = await t.app.inject({ method: 'GET', url: '/overlay/?output=1&key=x' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-cache');
    const js = /src="\/overlay\/(assets\/[^"]+\.js)"/.exec(page.body)![1]!;
    const asset = await t.app.inject({ method: 'GET', url: `/overlay/${js}` });
    expect(asset.headers['cache-control']).toContain('immutable');
    const redirect = await t.app.inject({ method: 'GET', url: '/overlay?output=1&key=x' });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('/overlay/?output=1&key=x');
    await t.app.close();
  });
});
