import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonorMedal } from '@starfall/bili';
import { HonorMedals } from '../services/honor.ts';
import { formFile, media, testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });

const MEDALS: HonorMedal[] = [
  { level: 1, url: 'https://i0.hdslb.com/bfs/live/h1.png', animated: false },
  { level: 68, url: 'https://i0.hdslb.com/bfs/live/h68.png', animated: false },
];
const setup = async (fetchHonor = vi.fn(async () => MEDALS)) => {
  const t = await testApp({ fetchHonor });
  close.push(() => t.app.close());
  const req = await t.login();
  return { ...t, req, fetchHonor };
};

describe('荣耀等级勋章', () => {
  it('每天读一次，存下来；读失败时用上次存的', async () => {
    let now = 1_000_000_000_000;
    const t = await setup();
    const make = (fetch: () => Promise<HonorMedal[]>) => new HonorMedals(t.ctx.settings, () => t.ctx.account.anon, fetch, () => now);
    expect((await t.req({ method: 'GET', url: '/api/honor-medals' })).json()).toEqual({ medals: [], updatedAt: null });
    await t.ctx.honor.refresh(true);
    expect((await t.req({ method: 'GET', url: '/api/honor-medals' })).json().medals).toEqual([{ level: 1, url: MEDALS[0]!.url }, { level: 68, url: MEDALS[1]!.url }]);
    // 重启后先用存下来的；没过期不重新读
    const fetch = vi.fn(async (): Promise<HonorMedal[]> => { throw new Error('连不上'); });
    const h = make(fetch);
    expect(h.urlFor(68)).toBe(MEDALS[1]!.url);
    expect(h.urlFor(2)).toBeUndefined();
    expect(h.urlFor(undefined)).toBeUndefined();
    const saved = t.ctx.settings.getRaw<{ at: number }>('honorMedals')!;
    now = saved.at + 3600_000;
    await h.refresh();
    expect(fetch).not.toHaveBeenCalled();
    // 过期了重新读；失败时保留旧的，10 分钟内不再试
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    now = saved.at + 25 * 3600_000;
    await h.refresh();
    await h.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.urlFor(68)).toBe(MEDALS[1]!.url);
    // 读到空列表也不覆盖
    const empty = make(async () => []);
    await empty.refresh(true);
    expect(empty.urlFor(1)).toBe(MEDALS[0]!.url);
  });

  it('播放内容带上荣耀等级和勋章图；素材可以打开「荣耀等级勋章」', async () => {
    const t = await setup();
    await t.ctx.honor.refresh(true);
    const builtin = (await t.req({ method: 'GET', url: '/api/effects' })).json().effects.find((e: { name: string }) => e.name === '霜玻');
    expect(builtin.honorBadge).toBe(false);
    const frost = (await t.req({ method: 'POST', url: `/api/effects/${builtin.id}/copy` })).json();
    const upd = await t.req({ method: 'PUT', url: `/api/effects/${frost.id}`, payload: { honorBadge: true } });
    expect(upd.json().honorBadge).toBe(true);
    const preview = async (viewer: object) => (await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: frost.id, viewer } })).json();
    const p = await preview({ name: '长夜未央', honor: 68 });
    expect(p.effect.honorBadge).toBe(true);
    expect(p.viewer.honor).toEqual({ level: 68, url: MEDALS[1]!.url });
    // 不知道图的等级只带等级；0 级不带
    expect((await preview({ honor: 5 })).viewer.honor).toEqual({ level: 5 });
    expect((await preview({ honor: 0 })).viewer.honor).toBeUndefined();
    expect((await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: frost.id, viewer: { honor: 81 } } })).statusCode).toBe(400);
  });

  it('SVGA 图层可以换成荣耀勋章：没有荣耀等级时藏起来；名字里有 honor 的图层自动对应', async () => {
    const t = await setup();
    await t.ctx.honor.refresh(true);
    const { effect } = (await t.req({ method: 'POST', url: '/api/assets', ...formFile('进场.svga', media('slots.svga')) })).json();
    await t.req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { svgaMap: { ...effect.svgaMap, deco: 'honor' } } });
    const deco = async (viewer: object) =>
      ((await t.req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, viewer } })).json().effect.visual.dyn as Array<{ key: string; role: string; url?: string }>).find((d) => d.key === 'deco');
    expect(await deco({ honor: 68 })).toMatchObject({ role: 'honor', url: MEDALS[1]!.url });
    expect((await deco({ honor: 0 }))!.url).toBe('');
    const { guessSvgaRole } = await import('@starfall/shared');
    expect(['honor_medal', 'wealth', '荣耀勋章', 'medal'].map(guessSvgaRole)).toEqual(['honor', 'honor', 'honor', 'badge']);
  });

  it('弹幕规则可以按荣耀等级；观众的荣耀等级记下来', async () => {
    const t = await setup();
    const none = { all: false, anchor: false, mod: false, guards: [], fanMin: null, uids: [] };
    // 旧的写法（没有荣耀等级这一项）照样能存
    const old = await t.req({ method: 'POST', url: '/api/rules/danmu', payload: { keywords: ['打卡'], mode: 'contains', who: { ...none, mod: true }, effectId: 1, globalCdSec: 0, userCdMin: 0, enabled: true } });
    expect(old.json().who.honorMin).toBeNull();
    const r = await t.req({ method: 'POST', url: '/api/rules/danmu', payload: { keywords: ['晚安'], mode: 'contains', who: { ...none, honorMin: 30 }, effectId: 1, globalCdSec: 0, userCdMin: 0, enabled: true } });
    expect(r.json().who.honorMin).toBe(30);
    expect((await t.req({ method: 'POST', url: '/api/rules/danmu', payload: { keywords: ['x'], mode: 'contains', who: { ...none, honorMin: 81 }, effectId: 1, globalCdSec: 0, userCdMin: 0, enabled: true } })).statusCode).toBe(400);
    const sim = (honor: number) => t.req({ method: 'POST', url: '/api/simulate', payload: { kind: 'danmu', viewer: { honor }, text: '晚安' } }).then((x) => x.json());
    expect((await sim(30)).rule).toContain('晚安');
    expect((await sim(29)).rule).toBeNull();

    t.ctx.pipeline.handle({ kind: 'danmu', id: 'd', ts: Date.now(), viewer: { uid: 10001, name: '小星', guard: 0, isMod: false, mystery: false, honor: 42 }, text: 'hi' });
    expect(t.ctx.viewers.cached(10001)?.honor).toBe(42);
    // 下一条消息里没有荣耀等级：保留记下的
    t.ctx.pipeline.handle({ kind: 'danmu', id: 'e', ts: Date.now(), viewer: { uid: 10001, name: '小星二号', guard: 0, isMod: false, mystery: false }, text: 'hi' });
    expect(t.ctx.viewers.cached(10001)).toMatchObject({ name: '小星二号', honor: 42 });
    expect((await t.req({ method: 'GET', url: '/api/viewers/10001' })).json()).toMatchObject({ uid: 10001, honor: 42 });
  });
});
