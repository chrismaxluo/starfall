// 荣耀等级勋章（B 站每级一张图，数字画在图上）：每天从 B 站读一次，存进设置表；B 站连不上时用上次存的。
// 图的版权归 B 站：只记地址，特效页和后台运行时从 B 站加载。
import { getHonorMedals } from '@starfall/bili';
import type { BiliHttp, HonorMedal } from '@starfall/bili';
import type { SettingsStore } from './settings.ts';

const KEY = 'honorMedals';
const TTL_MS = 24 * 3600_000;
/** 读失败后多久再试 */
const RETRY_MS = 10 * 60_000;
const CHECK_MS = 3600_000;

interface Saved {
  at: number;
  medals: HonorMedal[];
}

export class HonorMedals {
  private readonly settings: SettingsStore;
  private readonly http: () => BiliHttp;
  private readonly fetch: typeof getHonorMedals;
  private readonly now: () => number;
  private saved: Saved | null;
  private urls = new Map<number, string>();
  private loading: Promise<void> | null = null;
  private triedAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(settings: SettingsStore, http: () => BiliHttp, fetch: typeof getHonorMedals = getHonorMedals, now: () => number = Date.now) {
    this.settings = settings;
    this.http = http;
    this.fetch = fetch;
    this.now = now;
    this.saved = settings.getRaw<Saved>(KEY) ?? null;
    this.index();
  }

  /** 这一级的勋章图；不知道时为 undefined（界面上改成显示文字） */
  urlFor(level: number | undefined): string | undefined {
    return level ? this.urls.get(level) : undefined;
  }

  /** 后台显示用：每一级的图 */
  list(): { medals: Array<{ level: number; url: string }>; updatedAt: number | null } {
    return { medals: (this.saved?.medals ?? []).map((m) => ({ level: m.level, url: m.url })), updatedAt: this.saved?.at ?? null };
  }

  /** 服务启动时调用：过期了就重新读，之后每小时看一次要不要读 */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** force：不管有没有过期都读（测试用） */
  refresh(force = false): Promise<void> {
    const now = this.now();
    if (this.loading) return this.loading;
    if (!force && ((this.saved && now - this.saved.at < TTL_MS) || now - this.triedAt < RETRY_MS)) return Promise.resolve();
    this.triedAt = now;
    this.loading = this.fetch(this.http())
      .then((medals) => {
        if (!medals.length) throw new Error('列表是空的');
        this.saved = { at: this.now(), medals };
        this.settings.setRaw(KEY, this.saved);
        this.index();
      })
      .catch((e: Error) => console.error('读取荣耀等级勋章失败', e.message))
      .finally(() => (this.loading = null));
    return this.loading;
  }

  private index(): void {
    this.urls = new Map((this.saved?.medals ?? []).map((m) => [m.level, m.url]));
  }
}
