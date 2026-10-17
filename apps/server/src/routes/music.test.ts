import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { room } from '../db/schema.ts';
import { formFile, media, testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });

/** 假的网易云：只认扫码登录、账号、会员、搜歌、播放地址 */
function fakeNetease() {
  let poll = 801;
  const vip = { vipType: 11, expire: 2_000_000_000_000, url: true as boolean };
  const f = (async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/weapi/login/qrcode/unikey') return Response.json({ code: 200, unikey: 'key1' });
    if (path === '/weapi/login/qrcode/client/login') {
      const headers = new Headers();
      if (poll === 803) headers.append('set-cookie', 'MUSIC_U=secret-cookie; Path=/');
      return new Response(JSON.stringify({ code: poll }), { headers });
    }
    if (path === '/weapi/w/nuser/account/get') return Response.json({ code: 200, account: { id: 9, vipType: vip.vipType }, profile: { userId: 9, nickname: '网易云用户', avatarUrl: 'http://a.jpg' } });
    if (path === '/weapi/music-vip-membership/client/vip/info') return Response.json({ code: 200, data: { associator: { vipCode: 100, expireTime: vip.expire }, musicPackage: { expireTime: 0 } } });
    if (path === '/weapi/song/enhance/player/url/v1') return Response.json({ code: 200, data: [{ url: vip.url ? 'http://m701.music.126.net/1.mp3' : null, br: 320000 }] });
    if (path === '/weapi/logout') return Response.json({ code: 200 });
    if (path === '/api/cloudsearch/pc') return Response.json({ code: 200, result: { songs: [{ id: 1, name: '起风了', ar: [{ name: '买辣椒也用券' }], al: { name: '', picUrl: 'http://p1/x.jpg' }, dt: 300_000, fee: 8, privilege: { st: 0, pl: 320000 } }, { id: 2, name: '起风了', ar: [{ name: '会员' }], dt: 300_000, fee: 1, privilege: { st: 0, pl: 0 } }] } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { f, vip, setPoll: (c: number) => (poll = c) };
}

const setup = async () => {
  const ne = fakeNetease();
  const t = await testApp({ netease: { fetch: ne.f, ip: '116.25.1.1' } });
  close.push(() => t.app.close());
  t.ctx.db.insert(room).values({ id: 1, roomId: 30000, anchorUid: 20000, anchorName: '星临主播' }).run();
  const req = await t.login();
  return { ...t, req, ne };
};

describe('点歌接口', () => {
  it('设置：默认关着；改了要通过校验，只改传了的项', async () => {
    const t = await setup();
    const r = (await t.req({ method: 'GET', url: '/api/music' })).json();
    expect(r).toMatchObject({ settings: { enabled: false, cmdRequest: '点歌', perUser: 1 }, state: { enabled: false, hold: 'disabled', now: null }, player: false, account: { loggedIn: false }, library: { count: 0 } });
    const ok = await t.req({ method: 'PUT', url: '/api/music/settings', payload: { enabled: true, cmdRequest: ' 来一首 ' } });
    expect(ok.json().settings).toMatchObject({ enabled: true, cmdRequest: '来一首', perUser: 1 });
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { cmdRequest: '点 歌' } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { volume: 101 } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { nope: 1 } })).statusCode).toBe(400);
    // 导出的配置里带上点歌设置
    expect(t.ctx.io.export().music).toMatchObject({ enabled: true, cmdRequest: '来一首' });
  });

  it('网易云扫码登录：登录信息加密保存，会员看得出来；退出后删掉', async () => {
    const t = await setup();
    const qr = (await t.req({ method: 'POST', url: '/api/music/qrcode' })).json();
    expect(qr.key).toBe('key1');
    expect(qr.image).toMatch(/^data:image\/png;base64,/);
    expect((await t.req({ method: 'GET', url: '/api/music/qrcode/key1' })).json()).toEqual({ state: 'waiting' });
    t.ne.setPoll(803);
    expect((await t.req({ method: 'GET', url: '/api/music/qrcode/key1' })).json()).toMatchObject({ state: 'success', account: { loggedIn: true, name: '网易云用户', vip: true, vipKind: '黑胶VIP', vipUntil: 2_000_000_000_000 } });
    const raw = JSON.stringify(t.ctx.settings.getRaw('neteaseAccount'));
    expect(raw).not.toContain('secret-cookie');
    expect(t.ctx.musicAccount.client().cookies.MUSIC_U).toBe('secret-cookie');
    // 不认识的 key（过期了、服务重启过）
    expect((await t.req({ method: 'GET', url: '/api/music/qrcode/other' })).json()).toEqual({ state: 'expired' });
    expect((await t.req({ method: 'DELETE', url: '/api/music/account' })).statusCode).toBe(200);
    expect((await t.req({ method: 'GET', url: '/api/music/account' })).json()).toEqual({ loggedIn: false, urls: { fails: 0 } });
  });

  it('会员到期：确认时查到期时间；过了到期时间就不算会员；登录失效要重新扫码', async () => {
    const t = await setup();
    await t.req({ method: 'POST', url: '/api/music/qrcode' });
    t.ne.setPoll(803);
    await t.req({ method: 'GET', url: '/api/music/qrcode/key1' });
    // 续费了：到期时间跟着变
    t.ne.vip.expire = 2_100_000_000_000;
    expect((await t.req({ method: 'POST', url: '/api/music/account/check' })).json()).toMatchObject({ vip: true, vipKind: '黑胶VIP', vipUntil: 2_100_000_000_000 });
    // 到期了：账号不是会员，到期时间还在（后台显示哪天到期的）
    const past = Date.now() - 86400_000;
    Object.assign(t.ne.vip, { vipType: 0, expire: past });
    expect((await t.req({ method: 'POST', url: '/api/music/account/check' })).json()).toMatchObject({ vip: false, vipKind: '黑胶VIP', vipUntil: past });
    expect(t.ctx.musicAccount.vip()).toBe(false);
    // 账号说还是会员、会员接口说到期了（没跟上）：以账号为准，到期时间当作不知道
    t.ne.vip.vipType = 11;
    const acc = (await t.req({ method: 'POST', url: '/api/music/account/check' })).json();
    expect(acc).toMatchObject({ vip: true, vipKind: '黑胶VIP' });
    expect(acc.vipUntil).toBeUndefined();
  });

  it('拿不到播放地址：连着几首都记着；「现在重试」拿到了就恢复', async () => {
    const t = await setup();
    const a = t.ctx.musicAccount;
    a.urlResult(true, { id: 5, name: '孤勇者' });
    expect(a.status().urls).toMatchObject({ fails: 0, okName: '孤勇者' });
    a.urlResult(false, { id: 1, name: '起风了' }, '只拿到试听片段，或者没有地址');
    a.urlResult(false, { id: 1, name: '起风了' }, '只拿到试听片段，或者没有地址');
    expect(a.status().urls).toMatchObject({ fails: 2, okName: '孤勇者', failText: '只拿到试听片段，或者没有地址' });
    t.ne.vip.url = false;
    expect((await t.req({ method: 'POST', url: '/api/music/account/retry' })).json()).toEqual({ ok: false, text: '《起风了》还是拿不到播放地址' });
    expect(a.status().urls.fails).toBe(2);
    t.ne.vip.url = true;
    expect((await t.req({ method: 'POST', url: '/api/music/account/retry' })).json()).toEqual({ ok: true, text: '《起风了》能拿到了' });
    expect(a.status().urls).toMatchObject({ fails: 0, okName: '起风了' });
    expect((await t.req({ method: 'POST', url: '/api/music/account/retry' })).json()).toEqual({ ok: true, text: '最近没有拿不到的歌' });
  });

  it('本场：还没有直播记录时为空', async () => {
    const t = await setup();
    expect((await t.req({ method: 'GET', url: '/api/music/session' })).json()).toEqual({ session: null });
  });

  it('搜歌：放不了的也列出来，写明原因', async () => {
    const t = await setup();
    const r = (await t.req({ method: 'GET', url: '/api/music/search?q=起风了' })).json();
    expect(r.netease).toMatchObject([{ source: 'netease', id: '1', name: '起风了', playable: true }, { id: '2', playable: false, note: '需要会员' }]);
    expect(r.local).toEqual([]);
    expect((await t.req({ method: 'GET', url: '/api/music/search?q=' })).statusCode).toBe(400);
  });

  it('本地歌库：上传音乐（同样的文件只存一份）、配歌词、改名；点歌窗口拿文件要签名，支持 Range', async () => {
    const t = await setup();
    const up = await t.req({ method: 'POST', url: '/api/music/local', ...formFile('星临乐队 - 测试之歌.mp3', media('tone.mp3')) });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ created: true, song: { title: '测试之歌', artist: '星临乐队', hasLyric: false, folder: false } });
    const again = await t.req({ method: 'POST', url: '/api/music/local', ...formFile('别的名字.mp3', media('tone.mp3')) });
    expect(again.json()).toMatchObject({ created: false });
    const id = up.json().song.id as number;
    // 同名的 .lrc 配上去
    const lrc = await t.req({ method: 'POST', url: '/api/music/local', ...formFile('星临乐队 - 测试之歌.lrc', '[00:00.50]第一句\n[00:01.00]第二句') });
    expect(lrc.json()).toMatchObject({ lyricFor: { id, hasLyric: true } });
    expect((await t.req({ method: 'POST', url: '/api/music/local', ...formFile('没有这首.lrc', '[00:01.00]x') })).statusCode).toBe(404);
    expect((await t.req({ method: 'POST', url: '/api/music/local', ...formFile('x.txt', 'hello') })).statusCode).toBe(415);
    expect((await t.req({ method: 'POST', url: '/api/music/local', ...formFile('假的.mp3', 'not audio at all') })).statusCode).toBe(415);
    expect((await t.req({ method: 'PUT', url: `/api/music/local/${id}`, payload: { artist: '新歌手' } })).json().song).toMatchObject({ artist: '新歌手' });

    // 本地歌库能搜到；点了之后点歌窗口拿到的地址带签名
    const hits = (await t.req({ method: 'GET', url: '/api/music/search?q=测试之歌' })).json().local;
    expect(hits).toMatchObject([{ source: 'local', id: String(id), name: '测试之歌', artists: '新歌手' }]);
    const url = t.ctx.musicLibrary.url(t.ctx.musicLibrary.get(id)!);
    const file = await t.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-9' } });
    expect(file.statusCode).toBe(206);
    expect(file.rawPayload.length).toBe(10);
    expect((await t.app.inject({ method: 'GET', url: `/music-files/${id}?s=wrong` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/music-files/${id}` })).statusCode).toBe(400);

    // 服务器版不能选文件夹
    expect((await t.req({ method: 'PUT', url: '/api/music/local/folder', payload: { dir: '/tmp' } })).statusCode).toBe(400);
    await t.req({ method: 'DELETE', url: `/api/music/local/${id}` });
    expect((await t.req({ method: 'GET', url: '/api/music/local' })).json().songs).toEqual([]);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('后台加歌、调顺序、删除、清空、暂停', async () => {
    const t = await setup();
    const add = (id: string, name: string) => t.req({ method: 'POST', url: '/api/music/queue', payload: { song: { source: 'netease', id, name, artists: 'x', durationMs: 1000 } } });
    expect((await add('1', '一')).statusCode).toBe(200);
    await add('2', '二');
    expect((await add('2', '二')).statusCode).toBe(409);
    const names = () => t.ctx.music.snapshot().queue.map((i) => i.song.name);
    const ids = t.ctx.music.snapshot().queue.map((i) => i.id);
    await t.req({ method: 'PUT', url: '/api/music/queue/order', payload: { ids: [ids[1], ids[0]] } });
    expect(names()).toEqual(['二', '一']);
    await t.req({ method: 'DELETE', url: `/api/music/queue/${ids[1]}` });
    expect(names()).toEqual(['一']);
    expect((await t.req({ method: 'DELETE', url: '/api/music/queue/999' })).statusCode).toBe(404);
    const cleared = (await t.req({ method: 'POST', url: '/api/music/queue/clear' })).json();
    expect(cleared).toMatchObject({ cleared: 1 });
    expect((await t.req({ method: 'POST', url: '/api/music/queue/restore', payload: { ids: cleared.ids } })).json()).toEqual({ restored: 1 });
    expect(names()).toEqual(['一']);
    await t.req({ method: 'POST', url: '/api/music/queue/clear' });
    expect((await t.req({ method: 'POST', url: '/api/music/skip' })).statusCode).toBe(409);
    await t.req({ method: 'POST', url: '/api/music/pause', payload: { paused: true } });
    await t.req({ method: 'PUT', url: '/api/music/settings', payload: { enabled: true } });
    expect(t.ctx.music.state().hold).toBe('manual');
    expect((await t.req({ method: 'POST', url: '/api/music/toggle-pause' })).json()).toEqual({ paused: false });
    // 全局快捷键：格式要对，不能和快捷播放按钮、彼此重复
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { hotkeySkip: 'N' } })).statusCode).toBe(400);
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { hotkeySkip: 'Ctrl+Alt+N', hotkeyPause: 'Ctrl+Alt+N' } })).statusCode).toBe(409);
    t.ctx.quickPlay.save([{ effectId: t.ctx.effects.list()[0]!.id, label: '晚安', hotkey: null, globalHotkey: 'Ctrl+Alt+1' }]);
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { hotkeyPause: 'Ctrl+Alt+1' } })).json().error.message).toContain('晚安');
    expect((await t.req({ method: 'PUT', url: '/api/music/settings', payload: { hotkeySkip: 'Ctrl+Alt+N', hotkeyPause: 'Ctrl+Alt+P' } })).statusCode).toBe(200);
    // 本地歌库里没有的歌不能加
    expect((await t.req({ method: 'POST', url: '/api/music/queue', payload: { song: { source: 'local', id: '99', name: 'x', artists: '', durationMs: 1 } } })).statusCode).toBe(404);
  });

  it('电脑版：用一个文件夹里的歌（子文件夹也算，旁边同名的 .lrc 配上），重新扫描时去掉不在了的', async () => {
    const t = await testApp({}, { STARFALL_DESKTOP: '1' });
    close.push(() => t.app.close());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starfall-music-'));
    close.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, '子文件夹'));
    fs.writeFileSync(path.join(dir, '歌手乙 - 第一首.mp3'), media('tone.mp3'));
    fs.writeFileSync(path.join(dir, '歌手乙 - 第一首.lrc'), '[00:00.10]歌词');
    fs.writeFileSync(path.join(dir, '子文件夹', '第二首.ogg'), media('tone.ogg'));
    fs.writeFileSync(path.join(dir, '不是音乐.txt'), 'x');
    const req = (o: InjectOptions) => t.app.inject(o);
    const r = await req({ method: 'PUT', url: '/api/music/local/folder', payload: { dir } });
    expect(r.json()).toMatchObject({ total: 2, added: 2 });
    const list = (await req({ method: 'GET', url: '/api/music/local' })).json();
    expect(list.folder).toBe(dir);
    expect(list.songs.map((x: { title: string; artist: string; hasLyric: boolean; folder: boolean }) => `${x.title}|${x.artist}|${x.hasLyric}|${x.folder}`).sort()).toEqual(['第一首|歌手乙|true|true', '第二首||false|true']);
    // 文件夹里的歌不能在后台删
    expect((await req({ method: 'DELETE', url: `/api/music/local/${list.songs[0].id}` })).statusCode).toBe(409);
    fs.rmSync(path.join(dir, '子文件夹'), { recursive: true });
    expect((await req({ method: 'POST', url: '/api/music/local/rescan' })).json()).toMatchObject({ total: 1, removed: 1 });
    expect((await req({ method: 'PUT', url: '/api/music/local/folder', payload: { dir: null } })).json()).toMatchObject({ total: 0 });
    expect((await req({ method: 'GET', url: '/api/music/local' })).json()).toEqual({ songs: [], folder: null });
  });

  it('要登录才能用', async () => {
    const t = await setup();
    expect((await t.app.inject({ method: 'GET', url: '/api/music' })).statusCode).toBe(401);
  });
});
