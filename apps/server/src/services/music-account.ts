// 网易云账号（点歌用）：扫码登录、加密保存、定时确认登录还有效、会员类型和到哪天、退出。没登录也能点免费歌。
// 另外记着最近拿播放地址的情况：连着几首拿不到，多半是网易云改了限制，后台据此提醒。
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
  /** 会员类型（黑胶VIP 等）；查不到时没有 */
  vipKind?: string;
  /** 会员到期时间（已经到期的是上一次的到期时间）；查不到时没有 */
  vipUntil?: number;
  cookiesEnc: string;
  updatedAt: number;
  checkedAt: number;
  /** 网易云说登录已经失效 */
  invalid?: boolean;
}

/** 最近拿网易云播放地址的情况（只记在内存里，重启后从头算） */
export interface MusicUrlHealth {
  /** 连着几首没拿到 */
  fails: number;
  okAt?: number;
  okName?: string;
  failAt?: number;
  failText?: string;
}

export interface MusicAccountStatus {
  loggedIn: boolean;
  uid?: number;
  name?: string;
  avatar?: string;
  /** 现在能放会员歌（会员到期、登录失效都不算） */
  vip?: boolean;
  vipKind?: string;
  vipUntil?: number;
  /** 登录失效了，要重新扫码 */
  invalid?: boolean;
  checkedAt?: number;
  urls: MusicUrlHealth;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class MusicAccount {
  private readonly settings: SettingsStore;
  private readonly secret: Secret;
  private readonly opts: NeteaseOptions;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  /** 正在扫码的登录：二维码 key → 那次登录用的请求对象（登录信息在它身上） */
  private readonly pending = new Map<string, Netease>();
  private cached: Netease | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 快到期时，到点再确认一次 */
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private checking: Promise<MusicAccountStatus> | null = null;
  private decryptWarned = false;
  private urls: MusicUrlHealth = { fails: 0 };
  /** 最近没拿到地址的那首（「现在重试」用） */
  private failed: { id: number; name: string } | null = null;

  constructor(settings: SettingsStore, secret: Secret, opts: NeteaseOptions = {}, now: () => number = Date.now) {
    this.settings = settings;
    this.secret = secret;
    this.opts = opts;
    this.now = now;
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

  /** 现在是不是会员：登录失效、过了到期时间都不算 */
  private vipNow(s: Saved): boolean {
    return s.vip && !s.invalid && !(s.vipUntil !== undefined && s.vipUntil <= this.now());
  }

  status(): MusicAccountStatus {
    const s = this.saved();
    const urls = { ...this.urls };
    if (!s) return { loggedIn: false, urls };
    return {
      loggedIn: true,
      uid: s.uid,
      name: s.name,
      avatar: s.avatar,
      vip: this.vipNow(s),
      ...(s.vipKind ? { vipKind: s.vipKind } : {}),
      ...(s.vipUntil !== undefined ? { vipUntil: s.vipUntil } : {}),
      checkedAt: s.checkedAt,
      ...(s.invalid ? { invalid: true } : {}),
      urls,
    };
  }

  /** 会员能放会员歌（登录失效、到期时不算） */
  vip(): boolean {
    const s = this.saved();
    return s ? this.vipNow(s) : false;
  }

  /**
   * 账号接口说的会员 + 会员接口的类型和到期时间。会员接口查不到时沿用上次的；
   * 账号说还是会员、到期时间却已经过了（会员接口没跟上）：到期时间当作不知道，免得把会员歌拦掉
   */
  private async vipFields(n: Netease, accVip: boolean, prev?: Saved): Promise<Pick<Saved, 'vip' | 'vipKind' | 'vipUntil'>> {
    const v = await n.vipInfo(this.now()).catch((e: Error) => {
      console.warn('[点歌] 查询网易云会员到期时间失败：', e.message);
      return null;
    });
    const vip = accVip || Boolean(v?.active);
    const kind = v ? v.kind : (prev?.vipKind ?? null);
    let until = v ? v.until : (prev?.vipUntil ?? null);
    if (vip && until !== null && until <= this.now()) until = null;
    return { vip, ...(kind ? { vipKind: kind } : {}), ...(until !== null ? { vipUntil: until } : {}) };
  }

  async startQr(): Promise<{ key: string; image: string }> {
    const n = new Netease({}, this.opts);
    const qr = await n.qrCreate();
    this.pending.set(qr.key, n);
    while (this.pending.size > QR_KEEP) this.pending.delete(this.pending.keys().next().value!);
    return { key: qr.key, image: await QRCode.toDataURL(qr.url, { width: 360, margin: 1 }) };
  }

  /** 查询扫码状态；成功时保存登录信息（加密）和会员情况 */
  async pollQr(key: string): Promise<NeteaseQrState> {
    const n = this.pending.get(key);
    if (!n) return 'expired';
    const state = await n.qrPoll(key);
    if (state === 'expired') this.pending.delete(key);
    if (state === 'success') {
      this.pending.delete(key);
      const acc = await n.account().catch(() => null);
      const vip = await this.vipFields(n, acc?.vip ?? false);
      const now = this.now();
      this.settings.setRaw(KEY, { uid: acc?.uid ?? 0, name: acc?.name ?? '', avatar: acc?.avatar ?? '', ...vip, cookiesEnc: this.secret.encrypt(JSON.stringify(n.cookies)), updatedAt: now, checkedAt: now } satisfies Saved);
      this.cached = null;
      this.scheduleExpiry();
      this.emit();
    }
    return state;
  }

  /** 确认登录还有效、会员有没有到期（网易云连不上时不改）；同时只查一次 */
  check(): Promise<MusicAccountStatus> {
    this.checking ??= this.doCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async doCheck(): Promise<MusicAccountStatus> {
    const s = this.saved();
    if (!s) return this.status();
    try {
      const n = this.client();
      const acc = await n.account();
      let next: Saved;
      if (acc) {
        // 会员类型、到期时间、失效：都以这次查到的为准
        const base: Saved = { ...s };
        delete base.vipKind;
        delete base.vipUntil;
        delete base.invalid;
        next = { ...base, uid: acc.uid || s.uid, name: acc.name || s.name, avatar: acc.avatar || s.avatar, ...(await this.vipFields(n, acc.vip, s)), checkedAt: this.now() };
        if (next.vip !== s.vip || next.vipKind !== s.vipKind || next.vipUntil !== s.vipUntil) {
          console.log(`[点歌] 网易云会员：${next.vip ? (next.vipKind ?? '会员') : '不是会员'}${next.vipUntil ? `，到期 ${day(next.vipUntil)}` : next.vip ? '，到期时间查不到' : ''}`);
        }
      } else next = { ...s, invalid: true, checkedAt: this.now() };
      // 确认期间退出了、或者扫码换了账号：这次的结果是旧账号的，丢掉（不然会把旧账号写回去）
      if (this.saved()?.cookiesEnc !== s.cookiesEnc) return this.status();
      this.settings.setRaw(KEY, next);
      this.scheduleExpiry();
      // 每次都发：后台显示「刚刚确认过」
      this.emit();
    } catch (e) {
      console.warn('[点歌] 确认网易云登录失败：', (e as Error).message);
    }
    return this.status();
  }

  /** 会员几小时内到期：到点就不算会员了（会员歌不再放），再确认一次（可能已经续费） */
  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const s = this.saved();
    if (!s || !this.vipNow(s) || s.vipUntil === undefined) return;
    const wait = s.vipUntil - this.now();
    if (wait > CHECK_MS) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.emit();
      void this.check();
    }, wait + 1000);
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.timer = this.expiryTimer = null;
  }

