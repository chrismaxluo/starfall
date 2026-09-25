// 带 Cookie 的 B 站请求。登录信息（Cookie）只在内存里使用，由服务端负责加密存储。

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class BiliApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BiliApiError';
    this.code = code;
  }
}

export type Cookies = Record<string, string>;

export interface GetOptions {
  /** 是否带登录 Cookie（默认带；公开接口可以不带，减少账号的使用） */
  auth?: boolean;
  referer?: string;
}

export class BiliHttp {
  cookies: Cookies;

  constructor(cookies: Cookies = {}) {
    this.cookies = { ...cookies };
  }

  get uid(): number {
    return Number(this.cookies.DedeUserID) || 0;
  }

  get loggedIn(): boolean {
    return Boolean(this.cookies.SESSDATA);
  }

  private cookieHeader(auth: boolean): string {
    const keep = auth ? Object.entries(this.cookies) : Object.entries(this.cookies).filter(([k]) => k.startsWith('buvid'));
    return keep.map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(url: string, opts: GetOptions = {}): Promise<Response> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: opts.referer ?? 'https://live.bilibili.com/',
        Origin: 'https://live.bilibili.com',
        Cookie: this.cookieHeader(opts.auth ?? true),
      },
      signal: AbortSignal.timeout(15_000),
    });
    return res;
  }

  /** 请求并检查 B 站的 code 字段，code 不为 0 时抛出 BiliApiError */
  async getData<T = unknown>(url: string, opts: GetOptions = {}): Promise<T> {
    const res = await this.request(url, opts);
    const text = await res.text();
    let json: { code?: number; message?: string; msg?: string; data?: unknown };
    try {
      json = JSON.parse(text);
    } catch {
      throw new BiliApiError(-1, `B 站返回了非 JSON 内容（HTTP ${res.status}）`);
    }
    if (json.code !== 0) throw new BiliApiError(json.code ?? -1, json.message || json.msg || '未知错误');
    return json.data as T;
  }

  /** 没有 buvid3 时领取一个（连接弹幕服务器需要） */
  async ensureBuvid(): Promise<string> {
    if (!this.cookies.buvid3) {
      const d = await this.getData<{ b_3: string; b_4: string }>('https://api.bilibili.com/x/frontend/finger/spi', { auth: false });
      this.cookies.buvid3 = d.b_3;
      this.cookies.buvid4 = d.b_4;
    }
    return this.cookies.buvid3;
  }
}
