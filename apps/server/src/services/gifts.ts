// 本直播间的礼物面板（选择"指定礼物"用；F-GF-01、F-GF-05）。公开接口，缓存 1 小时。
import { getAllGifts, getRoomGifts } from '@starfall/bili';
import type { BiliHttp, GiftConfig } from '@starfall/bili';
import { HttpError } from '../http.ts';
import type { RoomStore } from './room.ts';

const TTL_MS = 3600_000;
/** 全站礼物列表变化很慢，一天读一次 */
const ALL_TTL_MS = 24 * 3600_000;

export class GiftCatalog {
  private readonly room: RoomStore;
  private readonly http: () => BiliHttp;
  private readonly fetchGifts: typeof getRoomGifts;
  private readonly fetchAll: typeof getAllGifts;
  private cache: { roomId: number; at: number; gifts: GiftConfig[] } | null = null;
  private all: { at: number; icons: Map<number, string> } | null = null;
  private loadingAll: Promise<void> | null = null;
  private allTriedAt = 0;

  constructor(room: RoomStore, http: () => BiliHttp, fetchGifts: typeof getRoomGifts = getRoomGifts, fetchAll: typeof getAllGifts = getAllGifts) {
    this.room = room;
    this.http = http;
    this.fetchGifts = fetchGifts;
    this.fetchAll = fetchAll;
  }

  /**
   * 礼物图（播放礼物特效用）：只查缓存，不等网络；缓存里没有时在后台刷新一次，下一次就有了。
   * 播放判断不能等 B 站接口，查不到就不显示礼物图
   */
  iconFor(giftId: number): string | undefined {
    const room = this.room.get();
    const c = this.cache;
    const hit = c && room && c.roomId === room.roomId ? c.gifts.find((g) => g.id === giftId) : undefined;
    if (this.autoRefresh && !hit && room && !this.refreshing && (!c || c.roomId !== room.roomId || Date.now() - c.at > 60_000)) {
      this.refreshing = this.list(true).then(() => undefined, () => undefined).finally(() => (this.refreshing = null));
    }
    if (hit?.icon) return hit.icon;
    // 面板里没有（别的直播间的礼物、下架的活动礼物等）：查全站礼物列表
    const any = this.all?.icons.get(giftId);
    if (this.autoRefresh && !any) this.loadAll();
    return any;
  }

  /** 按名字找礼物图（预览时后台只给了名字）：只查本直播间礼物面板的缓存 */
  iconByName(name: string): string | undefined {
    const room = this.room.get();
    const c = this.cache;
    if (!c || !room || c.roomId !== room.roomId) return undefined;
    return c.gifts.find((g) => g.name === name && g.icon)?.icon;
  }

  /** 读全站礼物列表（只留图）；失败时最多 10 分钟再试一次 */
  private loadAll(): void {
    const now = Date.now();
    if (this.loadingAll || (this.all && now - this.all.at < ALL_TTL_MS) || now - this.allTriedAt < 600_000) return;
    this.allTriedAt = now;
    this.loadingAll = this.fetchAll(this.http())
      .then((gifts) => void (this.all = { at: Date.now(), icons: new Map(gifts.filter((g) => g.icon).map((g) => [g.id, g.icon])) }))
      .catch(() => undefined)
      .finally(() => (this.loadingAll = null));
  }

  private refreshing: Promise<void> | null = null;
  private autoRefresh = false;

  /** 服务启动时调用：先读一次礼物面板，之后查不到礼物图时自动在后台刷新 */
  start(): void {
    this.autoRefresh = true;
    if (this.room.get()) void this.list().catch(() => undefined);
    this.loadAll();
  }

  async list(refresh = false): Promise<GiftConfig[]> {
    const room = this.room.get();
    if (!room) throw new HttpError(409, 'no_room', '请先在设置里填写直播间号');
    const c = this.cache;
    if (!refresh && c && c.roomId === room.roomId && Date.now() - c.at < TTL_MS) return c.gifts;
    try {
      const gifts = await this.fetchGifts(this.http(), room.roomId);
      this.cache = { roomId: room.roomId, at: Date.now(), gifts };
      return gifts;
    } catch (e) {
      if (c && c.roomId === room.roomId) return c.gifts;
      throw new HttpError(502, 'bili_unreachable', `读取礼物面板失败：${(e as Error).message}`);
    }
  }
}
