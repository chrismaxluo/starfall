// 本直播间的礼物面板（选择"指定礼物"用；F-GF-01、F-GF-05）。公开接口，缓存 1 小时。
import { getRoomGifts } from '@starfall/bili';
import type { BiliHttp, GiftConfig } from '@starfall/bili';
import { HttpError } from '../http.ts';
import type { RoomStore } from './room.ts';

const TTL_MS = 3600_000;

export class GiftCatalog {
  private readonly room: RoomStore;
  private readonly http: () => BiliHttp;
  private readonly fetchGifts: typeof getRoomGifts;
  private cache: { roomId: number; at: number; gifts: GiftConfig[] } | null = null;

  constructor(room: RoomStore, http: () => BiliHttp, fetchGifts: typeof getRoomGifts = getRoomGifts) {
    this.room = room;
    this.http = http;
    this.fetchGifts = fetchGifts;
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
    return hit?.icon || undefined;
  }

  private refreshing: Promise<void> | null = null;
  private autoRefresh = false;

  /** 服务启动时调用：先读一次礼物面板，之后查不到礼物图时自动在后台刷新 */
  start(): void {
    this.autoRefresh = true;
    if (this.room.get()) void this.list().catch(() => undefined);
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
