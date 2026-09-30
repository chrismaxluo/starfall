import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets } from '../db/schema.ts';
import { formFile, media, testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });
const setup = async (opts?: { maxUpload?: number }) => {
  const t = await testApp(opts);
  close.push(() => t.app.close());
  const req = await t.login();
  const upload = (url: string, name: string, content: Buffer | string, method: 'POST' | 'PUT' = 'POST') => req({ method, url, ...formFile(name, content) });
  const effects = async () => (await req({ method: 'GET', url: '/api/effects' })).json().effects as Array<{ id: number; name: string; builtin: boolean; usedBy: Array<{ label: string }> }>;
  const byName = async (n: string) => (await effects()).find((e) => e.name === n)!;
  return { ...t, req, upload, effects, byName };
};

describe('素材列表', () => {
  it('内置 10 个素材，带"用于哪些规则"', async () => {
    const { effects, byName } = await setup();
    const list = await effects();
    expect(list.map((e) => e.name)).toEqual(['霜玻', '一行字', '霜玻·简', '金銮', '亭阁', '门楼', '晶礼', '晶耀', '晶巡', '晶语']);
    expect(list.every((e) => e.builtin)).toBe(true);
    expect((await byName('金銮')).usedBy).toEqual([
      { page: 'enter', label: '进场 · 总督' },
      { page: 'guard', label: '上舰 · 开通总督' },
      { page: 'guard', label: '上舰 · 续费总督' },
    ]);
    expect((await byName('晶耀')).usedBy).toEqual([{ page: 'gift', label: '礼物 · 单次 ≥ 100 元' }]);
    expect((await byName('晶礼')).usedBy).toEqual([{ page: 'gift', label: '礼物 · 单次 10 – 100 元' }]);
    expect((await byName('晶巡')).usedBy).toEqual([{ page: 'enter', label: '进场 · 房管' }]);
    expect((await byName('霜玻')).usedBy.map((u) => u.label)).toEqual(['进场 · 粉丝牌 21 级及以上', '进场 · 粉丝牌 1 – 20 级']);
    // 普通观众档默认关闭，但仍然引用了"一行字"
    expect((await byName('一行字')).usedBy.map((u) => u.label)).toEqual(['礼物 · 单次 1 – 10 元']);
    // 普通观众默认用霜玻的简短版（默认关闭）
    expect((await byName('霜玻·简'))).toMatchObject({ durationMs: 2400, visual: { type: 'builtin_style', style: 'frost' }, usedBy: [{ page: 'enter', label: '进场 · 普通观众' }] });
  });

  it('未登录不能访问', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/effects' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/assets', ...formFile('a.webm', media('alpha.webm')) })).statusCode).toBe(401);
  });
});