  /** 退出登录：先让网易云那边的登录失效（失败也删掉本地的） */
  async logout(): Promise<void> {
    if (this.saved()) await this.client().logout().catch((e: Error) => console.warn('[点歌] 网易云退出登录失败：', e.message));
    this.settings.deleteRaw(KEY);
    this.cached = null;
    this.scheduleExpiry();
    this.emit();
  }

  // ---------- 拿播放地址的情况 ----------

  /** 放歌时拿网易云播放地址的结果 */
  urlResult(ok: boolean, song: { id: number; name: string }, text = ''): void {
    if (ok) {
      this.urls = { fails: 0, okAt: this.now(), okName: song.name };
      this.failed = null;
    } else {
      this.urls = { ...this.urls, fails: this.urls.fails + 1, failAt: this.now(), failText: text };
      this.failed = song;
    }
    this.emit();
  }

  /** 后台「现在重试」：拿刚才没拿到的那首的播放地址试试；拿到了就算恢复了 */
  async retryUrl(): Promise<{ ok: boolean; text: string }> {
    const f = this.failed;
    if (!f) return { ok: true, text: '最近没有拿不到的歌' };
    let why = '还是拿不到播放地址';
    try {
      if ((await this.client().songUrl(f.id)) !== null) {
        this.urlResult(true, f);
        return { ok: true, text: `《${f.name}》能拿到了` };
      }
    } catch (e) {
      why = (e as Error).message;
    }
    // 重试不算新的一首：只更新时间和原因
    this.urls = { ...this.urls, failAt: this.now(), failText: why };
    this.emit();
    return { ok: false, text: `《${f.name}》${why}` };
  }
}
