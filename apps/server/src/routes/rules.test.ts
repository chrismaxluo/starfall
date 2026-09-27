import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.unstubAllGlobals(); });
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  const req = await t.login();
  const effectId = async (name: string) => ((await req({ method: 'GET', url: '/api/effects' })).json().effects as Array<{ id: number; name: string }>).find((e) => e.name === name)!.id;
  return { ...t, req, effectId };
};
const card = (mid: number, name: string) => new Response(JSON.stringify({ code: 0, data: { card: { mid: String(mid), name, face: `https://i0.hdslb.com/${mid}.jpg` } } }));

describe('进场规则', () => {
  it('默认规则：5 个身份档位，粉丝牌分档从高到低，普通观众默认关闭', async () => {
    const { req, effectId } = await setup();
    const r = (await req({ method: 'GET', url: '/api/rules/enter' })).json();
    expect(r.tiers.gov).toEqual({ effectId: await effectId('金銮'), cooldownMin: 5, enabled: true });
    expect(r.tiers.nor.enabled).toBe(false);
    expect(r.bands.map((b: { fromLevel: number }) => b.fromLevel)).toEqual([21, 1]);
    expect(r.cooldownMode).toBe('minutes');
  });

  it('保存档位、分档、冷却方式', async () => {
    const { req, ctx, effectId } = await setup();
    const r = (await req({ method: 'GET', url: '/api/rules/enter' })).json();
    r.tiers.nor = { effectId: await effectId('一行字'), cooldownMin: 60, enabled: true };
    r.bands = [{ fromLevel: 1, effectId: null, cooldownMin: 15, enabled: true }, { fromLevel: 30, effectId: await effectId('门楼'), cooldownMin: 5, enabled: true }, { fromLevel: 10, effectId: await effectId('霜玻'), cooldownMin: 10, enabled: false }];
    r.cooldownMode = 'oncePerLive';
    const saved = (await req({ method: 'PUT', url: '/api/rules/enter', payload: r })).json();
    expect(saved.bands.map((b: { fromLevel: number }) => b.fromLevel)).toEqual([30, 10, 1]);
    expect(saved.tiers.nor).toMatchObject({ cooldownMin: 60, enabled: true });
    expect(ctx.settings.get('cooldownMode')).toBe('oncePerLive');
    expect(ctx.enterRules.full()).toMatchObject({ cooldownMode: 'oncePerLive', exclusives: [] });
  });

  it('参数校验：分档起始等级不能重复、至少一档、素材必须存在、档位不能多也不能少', async () => {
    const { req } = await setup();
    const r = (await req({ method: 'GET', url: '/api/rules/enter' })).json();
    const put = (payload: unknown) => req({ method: 'PUT', url: '/api/rules/enter', payload: payload as object });
    const dup = await put({ ...r, bands: [r.bands[0], { ...r.bands[0] }] });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.message).toContain('不能重复');
    expect((await put({ ...r, bands: [] })).statusCode).toBe(400);
    const missing = await put({ ...r, tiers: { ...r.tiers, cap: { ...r.tiers.cap, effectId: 9999 } } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toContain('9999');
    const { nor: _nor, ...four } = r.tiers;
    expect((await put({ ...r, tiers: four })).statusCode).toBe(400);
    expect((await put({ ...r, tiers: { ...r.tiers, vip: r.tiers.nor } })).statusCode).toBe(400);
    expect((await put({ ...r, bands: [{ ...r.bands[0], fromLevel: 0 }] })).statusCode).toBe(400);
  });
});

describe('专属用户', () => {
  it('添加时查询昵称头像；同一 UID 只能一条；可以修改和删除', async () => {
    const { req, effectId } = await setup();
    const fetchMock = vi.fn(async () => card(10001, '小星'));
    vi.stubGlobal('fetch', fetchMock);
    const star = await effectId('晶耀');
    const x = { uid: 10001, effectId: star, cooldownMin: 0, until: '2026-10-01', enabled: true };
    const added = await req({ method: 'POST', url: '/api/rules/exclusive', payload: x });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ ...x, name: '小星', face: 'https://i0.hdslb.com/10001.jpg' });
    expect((await req({ method: 'POST', url: '/api/rules/exclusive', payload: x })).statusCode).toBe(409);

    const upd = await req({ method: 'PUT', url: '/api/rules/exclusive/10001', payload: { until: null, cooldownMin: 30 } });
    expect(upd.json()).toMatchObject({ uid: 10001, until: null, cooldownMin: 30, name: '小星' });
    expect((await req({ method: 'PUT', url: '/api/rules/exclusive/10001', payload: { uid: 2 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/rules/exclusive/10001', payload: { effectId: 9999 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/rules/exclusive/10002', payload: { enabled: false } })).statusCode).toBe(404);

    // 素材的使用位置里显示昵称
    const effects = (await req({ method: 'GET', url: '/api/effects' })).json().effects as Array<{ id: number; usedBy: Array<{ label: string }> }>;
    expect(effects.find((e) => e.id === star)!.usedBy.map((u) => u.label)).toContain('进场 · 专属 小星');

    expect((await req({ method: 'GET', url: '/api/rules/exclusive' })).json().exclusives).toHaveLength(1);
    expect((await req({ method: 'DELETE', url: '/api/rules/exclusive/10001' })).statusCode).toBe(200);
    expect((await req({ method: 'DELETE', url: '/api/rules/exclusive/10001' })).statusCode).toBe(404);
  });

  it('查不到昵称也能添加', async () => {
    const { req, effectId } = await setup();
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    const res = await req({ method: 'POST', url: '/api/rules/exclusive', payload: { uid: 10003, effectId: await effectId('亭阁'), cooldownMin: 5, until: null, enabled: true } });
    expect(res.json()).toMatchObject({ uid: 10003, name: null });
  });
});

describe('按 UID 查询用户', () => {
  it('查询后缓存，7 天内不重复请求；不存在的用户返回 404；连不上 B 站返回 502', async () => {
    const { req } = await setup();
    const fetchMock = vi.fn(async () => card(10001, '小星'));
    vi.stubGlobal('fetch', fetchMock);
    expect((await req({ method: 'GET', url: '/api/viewers/10001' })).json()).toEqual({ uid: 10001, name: '小星', face: 'https://i0.hdslb.com/10001.jpg' });
    await req({ method: 'GET', url: '/api/viewers/10001' });
    expect(fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes('card'))).toHaveLength(1);

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: -404, message: '啥都木有' })));
    expect((await req({ method: 'GET', url: '/api/viewers/99999' })).statusCode).toBe(404);
    vi.stubGlobal('fetch', async () => { throw new Error('timeout'); });
    expect((await req({ method: 'GET', url: '/api/viewers/88888' })).statusCode).toBe(502);
    expect((await req({ method: 'GET', url: '/api/viewers/0' })).statusCode).toBe(400);
  });
});