describe('上传即素材', () => {
  it('透明 WebM：自动生成素材，名称取文件名，居中，不叠加文字，时长取文件时长', async () => {
    const { upload } = await setup();
    const res = await upload('/api/assets', '生日快乐.webm', media('alpha.webm'));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.duplicate).toBe(false);
    expect(body.asset).toMatchObject({ kind: 'video', filename: '生日快乐.webm', ext: 'webm', width: 64, height: 96, durationMs: 1200, hasAlpha: true, warnings: [] });
    expect(body.effect).toMatchObject({ name: '生日快乐', builtin: false, showText: false, position: 'center', durationMs: 1200, visual: { type: 'asset', assetId: body.asset.id }, usedBy: [] });
  });

  it('文件按哈希存储，可以断点续传、长期缓存；相同文件只存一份，素材名自动加序号', async () => {
    const { app, upload, dataDir } = await setup();
    const a = (await upload('/api/assets', 'x.webm', media('alpha.webm'))).json();
    const b = (await upload('/api/assets', 'x.webm', media('alpha.webm'))).json();
    expect(b.duplicate).toBe(true);
    expect(b.asset.id).toBe(a.asset.id);
    expect(b.effect.name).toBe('x 2');
    expect(a.asset.url).toMatch(/^\/files\/[0-9a-f]{64}\.webm$/);
    expect(fs.readdirSync(path.join(dataDir, 'assets'))).toHaveLength(1);
    expect(fs.readdirSync(path.join(dataDir, 'tmp'))).toHaveLength(0);

    // 特效页（不登录）也能取文件
    const full = await app.inject({ method: 'GET', url: a.asset.url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['cache-control']).toContain('immutable');
    expect(full.rawPayload.equals(media('alpha.webm'))).toBe(true);
    const part = await app.inject({ method: 'GET', url: a.asset.url, headers: { range: 'bytes=0-9' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload).toHaveLength(10);
    expect((await app.inject({ method: 'GET', url: '/files/../starfall.db' })).statusCode).toBe(404);
  });

  it('没有透明通道、文件较大时给出提醒', async () => {
    const { upload } = await setup();
    const body = (await upload('/api/assets', 'bg.mp4', media('opaque.mp4'))).json();
    expect(body.asset).toMatchObject({ hasAlpha: false, warnings: ['no_alpha'] });
  });

  it('拒绝不支持的格式和改过扩展名的文件', async () => {
    const { upload, dataDir } = await setup();
    const exe = Buffer.concat([Buffer.from('MZ\x90\0'), Buffer.alloc(200)]);
    const a = await upload('/api/assets', 'virus.exe', exe);
    expect(a.statusCode).toBe(415);
    expect(a.json().error.code).toBe('unsupported_file');
    const b = await upload('/api/assets', 'fake.webm', exe);
    expect(b.statusCode).toBe(415);
    expect(b.json().error.message).toContain('扩展名');
    expect((await upload('/api/assets', 'empty.png', '')).json().error.code).toBe('empty_file');
    expect(fs.readdirSync(path.join(dataDir, 'assets'))).toHaveLength(0);
    expect(fs.readdirSync(path.join(dataDir, 'tmp'))).toHaveLength(0);
  });

  it('超过大小限制返回 413，不留下临时文件', async () => {
    const { upload, dataDir } = await setup({ maxUpload: 1000 });
    const res = await upload('/api/assets', 'big.webm', media('alpha.webm'));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('file_too_large');
    expect(fs.readdirSync(path.join(dataDir, 'tmp'))).toHaveLength(0);
  });

  it('上传接口只接受表单', async () => {
    const { req } = await setup();
    const res = await req({ method: 'POST', url: '/api/assets', payload: { a: 1 } });
    expect(res.statusCode).toBe(415);
  });
});

describe('修改素材', () => {
  it('内置素材只读', async () => {
    const { req, byName } = await setup();
    const star = await byName('晶耀');
    const res = await req({ method: 'PUT', url: `/api/effects/${star.id}`, payload: { volume: 10 } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('复制');
    expect((await req({ method: 'DELETE', url: `/api/effects/${star.id}` })).statusCode).toBe(403);
  });

  it('修改名称、欢迎语、位置；名称不能重复；未知字段拒绝', async () => {
    const { req, upload } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    const ok = await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { name: '生日', showText: true, texts: { enter: ['{name} 生日快乐'], gift: ['谢谢 {name}'] }, position: 'top', durationMs: 4000 } });
    // 视频有自己的时长：按素材时长播放，设置的时长不起作用
    expect(ok.json()).toMatchObject({ name: '生日', showText: true, texts: { enter: ['{name} 生日快乐'], gift: ['谢谢 {name}'] }, position: 'top', durationMs: 1200 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { name: '晶耀' } })).statusCode).toBe(409);
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { builtin: true } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { durationMs: 100 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/effects/9999', payload: { volume: 1 } })).statusCode).toBe(404);
    expect((await req({ method: 'PUT', url: '/api/effects/abc', payload: { volume: 1 } })).statusCode).toBe(400);
  });

  it('时长：有时长的素材按素材时长（不受 30 秒限制），静态图片用设置的时长', async () => {
    const { req, upload, ctx } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    ctx.db.update(assets).set({ durationMs: 30_733 }).where(eq(assets.id, effect.visual.assetId)).run();
    expect((await req({ method: 'GET', url: `/api/effects/${effect.id}` })).json().durationMs).toBe(30_733);
    const still = (await upload('/api/assets', 's.png', media('still.png'))).json().effect;
    expect(still.durationMs).toBe(5000);
    expect((await req({ method: 'PUT', url: `/api/effects/${still.id}`, payload: { durationMs: 2500 } })).json().durationMs).toBe(2500);
  });

  it('手动设置时长：打开后按设置的时长播放，不超过素材本身；关掉恢复跟随素材；换文件后恢复跟随', async () => {
    const { req, upload, ctx } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    ctx.db.update(assets).set({ durationMs: 30_733 }).where(eq(assets.id, effect.visual.assetId)).run();
    const put = async (payload: object) => (await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload })).json();
    expect(effect.durationCustom).toBe(false);
    expect(await put({ durationCustom: true, durationMs: 8000 })).toMatchObject({ durationCustom: true, durationMs: 8000 });
    // 预览用还没保存的设置
    const p = (await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { durationCustom: false } } })).json();
    expect(p.effect.durationMs).toBe(30_733);
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { durationMs: 3000 } } })).json().effect.durationMs).toBe(3000);
    expect(await put({ durationCustom: false })).toMatchObject({ durationCustom: false, durationMs: 30_733 });
    // 设置的比素材长时按素材
    ctx.db.update(assets).set({ durationMs: 1200 }).where(eq(assets.id, effect.visual.assetId)).run();
    expect(await put({ durationCustom: true, durationMs: 8000 })).toMatchObject({ durationCustom: true, durationMs: 1200 });
    const replaced = (await upload(`/api/effects/${effect.id}/file`, 'b.webm', media('alpha.webm'), 'PUT')).json();
    expect(replaced.durationCustom).toBe(false);
  });

  it('渐入渐出：新上传的素材默认关闭，可以分别打开，预览和播放内容带上设置', async () => {
    const { req, upload } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    expect(effect).toMatchObject({ fadeIn: false, fadeOut: false });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { fadeIn: true } })).json()).toMatchObject({ fadeIn: true, fadeOut: false });
    const p = (await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { fadeOut: true } } })).json();
    expect(p.effect).toMatchObject({ fadeIn: true, fadeOut: true });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { fadeIn: 'yes' } })).statusCode).toBe(400);
    // 渐入渐出的秒数：默认 0.5 秒，0.1 ~ 5 秒
    expect(effect).toMatchObject({ fadeInMs: 500, fadeOutMs: 500 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { fadeInMs: 1500, fadeOutMs: 2400 } })).json()).toMatchObject({ fadeInMs: 1500, fadeOutMs: 2400 });
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { fadeOutMs: 800 } } })).json().effect).toMatchObject({ fadeInMs: 1500, fadeOutMs: 800 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { fadeInMs: 50 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { fadeOutMs: 6000 } })).statusCode).toBe(400);
    // 位置微调：默认不挪，画面宽、高的 ±100%
    expect(effect).toMatchObject({ offsetX: 0, offsetY: 0 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { offsetX: -12.5, offsetY: 30 } })).json()).toMatchObject({ offsetX: -12.5, offsetY: 30 });
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { offsetY: -8 } } })).json().effect).toMatchObject({ offsetX: -12.5, offsetY: -8 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { offsetX: 101 } })).statusCode).toBe(400);
    // 大小：默认 100%，20% ~ 200%
    expect(effect).toMatchObject({ sizePct: 100 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { sizePct: 150 } })).json()).toMatchObject({ sizePct: 150 });
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { sizePct: 60 } } })).json().effect).toMatchObject({ sizePct: 60 });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { sizePct: 10 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { sizePct: 201 } })).statusCode).toBe(400);
    // 大航海头像框：默认关闭
    expect(effect).toMatchObject({ guardFrame: false });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { guardFrame: true } })).json()).toMatchObject({ guardFrame: true });
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id } })).json().effect).toMatchObject({ guardFrame: true });
    expect((await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, draft: { guardFrame: false } } })).json().effect).toMatchObject({ guardFrame: false });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { guardFrame: 'yes' } })).statusCode).toBe(400);
  });

  it('上下羽化：跟随全局时只对没有透明通道的素材生效，可以单独设置或关闭', async () => {
    const { req, upload } = await setup();
    const opaque = (await upload('/api/assets', 'o.mp4', media('opaque.mp4'))).json().effect;
    const alpha = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json().effect;
    expect(opaque).toMatchObject({ feather: 'global', featherPct: 10 });
    const pct = async (id: number, draft?: object) => (await req({ method: 'POST', url: '/api/preview', payload: { effectId: id, ...(draft ? { draft } : {}) } })).json().effect.featherPct;
    // 全局默认关闭
    expect(await pct(opaque.id)).toBe(0);
    expect((await req({ method: 'PUT', url: '/api/settings', payload: { featherOn: true, featherPct: 15 } })).json()).toMatchObject({ featherOn: true, featherPct: 15 });
    expect(await pct(opaque.id)).toBe(15);
    expect(await pct(alpha.id)).toBe(0);
    // 单独设置：带透明通道的也生效；不羽化
    expect(await pct(alpha.id, { feather: 'custom', featherPct: 20 })).toBe(20);
    expect((await req({ method: 'PUT', url: `/api/effects/${opaque.id}`, payload: { feather: 'off' } })).json()).toMatchObject({ feather: 'off' });
    expect(await pct(opaque.id)).toBe(0);
    expect(await pct(opaque.id, { feather: 'global' })).toBe(15);
    expect((await req({ method: 'PUT', url: `/api/effects/${opaque.id}`, payload: { feather: 'soft' } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/effects/${opaque.id}`, payload: { featherPct: 41 } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: '/api/settings', payload: { featherPct: 41 } })).statusCode).toBe(400);
  });

  it('SVGA 动态图层：上传时读出图层、按名字自动对应；播放时换成观众的头像、头像框、昵称', async () => {
    const { req, upload } = await setup();
    const { effect, asset } = (await upload('/api/assets', '进场.svga', media('slots.svga'))).json();
    expect(asset.slots.map((s: { key: string }) => s.key)).toEqual(['deco', 'avatar', 'frame', 'badge', 'nickname', 'welcome']);
    expect(effect.svgaMap).toEqual({ avatar: 'avatar', frame: 'frame', badge: 'badge', nickname: 'name', welcome: 'welcome' });
    const dyn = async (viewer: object) => (await req({ method: 'POST', url: '/api/preview', payload: { effectId: effect.id, viewer } })).json().effect.visual.dyn as Array<{ key: string; role: string; url?: string; text?: string; w: number }>;
    const cap = await dyn({ name: '道具堡', guard: 3, isMod: false, medalLevel: null });
    const by = (d: typeof cap, k: string) => d.find((x) => x.key === k)!;
    expect(by(cap, 'avatar')).toMatchObject({ role: 'avatar', w: 100, text: '道具堡' });
    expect(by(cap, 'frame').url).toContain('80f732943cc3367029df65e267960d56736a82ee');
    expect(by(cap, 'badge').url).toContain('captain');
    expect(by(cap, 'nickname')).toMatchObject({ role: 'name', text: '道具堡' });
    expect(by(cap, 'welcome').text).toContain('道具堡');
    expect(cap.find((x) => x.key === 'deco')).toBeUndefined();
    // 不是大航海：头像框、图标那一层藏起来
    const nor = await dyn({ name: '路人', guard: 0, isMod: false, medalLevel: null });
    expect([by(nor, 'frame').url, by(nor, 'badge').url]).toEqual(['', '']);
    // 改成方形头像、装饰也换成昵称；非法的角色不行
    const upd = (await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { svgaMap: { avatar: 'avatarSquare', deco: 'name' } } })).json();
    expect(upd.svgaMap).toEqual({ avatar: 'avatarSquare', deco: 'name' });
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { svgaMap: { avatar: 'hat' } } })).statusCode).toBe(400);
    // 换成 1.x 的文件：原来的设置里新文件没有的图层去掉，新图层按名字猜
    const rep = (await upload(`/api/effects/${effect.id}/file`, 'v1.svga', media('slots-v1.svga'), 'PUT')).json();
    expect(rep.svgaMap).toEqual({ head: 'avatar', nick: 'name', deco: 'name' });
  });

  it('音效：上传、选用、被使用时不能删除', async () => {
    const { req, upload } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    expect((await upload('/api/sounds', 'a.webm', media('alpha.webm'))).statusCode).toBe(415);
    const { sound } = (await upload('/api/sounds', '叮.wav', media('beep.wav'))).json();
    expect(sound).toMatchObject({ kind: 'audio', durationMs: 300, warnings: [], usedBy: [] });
    // 画面文件不能当音效用
    expect((await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { soundAssetId: effect.visual.assetId } })).statusCode).toBe(400);
    const set = await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { soundAssetId: sound.id, volume: 40 } });
    expect(set.json()).toMatchObject({ soundAssetId: sound.id, volume: 40, sound: { id: sound.id } });
    const sounds = (await req({ method: 'GET', url: '/api/sounds' })).json().sounds;
    expect(sounds[0].usedBy).toEqual([{ id: effect.id, name: 'a', as: 'sound' }]);
    const del = await req({ method: 'DELETE', url: `/api/assets/${sound.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.details.usedBy).toHaveLength(1);
    // 改名：只改名字，扩展名不变；画面文件不能从这里改
    const ren = await req({ method: 'PUT', url: `/api/sounds/${sound.id}`, payload: { name: '  叮咚/提示  ' } });
    expect(ren.json().sound).toMatchObject({ id: sound.id, filename: '叮咚提示.wav', usedBy: [{ id: effect.id }] });
    expect((await req({ method: 'GET', url: `/api/effects/${effect.id}` })).json().sound).toMatchObject({ filename: '叮咚提示.wav' });
    expect((await req({ method: 'PUT', url: `/api/sounds/${sound.id}`, payload: { name: '   ' } })).statusCode).toBe(400);
    expect((await req({ method: 'PUT', url: `/api/sounds/${effect.visual.assetId}`, payload: { name: 'x' } })).statusCode).toBe(404);
    await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { soundAssetId: null } });
    expect((await req({ method: 'DELETE', url: `/api/assets/${sound.id}` })).statusCode).toBe(200);
  });

  it('替换文件：素材指向新文件，旧文件没人用时删除', async () => {
    const { req, upload, dataDir } = await setup();
    const { effect, asset } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    await req({ method: 'PUT', url: `/api/effects/${effect.id}`, payload: { durationMs: 8000 } });
    const res = await upload(`/api/effects/${effect.id}/file`, 'b.mp4', media('opaque.mp4'), 'PUT');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'a', durationMs: 1000, asset: { ext: 'mp4', warnings: ['no_alpha'] } });
    expect(res.json().asset.id).not.toBe(asset.id);
    expect(fs.readdirSync(path.join(dataDir, 'assets'))).toEqual([expect.stringMatching(/\.mp4$/)]);
    expect((await upload(`/api/effects/${effect.id}/file`, 'c.wav', media('beep.wav'), 'PUT')).statusCode).toBe(415);
  });
});

