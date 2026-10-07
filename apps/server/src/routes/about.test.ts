import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../testing.ts';
import { compareVersions } from './about.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.unstubAllGlobals(); });
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  return { ...t, req: await t.login() };
};
const release = (tag: string) => vi.fn(async () => new Response(JSON.stringify({ tag_name: tag, published_at: '2026-10-03T00:00:00Z' }), { status: 200 }));

describe('关于', () => {
  it('版本号比较', () => {
    expect(compareVersions('1.5.0', '1.4.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.4.0', '1.4.0')).toBe(0);
    // 测试版：数字一样时正式版更新；测试版之间按序号比
    expect(compareVersions('1.5.0', '1.5.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-beta.1', '1.5.0')).toBeLessThan(0);
    expect(compareVersions('1.5.0-beta.10', '1.5.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-beta.1', '1.4.0')).toBeGreaterThan(0);
    expect(compareVersions('1.4.10', '1.4.9')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0', '1.5.0-beta.1')).toBeLessThan(0);
  });

  it('版本、运行信息；有新版本时标出来，查到的结果记一小时，点「检查更新」时重新查', async () => {
    const t = await setup();
    const f = release('v99.0.0');
    vi.stubGlobal('fetch', f);
    const r = (await t.req({ method: 'GET', url: '/api/about' })).json();
    expect(r).toMatchObject({ edition: 'server', update: { latest: { version: '99.0.0' }, newer: true, error: null }, runtime: { dataDir: t.dataDir } });
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.runtime.startedAt).toBeLessThanOrEqual(Date.now());
    await t.req({ method: 'GET', url: '/api/about' });
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', release(`v${r.version}`));
    const again = (await t.req({ method: 'GET', url: '/api/about?check=1' })).json();
    expect(again.update).toMatchObject({ newer: false });
  });

  it('连不上时说明原因；未登录不能看', async () => {
    const t = await setup();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = (await t.req({ method: 'GET', url: '/api/about' })).json();
    expect(r.update).toMatchObject({ latest: null, newer: false });
    expect(r.update.error).toContain('连不上');
    expect((await t.app.inject({ method: 'GET', url: '/api/about' })).statusCode).toBe(401);
  });
});
