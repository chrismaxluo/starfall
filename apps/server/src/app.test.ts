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

  it('地址里的字母写成 %xx 编码也绕不过登录', async () => {
    const { app } = await setup();
    for (const url of ['/%61pi/outputs', '/%61%70%69/auth/me', '/a%70i/backup/export', '/api/%6futputs', '/api/nope', '/%61pi/auth%2flogin']) {
      const res = await app.inject({ method: 'GET', url });
      expect([401, 400], url).toContain(res.statusCode);
    }
    expect((await app.inject({ method: 'POST', url: '/%61pi/outputs/1/reset-key', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/%61pi/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/x%ZZ' })).statusCode).toBe(400);
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

  it('退出登录后，原来的 Cookie 不能再用', async () => {
    const { login } = await setup();
    const req = await login();
    expect((await req({ method: 'POST', url: '/api/auth/logout', payload: {} })).statusCode).toBe(200);
    expect((await req({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
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

describe('桌面版（STARFALL_DESKTOP=1）', () => {
  const desktop = async () => {
    const t = await testApp({}, { STARFALL_DESKTOP: '1', STARFALL_HOST: '0.0.0.0', STARFALL_TRUST_PROXY: '127.0.0.1' });
    close.push(() => t.app.close());
    return t;
  };

  it('只听本机地址、不信任代理；不生成初始密码', async () => {
    const { ctx, dataDir } = await desktop();
    expect(ctx.config).toMatchObject({ desktop: true, host: '127.0.0.1', trustProxy: false });
    expect(ctx.initialPassword).toBeNull();
    const fs = await import('node:fs');
    expect(fs.existsSync(`${dataDir}/initial-password.txt`)).toBe(false);
  });

  it('后台不用登录', async () => {
    const { app } = await desktop();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { host: '127.0.0.1:17520' } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ ok: true, desktop: true });
    expect((await app.inject({ method: 'GET', url: '/api/outputs', headers: { host: 'localhost:17520' } })).statusCode).toBe(200);
  });

  it('不是本机地址的请求一律拒绝（防 DNS 重绑定），特效页和素材也一样', async () => {
    const { app } = await desktop();
    for (const url of ['/api/outputs', '/overlay/', '/files/x.png', '/']) {
      expect((await app.inject({ method: 'GET', url, headers: { host: 'evil.example:17520' } })).statusCode, url).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { host: '[::1]:17520' } })).statusCode).toBe(200);
  });

  it('接口只接受同源页面：其他网站发来的请求拒绝', async () => {
    const { app } = await desktop();
    const host = '127.0.0.1:17520';
    const req = (headers: Record<string, string>, url = '/api/playback/clear') => app.inject({ method: 'POST', url, headers: { host, ...headers } });
    expect((await req({ origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await req({ origin: 'http://127.0.0.1:9999' })).statusCode).toBe(403);
    expect((await req({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await req({ 'sec-fetch-site': 'same-site' })).statusCode).toBe(403);
    expect((await req({ origin: 'null' })).statusCode).toBe(403);
    expect((await req({ origin: 'https://evil.example' }, '/%61pi/playback/clear')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/ws/admin', headers: { host, origin: 'https://evil.example' } })).statusCode).toBe(403);
    // 同源页面、本机程序（没有 Origin）照常
    expect((await app.inject({ method: 'GET', url: '/api/outputs', headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/outputs', headers: { host } })).statusCode).toBe(200);
  });

  it('服务器版照旧：要登录，/api/auth/me 标明不是桌面版', async () => {
    const { app, login } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/outputs', headers: { host: 'evil.example' } })).statusCode).toBe(401);
    const req = await login();
    expect((await req({ method: 'GET', url: '/api/auth/me' })).json()).toEqual({ ok: true, desktop: false });
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

describe('日志', () => {
  it('地址里的特效页密钥不写进日志', async () => {
    const { redactUrl } = await import('./app.ts');
    expect(redactUrl('/ws/overlay?output=1&key=abcDEF_123')).toBe('/ws/overlay?output=1&key=***');
    expect(redactUrl('/overlay/?key=x&output=2')).toBe('/overlay/?key=***&output=2');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });
});

describe('管理后台静态文件', () => {
  it('构建后由服务提供首页，入口页不缓存', async () => {
    const fsm = await import('node:fs');
    const pathm = await import('node:path');
    const { testApp } = await import('./testing.ts');
    const t = await testApp();
    if (!fsm.existsSync(pathm.join(t.ctx.config.adminDist, 'index.html'))) return void (await t.app.close());
    const page = await t.app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.body).toContain('星临');
    // 接口和特效页不受影响
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await t.app.close();
  });
});

describe('管理后台静态文件', () => {
  it('每次从磁盘读：重新构建后台后不用重启服务；只提供根目录下的页面和图标', async () => {
    const fsm = await import('node:fs');
    const os = await import('node:os');
    const pathm = await import('node:path');
    const { loadConfig } = await import('./config.ts');
    const { createContext } = await import('./context.ts');
    const { buildApp } = await import('./app.ts');
    const dataDir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'starfall-admin-'));
    const dist = pathm.join(dataDir, 'dist');
    fsm.mkdirSync(pathm.join(dist, 'assets'), { recursive: true });
    fsm.writeFileSync(pathm.join(dist, 'index.html'), '<p>v1</p>');
    fsm.writeFileSync(pathm.join(dist, 'assets', 'a-1.js'), 'v1');
    const app = await buildApp(createContext({ ...loadConfig({ STARFALL_DATA: dataDir }), adminDist: dist }, { dbFile: ':memory:' }));
    expect((await app.inject({ method: 'GET', url: '/' })).body).toBe('<p>v1</p>');
    // 重新构建：旧文件删掉、换成新文件名
    fsm.rmSync(pathm.join(dist, 'assets', 'a-1.js'));
    fsm.writeFileSync(pathm.join(dist, 'assets', 'a-2.js'), 'v2');
    fsm.writeFileSync(pathm.join(dist, 'index.html'), '<p>v2</p>');
    fsm.writeFileSync(pathm.join(dist, 'favicon.svg'), '<svg/>');
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page).toMatchObject({ statusCode: 200, body: '<p>v2</p>', headers: { 'cache-control': 'no-cache' } });
    expect(page.headers['content-type']).toContain('text/html');
    const js = await app.inject({ method: 'GET', url: '/assets/a-2.js' });
    expect(js).toMatchObject({ statusCode: 200, body: 'v2' });
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ method: 'GET', url: '/assets/a-1.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/favicon.svg' })).headers['content-type']).toContain('image/svg+xml');
    // 其他文件、隐藏文件都不提供；接口照常
    fsm.writeFileSync(pathm.join(dist, 'secret.json'), '{}');
    expect((await app.inject({ method: 'GET', url: '/secret.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/.env' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(401);
    await app.close();
    fsm.rmSync(dataDir, { recursive: true, force: true });
  });
});
