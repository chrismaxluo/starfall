import { afterEach, describe, expect, it, vi } from 'vitest';
import { DANMU_WHO_ALL, danmuWhoFromOld } from '@starfall/shared';
import { room } from '../db/schema.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; vi.unstubAllGlobals(); });
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '主播' }).run();
  const req = await t.login();
  const effectId = (name: string) => t.ctx.effects.list().find((e) => e.name === name)!.id;
  return { ...t, req, effectId };
};
const dmRule = (effectId: number, p: object = {}) => ({ keywords: ['生日快乐'], mode: 'contains', who: DANMU_WHO_ALL, effectId, globalCdSec: 30, userCdMin: 10, enabled: true, ...p });

describe('弹幕规则接口', () => {
  it('新建、修改（关键词去重去空格）、调整顺序、删除', async () => {
    const t = await setup();
    const a = (await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(t.effectId('晶·弹幕')) })).json();
    const b = (await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(t.effectId('宫·舰长'), { keywords: [' 晚安 ', '晚安', '好梦'], who: danmuWhoFromOld('fan') }) })).json();
    expect(b).toMatchObject({ keywords: ['晚安', '好梦'], who: danmuWhoFromOld('fan') });
    const u = (await t.req({ method: 'PUT', url: `/api/rules/danmu/${a.id}`, payload: { mode: 'exact', enabled: false } })).json();
    expect(u).toMatchObject({ mode: 'exact', enabled: false, keywords: ['生日快乐'] });
    const order = (await t.req({ method: 'PUT', url: '/api/rules/danmu/order', payload: { ids: [b.id, a.id] } })).json();
    expect(order.rules.map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    expect((await t.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules.map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    expect((await t.req({ method: 'DELETE', url: `/api/rules/danmu/${a.id}` })).statusCode).toBe(200);
    expect((await t.req({ method: 'DELETE', url: `/api/rules/danmu/${a.id}` })).statusCode).toBe(404);
  });

  it('参数校验：至少一个关键词、素材必须存在、顺序要完整', async () => {
    const t = await setup();
    const a = (await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(t.effectId('晶·弹幕')) })).json();
    expect((await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(1, { keywords: [] }) })).statusCode).toBe(400);
    expect((await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(9999) })).json().error.message).toContain('9999');
    expect((await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(1, { who: 'vip' }) })).statusCode).toBe(400);
    // 一种人都没选
    expect((await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(1, { who: { ...DANMU_WHO_ALL, all: false } }) })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: `/api/rules/danmu/${a.id}`, payload: { keywords: [' '] } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/rules/danmu/order', payload: { ids: [a.id, 999] } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/rules/danmu/999', payload: { enabled: false } })).statusCode).toBe(404);
  });
});

