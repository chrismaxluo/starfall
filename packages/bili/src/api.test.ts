import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoginQrCode, logoutRemote, getDanmuInfo, getRoomAdmins, getRoomGifts, getRoomInfo, getRoomInit, getUserCard, pollLoginQrCode } from './api.ts';
import { WbiSigner } from './wbi.ts';
import { BiliApiError, BiliHttp } from './http.ts';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(responses: Array<{ body: unknown; cookies?: string[] }>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push(`${url} | ${(init.headers as Record<string, string>).Cookie}`);
    const r = responses.shift()!;
    const h = new Headers();
    for (const c of r.cookies ?? []) h.append('Set-Cookie', c);
    return new Response(JSON.stringify(r.body), { headers: h });
  });
  return calls;
}

describe('B 站接口', () => {
  it('公开接口不带登录 Cookie（只带 buvid）', async () => {
    const calls = mockFetch([{ body: { code: 0, data: { data: [{ uid: 1, uname: 'a', face: 'f' }] } } }]);
    const http = new BiliHttp({ SESSDATA: 'secret', buvid3: 'B3' });
    expect(await getRoomAdmins(http, 30000)).toEqual([{ uid: 1, name: 'a', face: 'f' }]);
    expect(calls[0]).toContain('| buvid3=B3');
    expect(calls[0]).not.toContain('secret');
  });

  it('房管名单分页取完', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ uid: from + i, uname: `u${from + i}`, face: '' }));
    mockFetch([{ body: { code: 0, data: { data: page(100, 1), page: { total_page: 2 } } } }, { body: { code: 0, data: { data: page(30, 101), page: { total_page: 2 } } } }]);
    expect((await getRoomAdmins(new BiliHttp(), 1)).length).toBe(130);
  });

  it('code 不为 0 时抛出 BiliApiError', async () => {
    mockFetch([{ body: { code: -352, message: '风控校验失败' } }]);
    await expect(getRoomAdmins(new BiliHttp(), 1)).rejects.toMatchObject({ name: 'BiliApiError', code: -352 });
    expect(new BiliApiError(1, 'x')).toBeInstanceOf(Error);
  });

  it('扫码登录成功：从 Set-Cookie 取出登录信息和有效期', async () => {
    mockFetch([{
      body: { code: 0, data: { code: 0, refresh_token: 'rt' } },
      cookies: ['SESSDATA=abc%2C123; Path=/; Domain=bilibili.com; Expires=Wed, 24 Mar 2027 19:01:44 GMT; HttpOnly', 'bili_jct=csrf; Path=/', 'DedeUserID=10001; Path=/'],
    }]);
    const r = await pollLoginQrCode(new BiliHttp(), 'key');
    expect(r).toMatchObject({ state: 'success', refreshToken: 'rt', cookies: { SESSDATA: 'abc%2C123', bili_jct: 'csrf', DedeUserID: '10001' } });
    if (r.state === 'success') expect(r.expiresAt).toBe(Date.parse('Wed, 24 Mar 2027 19:01:44 GMT'));
  });

  it('扫码状态：等待、已扫码、过期', async () => {
    mockFetch([{ body: { code: 0, data: { code: 86101 } } }, { body: { code: 0, data: { code: 86090 } } }, { body: { code: 0, data: { code: 86038 } } }]);
    const http = new BiliHttp();
    expect((await pollLoginQrCode(http, 'k')).state).toBe('waiting');
    expect((await pollLoginQrCode(http, 'k')).state).toBe('scanned');
    expect((await pollLoginQrCode(http, 'k')).state).toBe('expired');
  });
});

