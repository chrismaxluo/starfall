// WBI 签名：部分接口（如 getDanmuInfo）要求在参数里带 w_rid / wts。
import crypto from 'node:crypto';
import type { BiliHttp } from './http.ts';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
}

export function signQuery(params: Record<string, string | number>, key: string, now = Date.now()): string {
  const all: Record<string, string | number> = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${crypto.createHash('md5').update(query + key).digest('hex')}`;
}

/** 签名密钥缓存一小时 */
export class WbiSigner {
  private key: string | null = null;
  private at = 0;
  private readonly http: BiliHttp;

  constructor(http: BiliHttp) {
    this.http = http;
  }

  async sign(params: Record<string, string | number>): Promise<string> {
    if (!this.key || Date.now() - this.at > 3600_000) {
      // nav 未登录时返回 code -101，但仍带签名密钥，所以这里不用 getData
      const res = await this.http.request('https://api.bilibili.com/x/web-interface/nav', { auth: false });
      const json = (await res.json()) as { data?: { wbi_img?: { img_url: string; sub_url: string } } };
      const img = json.data?.wbi_img;
      if (!img) throw new Error('获取 WBI 签名密钥失败');
      const stem = (u: string) => u.slice(u.lastIndexOf('/') + 1).split('.')[0] ?? '';
      this.key = mixinKey(stem(img.img_url), stem(img.sub_url));
      this.at = Date.now();
    }
    return signQuery(params, this.key);
  }
}
