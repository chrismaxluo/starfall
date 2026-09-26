// 直播间设置（需求 F-BL-03）
import { eq } from 'drizzle-orm';
import { getRoomInit, getUserCard } from '@starfall/bili';
import type { BiliHttp } from '@starfall/bili';
import type { Db } from '../db/index.ts';
import { room } from '../db/schema.ts';

export interface RoomRecord {
  roomId: number;
  shortId: number;
  anchorUid: number;
  anchorName: string;
}

export class RoomStore {
  private readonly db: Db;
  private readonly listeners = new Set<() => void>();

  constructor(db: Db) {
    this.db = db;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(): RoomRecord | null {
    const r = this.db.select().from(room).where(eq(room.id, 1)).get();
    return r ? { roomId: r.roomId, shortId: r.shortId, anchorUid: r.anchorUid, anchorName: r.anchorName } : null;
  }

  /** 设置房间号（短号、长号都可以），自动换算长号并取主播信息 */
  async set(http: BiliHttp, id: number): Promise<RoomRecord> {
    const init = await getRoomInit(http, id);
    let anchorName = '';
    try {
      anchorName = (await getUserCard(http, init.anchorUid)).name;
    } catch {
      /* 取不到昵称不影响设置 */
    }
    return this.save({ roomId: init.roomId, shortId: init.shortId, anchorUid: init.anchorUid, anchorName });
  }

  /** 保存直播间并通知（换直播间） */
  save(r: RoomRecord): RoomRecord {
    const values = { id: 1, ...r, updatedAt: Date.now() };
    this.db.insert(room).values(values).onConflictDoUpdate({ target: room.id, set: values }).run();
    for (const fn of this.listeners) fn();
    return this.get()!;
  }
}