describe('复制与删除', () => {
  it('复制内置素材得到可编辑的副本；勾选替换时，原来用它的规则换成副本', async () => {
    const { req, byName } = await setup();
    const star = await byName('晶耀');
    const a = (await req({ method: 'POST', url: `/api/effects/${star.id}/copy`, payload: {} })).json();
    expect(a).toMatchObject({ name: '晶耀 副本', builtin: false, visual: { type: 'builtin_style', style: 'glass-big' }, usedBy: [] });
    const b = (await req({ method: 'POST', url: `/api/effects/${star.id}/copy`, payload: { replaceRefs: true } })).json();
    expect(b).toMatchObject({ name: '晶耀 副本 2' });
    expect(b.usedBy.map((u: { label: string }) => u.label)).toEqual(['礼物 · 单次 ≥ 100 元']);
    expect((await req({ method: 'PUT', url: `/api/effects/${b.id}`, payload: { volume: 20 } })).statusCode).toBe(200);
    expect((await req({ method: 'POST', url: `/api/effects/${star.id}/copy`, payload: { name: '亭阁' } })).statusCode).toBe(409);
  });

  it('被规则使用的素材不能删除，并返回使用位置；删除没人用的素材时文件一并删除', async () => {
    const { req, upload, dataDir } = await setup();
    const { effect } = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    const rules = (await req({ method: 'GET', url: '/api/rules/enter' })).json();
    rules.tiers.cap.effectId = effect.id;
    await req({ method: 'PUT', url: '/api/rules/enter', payload: rules });
    const del = await req({ method: 'DELETE', url: `/api/effects/${effect.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.details.usedBy).toEqual([{ page: 'enter', label: '进场 · 舰长' }]);

    rules.tiers.cap.effectId = null;
    await req({ method: 'PUT', url: '/api/rules/enter', payload: rules });
    expect((await req({ method: 'DELETE', url: `/api/effects/${effect.id}` })).statusCode).toBe(200);
    expect(fs.readdirSync(path.join(dataDir, 'assets'))).toHaveLength(0);
    expect((await req({ method: 'GET', url: `/api/effects/${effect.id}` })).statusCode).toBe(404);
  });

  it('同一个文件被两个素材使用：删除其中一个时保留文件', async () => {
    const { req, upload, dataDir } = await setup();
    const a = (await upload('/api/assets', 'a.webm', media('alpha.webm'))).json();
    await upload('/api/assets', 'a.webm', media('alpha.webm'));
    await req({ method: 'DELETE', url: `/api/effects/${a.effect.id}` });
    expect(fs.readdirSync(path.join(dataDir, 'assets'))).toHaveLength(1);
  });
});
