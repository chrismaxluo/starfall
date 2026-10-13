// 网易云音乐：扫码登录、搜索、播放地址、歌词。用的是网易云网页版自己在用的接口（不是对外公开的接口），
// 网易云改了接口时需要跟着改。登录信息（Cookie）只在内存里使用，由服务端负责加密保存。
//
// 两种请求方式：
// - 搜索、歌词用不加密的 /api/ 接口（加密的搜索接口在服务器上会被拒绝，返回 50000005）；
// - 扫码登录、账号信息、播放地址用网页版的加密接口（weapi）。
// 网易云按请求来源地区限制播放地址：海外服务器上拿不到。请求里声明一个国内地址（X-Real-IP）就能拿到，
// 国内的电脑上加不加都一样。这个办法以后可能失效，失效时后台会提示「获取播放地址失败」。
import crypto from 'node:crypto';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BASE = 'https://music.163.com';

export class NeteaseError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'NeteaseError';
    this.code = code;
  }
}

export type Cookies = Record<string, string>;

/** 搜索结果里的一首歌 */
export interface NeteaseSong {
  id: number;
  name: string;
  /** 别名、译名（例如「原曲：xx」、外文歌的中文名） */
  alias: string[];
  artists: string[];
  /** 歌手的别名、译名（G.E.M. 邓紫棋这类） */
  artistAlias: string[];
  album: string;
  cover: string;
  durationMs: number;
  /** 0 免费，1 会员，4 付费专辑，8 免费（高音质要会员） */
  fee: number;
  /** 按现在登录的账号能完整播放 */
  playable: boolean;
}

export interface NeteaseAccount {
  uid: number;
  name: string;
  avatar: string;
  vip: boolean;
}

export type NeteaseQrState = 'waiting' | 'scanned' | 'expired' | 'success';

// ---------- 网页版接口的加密（weapi）：AES-CBC 两次 + RSA（不补位） ----------

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const RSA_E = 0x10001n;
const RSA_N = BigInt(
  '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7',
);
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function aes(text: string, key: string): string {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(IV));
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return r;
}

/** 加密请求参数：返回表单内容 params=…&encSecKey=… */
export function weapi(data: object, rand: () => Buffer = () => crypto.randomBytes(16)): string {
  const secret = Array.from(rand(), (b) => KEY_CHARS[b % KEY_CHARS.length]).join('');
  const params = aes(aes(JSON.stringify(data), PRESET_KEY), secret);
  const reversed = BigInt(`0x${Buffer.from([...secret].reverse().join('')).toString('hex')}`);
  const encSecKey = modPow(reversed, RSA_E, RSA_N).toString(16).padStart(256, '0');
  return new URLSearchParams({ params, encSecKey }).toString();
}

/** 随便取一个国内地址（广东电信的网段），一个实例用同一个 */
function cnIp(): string {
  const r = crypto.randomBytes(2);
  return `116.25.${(r[0]! % 254) + 1}.${(r[1]! % 254) + 1}`;
}

/** 把响应里的 Set-Cookie 合进 Cookie（只要名字和值；值为空或已删除的去掉） */
export function mergeSetCookie(cookies: Cookies, setCookie: readonly string[]): Cookies {
  const out = { ...cookies };
  for (const line of setCookie) {
    const [pair] = line.split(';');
    const i = pair?.indexOf('=') ?? -1;
    if (!pair || i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!value || /expires=Thu, 01[- ]Jan[- ]1970/i.test(line) || /max-age=0\b/i.test(line)) delete out[name];
    else out[name] = value;
  }
  return out;
}

interface RawSong {
  id: number;
  name: string;
  alia?: string[];
  tns?: string[];
  ar?: Array<{ name: string; alias?: string[]; tns?: string[] }>;
  al?: { name?: string; picUrl?: string };
  dt?: number;
  fee?: number;
  privilege?: { st?: number; pl?: number };
}

