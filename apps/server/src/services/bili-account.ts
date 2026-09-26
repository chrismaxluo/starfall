// B 站账号（需求 F-BL-01 ~ 02）：扫码登录、加密保存、退出（同时让 B 站那边的登录失效）。
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { BiliHttp, createLoginQrCode, getUserCard, logoutRemote, pollLoginQrCode } from '@starfall/bili';
import type { Cookies, QrState } from '@starfall/bili';
import type { Db } from '../db/index.ts';
import { account } from '../db/schema.ts';
import type { Secret } from './secret.ts';

export interface AccountStatus {
  loggedIn: boolean;
  uid?: number;
  name?: string;
  face?: string;
  /** 登录有效期（毫秒时间戳），未知为 null */
  expiresAt?: number | null;
}

export class BiliAccount {
  private readonly db: Db;
  private readonly secret: Secret;
  private readonly listeners = new Set<() => void>();
  private decryptWarned = false;
  /** 公开接口和扫码用的匿名请求（不带登录信息） */
  readonly anon = new BiliHttp();

  constructor(db: Db, secret: Secret) {
    this.db = db;
    this.secret = secret;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 已登录时返回带登录信息的请求对象，否则返回 null（登录信息无法解密时也当作未登录） */
  http(): BiliHttp | null {
    const row = this.db.select().from(account).where(eq(account.id, 1)).get();
    if (!row) return null;
    let cookies: Cookies;
    try {
      cookies = JSON.parse(this.secret.decrypt(row.cookiesEnc)) as Cookies;
    } catch (e) {
      if (!this.decryptWarned) console.error('B 站登录信息无法解密（密钥文件可能换过），请重新扫码登录：', (e as Error).message);
      this.decryptWarned = true;
      return null;
    }
    // 设备标识沿用同一个，避免每次连接都换新设备
    if (this.anon.cookies.buvid3) cookies.buvid3 ??= this.anon.cookies.buvid3;
    if (this.anon.cookies.buvid4) cookies.buvid4 ??= this.anon.cookies.buvid4;
    const http = new BiliHttp(cookies);
    const ensure = http.ensureBuvid.bind(http);
    http.ensureBuvid = async () => {
      const b = await ensure();
      if (http.cookies.buvid3) this.anon.cookies.buvid3 ??= http.cookies.buvid3;
      if (http.cookies.buvid4) this.anon.cookies.buvid4 ??= http.cookies.buvid4;
      return b;
    };
    return http;
  }

  status(): AccountStatus {
    const row = this.db.select().from(account).where(eq(account.id, 1)).get();
    if (!row) return { loggedIn: false };
    return { loggedIn: true, uid: row.uid, name: row.name, face: row.face, expiresAt: row.expiresAt };
  }

  /** 申请登录二维码，返回二维码图片（data URL）和查询用的 key */
  async startQrLogin(): Promise<{ key: string; image: string }> {
    const qr = await createLoginQrCode(this.anon);
    const image = await QRCode.toDataURL(qr.url, { width: 360, margin: 1 });
    return { key: qr.key, image };
  }

  /** 查询扫码状态；成功时保存登录信息 */
  async pollQrLogin(key: string): Promise<QrState['state']> {
    const r = await pollLoginQrCode(this.anon, key);
    if (r.state === 'success') await this.save(r.cookies, r.refreshToken, r.expiresAt);
    return r.state;
  }

  async save(cookies: Cookies, refreshToken: string, expiresAt: number | null): Promise<void> {
    const uid = Number(cookies.DedeUserID) || 0;
    let name = '';
    let face = '';
    try {
      const card = await getUserCard(new BiliHttp(cookies), uid);
      name = card.name;
      face = card.face;
    } catch {
      /* 取不到昵称不影响登录 */
    }
    const values = {
      id: 1,
      uid,
      name,
      face,
      cookiesEnc: this.secret.encrypt(JSON.stringify(cookies)),
      refreshTokenEnc: refreshToken ? this.secret.encrypt(refreshToken) : '',
      expiresAt,
      updatedAt: Date.now(),
    };
    this.db.insert(account).values(values).onConflictDoUpdate({ target: account.id, set: values }).run();
    this.emit();
  }

  /** 退出登录：先让 B 站那边的登录失效，再删除本地记录。B 站接口失败时仍删除本地记录，并返回失败原因 */
  async logout(): Promise<{ remote: 'ok' | 'failed'; message?: string }> {
    const http = this.http();
    let result: { remote: 'ok' | 'failed'; message?: string } = { remote: 'ok' };
    if (http) {
      try {
        await logoutRemote(http);
      } catch (e) {
        result = { remote: 'failed', message: (e as Error).message };
      }
    }
    this.db.delete(account).where(eq(account.id, 1)).run();
    this.emit();
    return result;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
