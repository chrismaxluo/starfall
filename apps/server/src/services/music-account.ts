// 网易云账号（点歌用）：扫码登录、加密保存、定时确认登录还有效、退出。没登录也能点免费歌。
import QRCode from 'qrcode';
import { Netease } from '@starfall/music';
import type { Cookies, NeteaseOptions, NeteaseQrState } from '@starfall/music';
import type { Secret } from './secret.ts';
import type { SettingsStore } from './settings.ts';

const KEY = 'neteaseAccount';
/** 多久确认一次登录还有效、会员有没有到期 */
const CHECK_MS = 6 * 3600_000;
/** 扫码登录的二维码最多同时留几个（每打开一次扫码窗口申请一个） */
const QR_KEEP = 5;

interface Saved {
  uid: number;
  name: string;
  avatar: string;
  vip: boolean;
  cookiesEnc: string;
  updatedAt: number;
  checkedAt: number;
  /** 网易云说登录已经失效 */
  invalid?: boolean;
}

export interface MusicAccountStatus {
  loggedIn: boolean;
  uid?: number;
  name?: string;
  avatar?: string;
  vip?: boolean;
  /** 登录失效了，要重新扫码 */
  invalid?: boolean;
  checkedAt?: number;
}

export class MusicAccount {
  private readonly settings: SettingsStore;
  private readonly secret: Secret;
  private readonly opts: NeteaseOptions;
  private readonly listeners = new Set<() => void>();
  /** 正在扫码的登录：二维码 key → 那次登录用的请求对象（登录信息在它身上） */
  private readonly pending = new Map<string, Netease>();
  private cached: Netease | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private decryptWarned = false;

  constructor(settings: SettingsStore, secret: Secret, opts: NeteaseOptions = {}) {
    this.settings = settings;
    this.secret = secret;
    this.opts = opts;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private saved(): Saved | undefined {
    return this.settings.getRaw<Saved>(KEY);
  }

  /** 网易云的请求对象：登录了就带上登录信息（登录信息解不开时当作没登录） */
  client(): Netease {
    if (this.cached) return this.cached;
    const s = this.saved();
    let cookies: Cookies = {};
    if (s) {
      try {
        cookies = JSON.parse(this.secret.decrypt(s.cookiesEnc)) as Cookies;
      } catch (e) {
        if (!this.decryptWarned) console.error('网易云登录信息无法解密（密钥文件可能换过），请重新扫码登录：', (e as Error).message);
        this.decryptWarned = true;
      }
    }
    this.cached = new Netease(cookies, this.opts);
    return this.cached;
  }

  status(): MusicAccountStatus {
    const s = this.saved();
    if (!s) return { loggedIn: false };
    return { loggedIn: true, uid: s.uid, name: s.name, avatar: s.avatar, vip: s.vip, checkedAt: s.checkedAt, ...(s.invalid ? { invalid: true } : {}) };
  }

  /** 会员能放会员歌（登录失效时不算） */
  vip(): boolean {
    const s = this.saved();
    return Boolean(s?.vip && !s.invalid);
  }

  async startQr(): Promise<{ key: string; image: string }> {
    const n = new Netease({}, this.opts);
    const qr = await n.qrCreate();
    this.pending.set(qr.key, n);
    while (this.pending.size > QR_KEEP) this.pending.delete(this.pending.keys().next().value!);
    return { key: qr.key, image: await QRCode.toDataURL(qr.url, { width: 360, margin: 1 }) };
  }

  /** 查询扫码状态；成功时保存登录信息（加密） */
  async pollQr(key: string): Promise<NeteaseQrState> {
    const n = this.pending.get(key);
    if (!n) return 'expired';
    const state = await n.qrPoll(key);
    if (state === 'expired') this.pending.delete(key);
    if (state === 'success') {
      this.pending.delete(key);
      const acc = await n.account().catch(() => null);
      const now = Date.now();
      this.settings.setRaw(KEY, { uid: acc?.uid ?? 0, name: acc?.name ?? '', avatar: acc?.avatar ?? '', vip: acc?.vip ?? false, cookiesEnc: this.secret.encrypt(JSON.stringify(n.cookies)), updatedAt: now, checkedAt: now } satisfies Saved);
      this.cached = null;
      this.emit();
    }
    return state;
  }

  /** 确认登录还有效、会员有没有到期（网易云连不上时不改） */
  async check(): Promise<MusicAccountStatus> {
    const s = this.saved();
    if (!s) return this.status();
    try {
      const acc = await this.client().account();
      const next: Saved = acc ? { ...s, uid: acc.uid || s.uid, name: acc.name || s.name, avatar: acc.avatar || s.avatar, vip: acc.vip, checkedAt: Date.now() } : { ...s, invalid: true, checkedAt: Date.now() };
      if (acc) delete next.invalid;
      this.settings.setRaw(KEY, next);
      if (next.invalid !== s.invalid || next.vip !== s.vip || next.name !== s.name) this.emit();
    } catch (e) {
      console.warn('[点歌] 确认网易云登录失败：', (e as Error).message);
    }
    return this.status();
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 退出登录：先让网易云那边的登录失效（失败也删掉本地的） */
  async logout(): Promise<void> {
    if (this.saved()) await this.client().logout().catch((e: Error) => console.warn('[点歌] 网易云退出登录失败：', e.message));
    this.settings.deleteRaw(KEY);
    this.cached = null;
    this.emit();
  }
}
