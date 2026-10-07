import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  return { ...t, req: await t.login() };
};

describe('直播软件输出', () => {
  it('默认一个竖屏输出，带特效页地址', async () => {
    const { req } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    expect(o).toMatchObject({ name: '竖屏直播', app: 'livehime', orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9, scale: 100, liteMode: 'auto' });
    expect(o.key).toMatch(/^[\w-]{22}$/);
    expect(o.path).toBe(`/overlay/?output=${o.id}&key=${o.key}`);
    // 弹幕列表：默认打开、靠左、标准字号、只显示本直播间的粉丝牌
    expect(o).toMatchObject({ chatEnabled: true, chatSide: 'left', chatSize: 'normal', chatMedal: 'own', chatMax: 8, chatPath: `/overlay/?output=${o.id}&key=${o.key}&chat=1` });
  });

  it('弹幕列表的设置可以改，取值要合法', async () => {
    const { req } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    const u = (await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatEnabled: false, chatSide: 'right', chatSize: 'large', chatMedal: 'all', chatMax: 15 } })).json();
    expect(u).toMatchObject({ chatEnabled: false, chatSide: 'right', chatSize: 'large', chatMedal: 'all', chatMax: 15 });
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatSide: 'middle' } })).statusCode).toBe(400);
    for (const chatMax of [0, 21, 2.5]) expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatMax } })).statusCode).toBe(400);
    // 自动消失：默认 0（一直显示），可以设 3 – 600 秒
    expect(o.chatFadeSec).toBe(0);
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatFadeSec: 10 } })).json()).toMatchObject({ chatFadeSec: 10 });
    for (const chatFadeSec of [1, 601, -1, 2.5]) expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatFadeSec } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { chatFadeSec: 0 } })).json()).toMatchObject({ chatFadeSec: 0 });
  });

  it('送礼名单：默认打开、靠右、6 条、所有付费礼物和上舰、醒目留言；可以改成只显示选中的礼物', async () => {
    const { req } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    expect(o).toMatchObject({ giftsEnabled: true, giftsSide: 'right', giftsSize: 'normal', giftsMax: 6, giftsSpeed: 'normal', giftsFilter: { mode: 'all', gifts: [], guard: true, sc: true }, giftsPath: `/overlay/?output=${o.id}&key=${o.key}&gifts=1` });
    const giftsFilter = { mode: 'only', gifts: [{ id: 32251, name: '心动盲盒' }], guard: true, sc: false };
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsFilter, giftsMax: 10, giftsSide: 'left' } })).json()).toMatchObject({ giftsFilter, giftsMax: 10, giftsSide: 'left' });
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsFilter: { ...giftsFilter, mode: 'some' } } })).statusCode).toBe(400);
    for (const giftsMax of [0, 21]) expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsMax } })).statusCode).toBe(400);
    // 滚动：不滚动 / 慢 / 中 / 快
    for (const giftsSpeed of ['off', 'slow', 'fast']) expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsSpeed } })).json()).toMatchObject({ giftsSpeed });
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { giftsSpeed: 'turbo' } })).statusCode).toBe(400);
  });

  it('新建（未填的用默认值）、修改、参数校验', async () => {
    const { req } = await setup();
    const o = (await req({ method: 'POST', url: '/api/outputs', payload: { name: '横屏录播', app: 'obs', orient: 'landscape', width: 1920, height: 1080 } })).json();
    expect(o).toMatchObject({ name: '横屏录播', app: 'obs', width: 1920, safeTop: 12 });
    expect((await req({ method: 'POST', url: '/api/outputs', payload: { app: 'obs' } })).statusCode).toBe(400);
    const u = (await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { safeTop: 0, safeBottom: 0, scale: 120 } })).json();
    expect(u).toMatchObject({ safeTop: 0, safeBottom: 0, scale: 120, key: o.key });
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { width: 100 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/outputs/${o.id}`, payload: { key: 'x' } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/outputs/999', payload: { scale: 100 } })).statusCode).toBe(404);
  });

  it('重置密钥后旧地址失效，并通知在线的特效页', async () => {
    const { req, ctx } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    const onChange = vi.fn();
    ctx.outputs.onChange(onChange);
    expect(ctx.outputs.verify(o.id, o.key)).not.toBeNull();
    const n = (await req({ method: 'POST', url: `/api/outputs/${o.id}/reset-key` })).json();
    expect(n.key).not.toBe(o.key);
    expect(ctx.outputs.verify(o.id, o.key)).toBeNull();
    expect(ctx.outputs.verify(o.id, n.key)).not.toBeNull();
    expect(ctx.outputs.verify(o.id, '')).toBeNull();
    expect(ctx.outputs.verify(999, n.key)).toBeNull();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: o.key }), 'key');
  });

  it('至少保留一个输出', async () => {
    const { req } = await setup();
    const [o] = (await req({ method: 'GET', url: '/api/outputs' })).json().outputs;
    expect((await req({ method: 'DELETE', url: `/api/outputs/${o.id}` })).statusCode).toBe(409);
    const b = (await req({ method: 'POST', url: '/api/outputs', payload: { name: 'B' } })).json();
    expect((await req({ method: 'DELETE', url: `/api/outputs/${o.id}` })).statusCode).toBe(200);
    expect((await req({ method: 'GET', url: '/api/outputs' })).json().outputs.map((x: { id: number }) => x.id)).toEqual([b.id]);
  });
});
