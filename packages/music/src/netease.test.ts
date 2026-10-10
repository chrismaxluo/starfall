import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Netease, NeteaseError, mergeSetCookie, songFromRaw, weapi } from './netease.ts';

/** 假的网易云：按路径返回内容，记下请求 */
function fake(routes: Record<string, { body: unknown; setCookie?: string[]; status?: number }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return new Response('not found', { status: 404 });
    const headers = new Headers();
    for (const c of r.setCookie ?? []) headers.append('set-cookie', c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers });
  }) as typeof fetch;
  return { f, calls };
}

describe('网易云接口', () => {
  it('网页版接口的加密：同样的随机数得到同样的结果，能用 AES 解回原文', () => {
    const rand = () => Buffer.alloc(16, 1);
    const a = weapi({ ids: '[1]' }, rand);
    expect(a).toBe(weapi({ ids: '[1]' }, rand));
    const p = new URLSearchParams(a);
    expect(p.get('encSecKey')).toMatch(/^[0-9a-f]{256}$/);
    const secret = 'b'.repeat(16);
    const dec = (b64: string, key: string) => {
      const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
      return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString();
    };
    expect(JSON.parse(dec(dec(p.get('params')!, secret), '0CoJUm6Qyw8W8jud'))).toEqual({ ids: '[1]' });
  });

  it('合并 Set-Cookie：只要名字和值，过期的删掉', () => {
    const c = mergeSetCookie({ old: '1', gone: 'x' }, ['MUSIC_U=abc; Max-Age=1296000; Path=/', '__csrf=tok; Path=/', 'gone=; Expires=Thu, 01-Jan-1970 00:00:10 GMT', 'bad']);
    expect(c).toEqual({ old: '1', MUSIC_U: 'abc', __csrf: 'tok' });
  });

  it('搜索结果：能不能完整播放看 privilege，图片地址换成 https', () => {
    expect(songFromRaw({ id: 1, name: '起风了', ar: [{ name: '买辣椒也用券', alias: ['阿券'] }], al: { name: '起风了', picUrl: 'http://p1.music.126.net/a.jpg' }, dt: 325_000, fee: 8, privilege: { st: 0, pl: 320_000 } })).toEqual({
      id: 1,
      name: '起风了',
      alias: [],
      artists: ['买辣椒也用券'],
      artistAlias: ['阿券'],
      album: '起风了',
      cover: 'https://p1.music.126.net/a.jpg',
      durationMs: 325_000,
      fee: 8,
      playable: true,
    });
    expect(songFromRaw({ id: 2, name: 'x', privilege: { st: -100, pl: 0 } }).playable).toBe(false);
    expect(songFromRaw({ id: 3, name: 'x', privilege: { st: 0, pl: 0 } }).playable).toBe(false);
  });

  it('请求里声明国内地址，带上登录信息；搜索失败时说明原因', async () => {
    const { f, calls } = fake({ '/api/cloudsearch/pc': { body: { code: 200, result: { songs: [{ id: 5, name: '晴天', privilege: { st: 0, pl: 128000 } }] } } } });
    const n = new Netease({ MUSIC_U: 'u' }, { fetch: f, ip: '116.25.1.2' });
    const songs = await n.search('晴天 周杰伦');
    expect(songs.map((s) => s.id)).toEqual([5]);
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h['X-Real-IP']).toBe('116.25.1.2');
    expect(h.Cookie).toContain('MUSIC_U=u');
    expect(new URL(calls[0]!.url).searchParams.get('s')).toBe('晴天 周杰伦');

    const bad = fake({ '/api/cloudsearch/pc': { body: { code: 405, message: '操作频繁' } } });
    await expect(new Netease({}, { fetch: bad.f }).search('x')).rejects.toThrow('搜歌失败（网易云返回 405：操作频繁）');
  });

  it('播放地址：只有试听片段或没有地址时返回 null，地址换成 https', async () => {
    const ok = fake({ '/weapi/song/enhance/player/url/v1': { body: { code: 200, data: [{ url: 'http://m701.music.126.net/x.mp3', br: 320000 }] } } });
    expect(await new Netease({}, { fetch: ok.f }).songUrl(1)).toEqual({ url: 'https://m701.music.126.net/x.mp3', br: 320000 });
    const trial = fake({ '/weapi/song/enhance/player/url/v1': { body: { code: 200, data: [{ url: 'http://x', freeTrialInfo: { start: 0, end: 30 } }] } } });
    expect(await new Netease({}, { fetch: trial.f }).songUrl(1)).toBeNull();
    const none = fake({ '/weapi/song/enhance/player/url/v1': { body: { code: 200, data: [{ url: null, code: 404 }] } } });
    expect(await new Netease({}, { fetch: none.f }).songUrl(1)).toBeNull();
  });

  it('歌词：纯音乐、没有歌词时返回 null', async () => {
    const ok = fake({ '/api/song/lyric': { body: { code: 200, lrc: { lyric: '[00:01.00]你好' }, tlyric: { lyric: '' } } } });
    expect(await new Netease({}, { fetch: ok.f }).lyric(1)).toEqual({ lrc: '[00:01.00]你好', trans: '' });
    const none = fake({ '/api/song/lyric': { body: { code: 200, nolyric: true } } });
    expect(await new Netease({}, { fetch: none.f }).lyric(1)).toBeNull();
  });

  it('扫码登录：等待、已扫码、过期；成功时收下登录信息', async () => {
    let code = 801;
    const f = (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/weapi/login/qrcode/unikey') return Response.json({ code: 200, unikey: 'k1' });
      if (path === '/weapi/login/qrcode/client/login') {
        const headers = new Headers();
        if (code === 803) headers.append('set-cookie', 'MUSIC_U=secret; Path=/');
        return new Response(JSON.stringify({ code }), { headers });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const n = new Netease({}, { fetch: f });
    expect(await n.qrCreate()).toEqual({ key: 'k1', url: 'https://music.163.com/login?codekey=k1' });
    expect(await n.qrPoll('k1')).toBe('waiting');
    code = 802;
    expect(await n.qrPoll('k1')).toBe('scanned');
    code = 800;
    expect(await n.qrPoll('k1')).toBe('expired');
    code = 803;
    expect(await n.qrPoll('k1')).toBe('success');
    expect(n.loggedIn).toBe(true);
    code = 8821;
    await expect(n.qrPoll('k1')).rejects.toBeInstanceOf(NeteaseError);
  });

  it('账号：会员看 vipType；没登录时返回 null', async () => {
    const vip = fake({ '/weapi/w/nuser/account/get': { body: { code: 200, account: { id: 9, vipType: 11 }, profile: { userId: 9, nickname: '星临', avatarUrl: 'http://a.jpg' } } } });
    expect(await new Netease({}, { fetch: vip.f }).account()).toEqual({ uid: 9, name: '星临', avatar: 'https://a.jpg', vip: true });
    const anon = fake({ '/weapi/w/nuser/account/get': { body: { code: 200, account: null, profile: null } } });
    expect(await new Netease({}, { fetch: anon.f }).account()).toBeNull();
  });
});