describe('礼物规则接口', () => {
  it('默认：≥ 100 元、10 ~ 100 元 B站·礼物动画，1 ~ 10 元字·一行，三段都关着；连击 3 秒', async () => {
    const t = await setup();
    const g = (await t.req({ method: 'GET', url: '/api/rules/gift' })).json();
    expect(g).toMatchObject({ specific: [], comboEnabled: true, comboSec: 3 });
    expect(g.bands.map((b: { fromGold: number; enabled: boolean }) => [b.fromGold, b.enabled])).toEqual([[100_000, false], [10_000, false], [1000, false]]);
  });

  it('保存指定礼物、分档、连击；校验重复和素材', async () => {
    const t = await setup();
    const body = { specific: [{ giftId: 25, giftName: '小电视飞船', effectId: t.effectId('晶·大礼物'), enabled: true }], bands: [{ fromGold: 50_000, effectId: t.effectId('宫·提督'), enabled: true }], comboEnabled: false, comboSec: 5 };
    const r = (await t.req({ method: 'PUT', url: '/api/rules/gift', payload: body })).json();
    expect(r).toMatchObject(body);
    expect(t.ctx.settings.get('giftComboSec')).toBe(5);
    expect((await t.req({ method: 'PUT', url: '/api/rules/gift', payload: { ...body, specific: [body.specific[0], body.specific[0]] } })).json().error.message).toContain('同一种礼物');
    expect((await t.req({ method: 'PUT', url: '/api/rules/gift', payload: { ...body, bands: [] } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/rules/gift', payload: { ...body, bands: [{ fromGold: 1, effectId: 9999, enabled: true }] } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/rules/gift', payload: { ...body, comboSec: 60 } })).statusCode).toBe(400);
  });

  it('礼物面板：从 B 站读取并缓存；没设直播间时提示', async () => {
    const t = await setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { gift_config: { base_config: { list: [{ id: 31036, name: '小花花', price: 100, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/g.png' }] } } } })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await t.req({ method: 'GET', url: '/api/gifts' })).json()).toEqual({ gifts: [{ id: 31036, name: '小花花', price: 100, paid: true, icon: 'https://i0.hdslb.com/g.png' }] });
    await t.req({ method: 'GET', url: '/api/gifts' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await t.req({ method: 'GET', url: '/api/gifts?refresh=1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // B 站出错时用缓存
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    expect((await t.req({ method: 'GET', url: '/api/gifts?refresh=1' })).statusCode).toBe(200);
    t.ctx.db.delete(room).run();
    expect((await t.req({ method: 'GET', url: '/api/gifts' })).statusCode).toBe(409);
  });
});

describe('上舰规则接口', () => {
  it('默认规则；保存；素材必须存在', async () => {
    const t = await setup();
    const g = (await t.req({ method: 'GET', url: '/api/rules/guard' })).json();
    expect(g.cap).toEqual({ openEffectId: t.effectId('宫·舰长'), renewEffectId: t.effectId('宫·舰长'), enabled: true });
    g.cap.renewEffectId = t.effectId('晶·礼物');
    g.gov.enabled = false;
    const r = (await t.req({ method: 'PUT', url: '/api/rules/guard', payload: g })).json();
    expect(r).toMatchObject({ cap: { renewEffectId: t.effectId('晶·礼物') }, gov: { enabled: false } });
    expect((await t.req({ method: 'PUT', url: '/api/rules/guard', payload: { ...g, adm: { ...g.adm, openEffectId: 9999 } } })).statusCode).toBe(400);
  });
});

describe('素材的使用位置、删除保护、复制替换', () => {
  it('弹幕、礼物、上舰规则引用的素材不能删；复制时可以一起换成副本', async () => {
    const t = await setup();
    const copy = (await t.req({ method: 'POST', url: `/api/effects/${t.effectId('晶·弹幕')}/copy`, payload: {} })).json();
    await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(copy.id, { keywords: ['晚安'] }) });
    const got = (await t.req({ method: 'GET', url: `/api/effects/${copy.id}` })).json();
    expect(got.usedBy).toEqual([{ page: 'danmu', label: '弹幕 · 「晚安」' }]);
    const del = await t.req({ method: 'DELETE', url: `/api/effects/${copy.id}` });
    expect(del.statusCode).toBe(409);
    const gate = t.effectId('宫·舰长');
    const c2 = (await t.req({ method: 'POST', url: `/api/effects/${gate}/copy`, payload: { replaceRefs: true } })).json();
    expect(c2.usedBy.map((u: { label: string }) => u.label)).toEqual(['进场 · 舰长', '上舰 · 开通舰长', '上舰 · 续费舰长']);
    expect((await t.req({ method: 'GET', url: '/api/rules/guard' })).json().cap.openEffectId).toBe(c2.id);
  });
});

describe('模拟与预览', () => {
  it('模拟弹幕、礼物、上舰', async () => {
    const t = await setup();
    await t.req({ method: 'POST', url: '/api/rules/danmu', payload: dmRule(t.effectId('晶·弹幕')) });
    t.ctx.db.$client.prepare('update rule_gift_bands set enabled = 1 where from_gold >= 10000').run();
    t.ctx.settings.set('offlinePolicy', 'play');
    const sim = (payload: object) => t.req({ method: 'POST', url: '/api/simulate', payload }).then((r) => r.json());
    expect(await sim({ kind: 'danmu', viewer: {}, text: '生日快乐' })).toMatchObject({ rule: '弹幕 · 「生日快乐」', effect: { name: '晶·弹幕' }, status: 'played', notes: ['特效页现在不在线，直播画面里看不到'] });
    expect(await sim({ kind: 'danmu', viewer: {}, text: '随便' })).toMatchObject({ rule: null, status: 'no_rule' });
    expect(await sim({ kind: 'gift', viewer: {}, giftName: '告白花束', unitPrice: 22_000, count: 5 })).toMatchObject({ rule: '礼物 · 单次 ≥ 1000电池', effect: { name: 'B站·礼物动画' } });
    expect(await sim({ kind: 'gift', viewer: {}, unitPrice: 0, count: 5 })).toMatchObject({ rule: null, statusText: '未命中规则' });
    expect(await sim({ kind: 'guard', viewer: {}, level: 3, op: 'renew', months: 3 })).toMatchObject({ rule: '上舰 · 续费舰长', effect: { name: '宫·舰长' } });
    expect(await sim({ viewer: { guard: 3 } })).toMatchObject({ rule: '进场 · 舰长' });
    expect((await t.req({ method: 'POST', url: '/api/simulate', payload: { kind: 'gift', viewer: {}, count: 1 } })).statusCode).toBe(400);
  });

  it('预览：按事件用示例内容填欢迎语，也可以自己指定', async () => {
    const t = await setup();
    const gift = t.effectId('晶·礼物');
    const pv = (payload: object) => t.req({ method: 'POST', url: '/api/preview', payload }).then((r) => r.json());
    expect((await pv({ effectId: gift, kind: 'gift', viewer: { name: '半糖' } })).text).toBe('半糖 送出 小花花');
    expect((await pv({ effectId: gift, kind: 'gift', viewer: { name: '半糖' }, vars: { gift: '告白花束', count: 2 } })).text).toBe('半糖 送出 告白花束');
    expect((await pv({ effectId: gift, kind: 'guard', viewer: { name: '半糖' }, vars: { months: 3, guardLevel: 3, op: 'renew' } })).text).toBe('半糖 来了');
    expect((await pv({ effectId: gift, kind: 'guard', viewer: { name: '半糖' }, vars: { months: 12 } })).text).toBe('半糖 来了');
    expect((await pv({ effectId: t.effectId('宫·舰长'), kind: 'guard', viewer: { name: '半糖' }, vars: { months: 12 } })).text).toBe('舰长·上舰 半糖');
    expect((await pv({ effectId: t.effectId('晶·弹幕'), kind: 'danmu', viewer: { name: '半糖' } })).text).toBe('半糖：主播晚上好！');
  });

  it('预览礼物：用所选礼物自己的图（按编号，没有编号时按名字），查不到就不放图，不再一律显示小花花', async () => {
    const t = await setup();
    const list = [
      { id: 31036, name: '小花花', price: 100, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/flower.png' },
      { id: 31037, name: '告白花束', price: 22000, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/bouquet.png' },
      { id: 32000, name: '星愿水晶球', price: 100000, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/ball.png' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { gift_config: { base_config: { list } } } }))));
    await t.req({ method: 'GET', url: '/api/gifts' });
    const gift = t.effectId('晶·礼物');
    const img = (vars?: object) => t.req({ method: 'POST', url: '/api/preview', payload: { effectId: gift, kind: 'gift', ...(vars ? { vars } : {}) } }).then((r) => r.json().gift?.img);
    expect(await img({ gift: '星愿水晶球', giftId: 32000, count: 1 })).toBe('https://i0.hdslb.com/ball.png');
    expect(await img({ gift: '告白花束', count: 2 })).toBe('https://i0.hdslb.com/bouquet.png');
    expect(await img({ gift: '面板里没有的礼物', count: 1 })).toBeUndefined();
    // 没指定礼物：示例小花花和它的图
    expect(await img()).toContain('hdslb.com');
  });
});
