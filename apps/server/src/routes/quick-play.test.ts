import { afterEach, describe, expect, it } from 'vitest';
import { DANMU_WHO_ALL } from '@starfall/shared';
import type { QuickButton, ServerToOverlay } from '@starfall/shared';
import { room } from '../db/schema.ts';
import { QuickPlayStore } from '../services/quick-play.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '星临主播' }).run();
  const req = await t.login();
  const effectId = (name: string) => t.ctx.effects.list().find((e) => e.name === name)!.id;
  const save = (buttons: object[]) => req({ method: 'PUT', url: '/api/quickplay/buttons', payload: { buttons } });
  const list = async () => (await req({ method: 'GET', url: '/api/quickplay/buttons' })).json().buttons as QuickButton[];
  return { ...t, req, effectId, save, list };
};
const btn = (effectId: number, p: object = {}) => ({ effectId, label: '', hotkey: null, globalHotkey: null, ...p });

describe('素材快捷播放', () => {
  it('第一次使用：放进弹幕规则里用到的素材（去掉重复、按规则顺序），快捷键 1、2…；之后删光了也不再自动放', async () => {
    const t = await setup();
    // 新装的：没有弹幕规则，按钮是空的
    expect(await t.list()).toEqual([]);
    t.ctx.settings.setRaw('quickPlaySeeded', false);
    const rule = (name: string) => t.ctx.danmuRules.create({ keywords: [name], mode: 'contains', who: DANMU_WHO_ALL, effectId: t.effectId(name), globalCdSec: 0, userCdMin: 0, enabled: true });
    rule('门楼');
    rule('晶语');
    rule('门楼');
    t.ctx.danmuRules.create({ keywords: ['空'], mode: 'contains', who: DANMU_WHO_ALL, effectId: null, globalCdSec: 0, userCdMin: 0, enabled: true });
    const store = new QuickPlayStore(t.ctx.db, t.ctx.settings);
    store.seedOnce();
    expect(store.list()).toMatchObject([
      { effectId: t.effectId('门楼'), label: '', hotkey: '1' },
      { effectId: t.effectId('晶语'), label: '', hotkey: '2' },
    ]);
    store.save([]);
    store.seedOnce();
    expect(store.list()).toEqual([]);
  });

  it('整体保存：顺序、名字、快捷键；快捷键不能重复、格式要对，素材要存在', async () => {
    const t = await setup();
    const a = t.effectId('门楼');
    const b = t.effectId('晶语');
    const r = await t.save([btn(b, { label: ' 晚安 ', hotkey: 'Q', globalHotkey: 'Ctrl+Alt+1' }), btn(a, { hotkey: '1' })]);
    expect(r.statusCode).toBe(200);
    expect(await t.list()).toMatchObject([
      { effectId: b, label: '晚安', hotkey: 'Q', globalHotkey: 'Ctrl+Alt+1' },
      { effectId: a, label: '', hotkey: '1', globalHotkey: null },
    ]);
    const err = async (buttons: object[]) => (await t.save(buttons)).json().error?.message as string | undefined;
    expect(await err([btn(a, { hotkey: '1' }), btn(b, { hotkey: '1' })])).toContain('快捷键 1 被两个按钮用了');
    expect(await err([btn(a, { globalHotkey: 'Ctrl+1' }), btn(b, { globalHotkey: 'Ctrl+1' })])).toContain('被两个按钮用了');
    expect(await err([btn(a, { hotkey: 'q' })])).toBeTruthy();
    expect(await err([btn(a, { hotkey: 'F5' })])).toBeTruthy();
    expect(await err([btn(a, { globalHotkey: '1' })])).toBeTruthy();
    expect(await err([btn(a, { globalHotkey: 'Ctrl+Ctrl+1' })])).toContain('重复');
    expect(await err([btn(9999)])).toContain('9999');
    // 出错时原来的按钮不变
    expect(await t.list()).toHaveLength(2);
  });

  it('素材删掉后按钮一起删掉；复制素材并替换用到它的地方时，按钮换成副本', async () => {
    const t = await setup();
    const copy = t.ctx.effects.copy(t.effectId('门楼'), {});
    await t.save([btn(copy.id), btn(t.effectId('晶语'))]);
    const copy2 = t.ctx.effects.copy(t.effectId('晶语'), { replaceRefs: true });
    t.ctx.effects.remove(copy.id);
    expect((await t.list()).map((x) => x.effectId)).toEqual([copy2.id]);
  });

  it('点按钮播放：特效页不在线、已暂停时说明原因；按钮不存在时 404', async () => {
    const t = await setup();
    await t.save([btn(t.effectId('晶语'))]);
    const [b] = await t.list();
    const play = (id: number) => t.req({ method: 'POST', url: `/api/quickplay/play/${id}`, payload: {} });
    expect((await play(b!.id)).json().error.message).toContain('特效页不在线');
    const sent: ServerToOverlay[] = [];
    t.ctx.hub.addOverlay({ send: (d: string) => void sent.push(JSON.parse(d)), close: () => undefined }, t.ctx.outputs.list()[0]!, []);
    const r = await play(b!.id);
    expect(r.statusCode).toBe(200);
    expect(sent.find((m) => m.type === 'play')).toMatchObject({ item: { quick: true, viewer: { name: '星临主播' }, effect: { name: '晶语', showText: false } } });
    expect((await play(9999)).statusCode).toBe(404);
    t.ctx.pipeline.pause();
    expect((await play(b!.id)).json().error.message).toContain('已暂停');
  });
});
