// B站礼物全屏动画（「B站动画」样式用）：动画列表一天读一次；每个动画的排布说明第一次用到时读，记在内存里。
// 播放判断不能等 B 站接口：查不到（还没读到、读失败、这个礼物没有动画）就按没有动画处理，同时在后台去读，下一次就有了
import { getGiftEffectLayout, getGiftEffects } from '@starfall/bili';
import type { BiliHttp, GiftConfig, GiftEffectFile, GiftEffectLayout } from '@starfall/bili';
import type { GiftFx } from '@starfall/shared';

const LIST_TTL_MS = 24 * 3600_000;
/** 读失败后多久再试 */
const RETRY_MS = 600_000;

export interface GiftFxHit {
  fx: GiftFx;
  durationMs: number;
}

export class GiftEffects {
  private readonly http: () => BiliHttp;
  private readonly fetchList: typeof getGiftEffects;
  private readonly fetchLayout: typeof getGiftEffectLayout;
  private files: Map<number, GiftEffectFile> | null = null;
  private listAt = 0;
  private listTriedAt = 0;
  private loadingList: Promise<void> | null = null;
  private readonly layouts = new Map<number, GiftEffectLayout>();
  private readonly layoutTriedAt = new Map<number, number>();
  private readonly loading = new Map<number, Promise<void>>();
  /** 服务启动后才去 B 站读（测试里不联网） */
  private started = false;

  constructor(http: () => BiliHttp, fetchList: typeof getGiftEffects = getGiftEffects, fetchLayout: typeof getGiftEffectLayout = getGiftEffectLayout) {
    this.http = http;
    this.fetchList = fetchList;
    this.fetchLayout = fetchLayout;
  }

  /** 服务启动时调用：读动画列表，再把本直播间礼物面板上有动画的礼物提前读好 */
  start(panel: () => Promise<GiftConfig[]>): void {
    this.started = true;
    void this.loadList()
      .then(() => panel())
      .then((gifts) => Promise.all(gifts.map((g) => (g.effectId ? this.loadLayout(g.effectId) : undefined))))
      .catch(() => undefined);
  }

  /** 这个礼物的全屏动画和时长（只查内存）；没有动画或还没读到时为 undefined */
  forGift(g: GiftConfig | undefined): GiftFxHit | undefined {
    if (!g?.effectId) return undefined;
    if (this.started) void this.loadList();
    const file = this.files?.get(g.effectId);
    if (!file) return undefined;
    const l = this.layouts.get(g.effectId);
    if (!l) {
      if (this.started) void this.loadLayout(g.effectId);
      return undefined;
    }
    return { fx: { src: file.mp4, w: l.w, h: l.h, videoW: l.videoW, videoH: l.videoH, rgb: l.rgb, alpha: l.alpha }, durationMs: l.durationMs };
  }

  /** 预览前调用：最多等 ms 毫秒把这个礼物的动画读好（第一次预览也能看到动画） */
  async ready(g: GiftConfig | undefined, ms = 3000): Promise<void> {
    if (!this.started || !g?.effectId) return;
    const id = g.effectId;
    const work = (async () => {
      await this.loadList(true);
      await this.loadLayout(id, true);
    })();
    await Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
  }

  private loadList(force = false): Promise<void> {
    const now = Date.now();
    if (this.loadingList) return this.loadingList;
    if (this.files && now - this.listAt < LIST_TTL_MS) return Promise.resolve();
    if (!force && now - this.listTriedAt < RETRY_MS) return Promise.resolve();
    this.listTriedAt = now;
    this.loadingList = this.fetchList(this.http())
      .then((files) => {
        this.files = files;
        this.listAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => (this.loadingList = null));
    return this.loadingList;
  }

  private loadLayout(id: number, force = false): Promise<void> {
    const pending = this.loading.get(id);
    if (pending) return pending;
    if (this.layouts.has(id)) return Promise.resolve();
    const file = this.files?.get(id);
    if (!file || (!force && Date.now() - (this.layoutTriedAt.get(id) ?? 0) < RETRY_MS)) return Promise.resolve();
    this.layoutTriedAt.set(id, Date.now());
    const p = this.fetchLayout(this.http(), file.json)
      .then((l) => void this.layouts.set(id, l))
      .catch(() => undefined)
      .finally(() => this.loading.delete(id));
    this.loading.set(id, p);
    return p;
  }
}
