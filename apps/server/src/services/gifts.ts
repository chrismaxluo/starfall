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