describe('接口字段转换', () => {
  it('房间号换算与开播状态', async () => {
    mockFetch([
      { body: { code: 0, data: { room_id: 30000, short_id: 1, uid: 20000, live_status: 1, is_portrait: true, live_time: 1790380800 } } },
      { body: { code: 0, data: { room_id: 30000, short_id: 1, uid: 20000, live_status: 0, live_time: -62170012800 } } },
    ]);
    expect(await getRoomInit(new BiliHttp(), 1)).toEqual({ roomId: 30000, shortId: 1, anchorUid: 20000, liveStatus: 1, isPortrait: true, liveSince: 1790380800_000 });
    expect(await getRoomInit(new BiliHttp(), 1)).toMatchObject({ liveStatus: 0, liveSince: null });
  });

  it('直播间信息', async () => {
    mockFetch([{ body: { code: 0, data: { room_id: 30000, uid: 20000, title: '测试', live_status: 0, live_time: '0000-00-00 00:00:00' } } }]);
    expect(await getRoomInfo(new BiliHttp(), 30000)).toMatchObject({ roomId: 30000, anchorUid: 20000, title: '测试', liveStatus: 0, isPortrait: false });
  });

  it('礼物面板：金瓜子单价、付费 / 免费', async () => {
    mockFetch([{ body: { code: 0, data: { gift_config: { base_config: { list: [
      { id: 31164, name: '粉丝团灯牌', price: 1000, coin_type: 'gold', img_basic: 'i1', gif: 'g1' },
      { id: 1, name: '辣条', price: 100, coin_type: 'silver', img_basic: 'i2' },
    ] } } } } }]);
    expect(await getRoomGifts(new BiliHttp(), 30000)).toEqual([
      { id: 31164, name: '粉丝团灯牌', price: 1000, paid: true, icon: 'i1', gif: 'g1' },
      { id: 1, name: '辣条', price: 100, paid: false, icon: 'i2' },
    ]);
  });

  it('用户信息', async () => {
    mockFetch([{ body: { code: 0, data: { card: { mid: '10001', name: '测试', face: 'f' } } } }]);
    expect(await getUserCard(new BiliHttp(), 10001)).toEqual({ uid: 10001, name: '测试', face: 'f' });
  });

  it('弹幕服务器信息：先取签名密钥（nav 未登录也返回密钥），再带签名请求，并带登录 Cookie', async () => {
    const calls = mockFetch([
      { body: { code: -101, message: '账号未登录', data: { wbi_img: { img_url: 'https://x/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://x/4932caff0ff746eab6f01bf08b70ac45.png' } } } },
      { body: { code: 0, data: { token: 'tok', host_list: [{ host: 'h1', wss_port: 443 }] } } },
    ]);
    const http = new BiliHttp({ SESSDATA: 's', buvid3: 'b' });
    expect(await getDanmuInfo(http, new WbiSigner(http), 30000)).toEqual({ token: 'tok', hosts: [{ host: 'h1', wssPort: 443 }] });
    expect(calls[1]).toMatch(/getDanmuInfo\?id=30000&type=0&web_location=444\.8&wts=\d+&w_rid=[0-9a-f]{32} \| SESSDATA=s/);
  });

  it('没有弹幕服务器时报错', async () => {
    mockFetch([
      { body: { code: 0, data: { wbi_img: { img_url: 'https://x/a.png', sub_url: 'https://x/b.png' } } } },
      { body: { code: 0, data: { token: 't', host_list: [] } } },
    ]);
    const http = new BiliHttp();
    await expect(getDanmuInfo(http, new WbiSigner(http), 1)).rejects.toThrow('没有可用的弹幕服务器');
  });

  it('申请登录二维码', async () => {
    mockFetch([{ body: { code: 0, data: { url: 'https://passport/qr', qrcode_key: 'k1' } } }]);
    expect(await createLoginQrCode(new BiliHttp())).toEqual({ url: 'https://passport/qr', key: 'k1' });
  });

  it('领取 buvid，已有时不重复领取；登录状态与 UID', async () => {
    const calls = mockFetch([{ body: { code: 0, data: { b_3: 'B3', b_4: 'B4' } } }]);
    const http = new BiliHttp({ SESSDATA: 's', DedeUserID: '10001' });
    expect(await http.ensureBuvid()).toBe('B3');
    expect(await http.ensureBuvid()).toBe('B3');
    expect(calls).toHaveLength(1);
    expect([http.loggedIn, http.uid, new BiliHttp().loggedIn, new BiliHttp().uid]).toEqual([true, 10001, false, 0]);
  });

  it('返回非 JSON 时给出明确错误', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>出错啦</html>', { status: 412 }));
    await expect(getRoomInit(new BiliHttp(), 1)).rejects.toThrow('非 JSON');
  });
});

describe('退出登录', () => {
  it('带 CSRF 调用退出接口；登录已失效（2202）也视为成功', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response(JSON.stringify({ code: calls.length === 1 ? 0 : 2202 })); });
    const http = new BiliHttp({ SESSDATA: 's', bili_jct: 'csrf123' });
    await logoutRemote(http);
    await logoutRemote(http);
    expect(calls[0]).toEqual({ url: 'https://passport.bilibili.com/login/exit/v2', body: 'biliCSRF=csrf123' });
  });

  it('没有 bili_jct 时报错', async () => {
    await expect(logoutRemote(new BiliHttp({ SESSDATA: 's' }))).rejects.toThrow('bili_jct');
  });
});