const https = (u: string | undefined) => (u ? u.replace(/^http:\/\//, 'https://') : '');

export function songFromRaw(s: RawSong): NeteaseSong {
  const p = s.privilege;
  return {
    id: s.id,
    name: s.name,
    alias: [...(s.alia ?? []), ...(s.tns ?? [])].filter(Boolean),
    artists: (s.ar ?? []).map((a) => a.name).filter(Boolean),
    artistAlias: (s.ar ?? []).flatMap((a) => [...(a.alias ?? []), ...(a.tns ?? [])]).filter(Boolean),
    album: s.al?.name ?? '',
    cover: https(s.al?.picUrl),
    durationMs: s.dt ?? 0,
    fee: s.fee ?? 0,
    // st < 0：下架或这个地区没有版权；pl：能完整播放的最高码率（0 为只能试听或不能播）
    playable: p ? (p.st ?? 0) >= 0 && (p.pl ?? 0) > 0 : false,
  };
}

export interface NeteaseOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 声明的国内地址（测试时固定） */
  ip?: string;
}

export class Netease {
  cookies: Cookies;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ip: string;

  constructor(cookies: Cookies = {}, opts: NeteaseOptions = {}) {
    this.cookies = { ...cookies };
    this.fetch = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.ip = opts.ip ?? cnIp();
  }

  get loggedIn(): boolean {
    return Boolean(this.cookies.MUSIC_U);
  }

  private headers(form: boolean): Record<string, string> {
    const cookie = Object.entries({ os: 'pc', appver: '2.10.13', ...this.cookies })
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    return {
      'User-Agent': UA,
      Referer: `${BASE}/`,
      Cookie: cookie,
      'X-Real-IP': this.ip,
      'X-Forwarded-For': this.ip,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    };
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new NeteaseError(res.status, `${what}失败（网易云返回 HTTP ${res.status}）`);
    const text = await res.text();
    let j: { code?: number; message?: string; msg?: string };
    try {
      j = JSON.parse(text) as typeof j;
    } catch {
      throw new NeteaseError(-1, `${what}失败（网易云返回的不是 JSON）`);
    }
    return j as T;
  }

  /** 不加密的 GET 接口 */
  private async get<T>(path: string, what: string): Promise<T> {
    const res = await this.fetch(`${BASE}${path}`, { headers: this.headers(false), signal: AbortSignal.timeout(this.timeoutMs) });
    return this.json<T>(res, what);
  }

  /** 加密的 POST 接口；登录接口会下发 Cookie，合进来 */
  private async post<T>(path: string, data: object, what: string): Promise<{ body: T; setCookie: string[] }> {
    const csrf = this.cookies.__csrf ?? '';
    const res = await this.fetch(`${BASE}/weapi${path}${csrf ? `?csrf_token=${csrf}` : ''}`, {
      method: 'POST',
      headers: this.headers(true),
      body: weapi({ ...data, csrf_token: csrf }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    return { body: await this.json<T>(res, what), setCookie };
  }

  /** 搜歌（按网易云的相关度排序） */
  async search(keywords: string, limit = 10): Promise<NeteaseSong[]> {
    const q = new URLSearchParams({ s: keywords, type: '1', limit: String(limit), offset: '0' });
    const j = await this.get<{ code?: number; message?: string; result?: { songs?: RawSong[] } }>(`/api/cloudsearch/pc?${q}`, '搜歌');
    if (j.code !== 200) throw new NeteaseError(j.code ?? -1, `搜歌失败（网易云返回 ${j.code}${j.message ? `：${j.message}` : ''}）`);
    return (j.result?.songs ?? []).map(songFromRaw);
  }

  /**
   * 播放地址（https）：快轮到时再拿，地址过一阵会失效。拿不到完整的（只有试听片段、没有版权）时返回 null。
   * 登录了会员时要 320k，否则网易云给什么用什么
   */
  async songUrl(id: number): Promise<{ url: string; br: number } | null> {
    const { body } = await this.post<{ code?: number; data?: Array<{ url?: string | null; br?: number; code?: number; freeTrialInfo?: unknown }> }>(
      '/song/enhance/player/url/v1',
      { ids: `[${id}]`, level: 'exhigh', encodeType: 'mp3' },
      '获取播放地址',
    );
    if (body.code !== 200) throw new NeteaseError(body.code ?? -1, `获取播放地址失败（网易云返回 ${body.code}）`);
    const d = body.data?.[0];
    if (!d?.url || d.freeTrialInfo) return null;
    return { url: https(d.url), br: d.br ?? 0 };
  }

  /** 歌词：lrc 原文，trans 翻译；纯音乐、没有歌词时返回 null */
  async lyric(id: number): Promise<{ lrc: string; trans: string } | null> {
    const j = await this.get<{ code?: number; nolyric?: boolean; uncollected?: boolean; lrc?: { lyric?: string }; tlyric?: { lyric?: string } }>(`/api/song/lyric?id=${id}&lv=1&tv=1`, '获取歌词');
    if (j.code !== 200) throw new NeteaseError(j.code ?? -1, `获取歌词失败（网易云返回 ${j.code}）`);
    const lrc = j.lrc?.lyric ?? '';
    if (j.nolyric || !lrc.trim()) return null;
    return { lrc, trans: j.tlyric?.lyric ?? '' };
  }

  /** 申请登录二维码：url 是二维码里的内容 */
  async qrCreate(): Promise<{ key: string; url: string }> {
    const { body } = await this.post<{ code?: number; unikey?: string }>('/login/qrcode/unikey', { type: 1 }, '申请二维码');
    if (body.code !== 200 || !body.unikey) throw new NeteaseError(body.code ?? -1, `申请二维码失败（网易云返回 ${body.code}）`);
    return { key: body.unikey, url: `${BASE}/login?codekey=${body.unikey}` };
  }

  /** 查询扫码状态；成功时 Cookie 存进 this.cookies */
  async qrPoll(key: string): Promise<NeteaseQrState> {
    const { body, setCookie } = await this.post<{ code?: number; message?: string }>('/login/qrcode/client/login', { key, type: 1 }, '查询扫码状态');
    switch (body.code) {
      case 800:
        return 'expired';
      case 801:
        return 'waiting';
      case 802:
        return 'scanned';
      case 803:
        this.cookies = mergeSetCookie(this.cookies, setCookie);
        if (!this.loggedIn) throw new NeteaseError(803, '扫码成功了，但网易云没有返回登录信息，请重新扫码');
        return 'success';
      default:
        throw new NeteaseError(body.code ?? -1, `查询扫码状态失败（网易云返回 ${body.code}${body.message ? `：${body.message}` : ''}）`);
    }
  }

  /** 登录的账号；没登录或登录失效时返回 null */
  async account(): Promise<NeteaseAccount | null> {
    const { body } = await this.post<{ code?: number; account?: { id?: number; vipType?: number } | null; profile?: { userId?: number; nickname?: string; avatarUrl?: string; vipType?: number } | null }>(
      '/w/nuser/account/get',
      {},
      '查询网易云账号',
    );
    if (body.code !== 200) throw new NeteaseError(body.code ?? -1, `查询网易云账号失败（网易云返回 ${body.code}）`);
    if (!body.account || !body.profile) return null;
    const vipType = body.account.vipType ?? body.profile.vipType ?? 0;
    return { uid: body.profile.userId ?? body.account.id ?? 0, name: body.profile.nickname ?? '', avatar: https(body.profile.avatarUrl), vip: vipType > 0 };
  }

  /** 退出登录（让网易云那边的登录失效） */
  async logout(): Promise<void> {
    await this.post('/logout', {}, '退出网易云登录');
  }
}
