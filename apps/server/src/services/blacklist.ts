// 黑名单（需求 F-PL-08）：黑名单里的人不触发任何特效，事件照常记录。
// 主播本人、连接直播间用的账号默认也不触发（设置里可以关闭），它们不写进表里。
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { blacklist } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { BiliAccount } from './bili-account.ts';
import type { RoomStore } from './room.ts';
import type { SettingsStore } from './settings.ts';

export interface BlacklistEntry {
  uid: number;
  name: string;
  note: string;
  createdAt: number;
}

export class BlacklistStore {
  private readonly db: Db;
  private readonly settings: SettingsStore;
  private readonly room: RoomStore;
  private readonly account: BiliAccount;
  private cache: Set<number> | null = null;

  constructor(opts: { db: Db; settings: SettingsStore; room: RoomStore; account: BiliAccount }) {
    this.db = opts.db;
    this.settings = opts.settings;
    this.room = opts.room;
    this.account = opts.account;
  }

  list(): BlacklistEntry[] {
    return this.db.select().from(blacklist).orderBy(desc(blacklist.createdAt)).all();
  }

  add(e: { uid: number; name?: string; note?: string }): BlacklistEntry {
    if (this.db.select().from(blacklist).where(eq(blacklist.uid, e.uid)).get()) throw new HttpError(409, 'exists', `UID ${e.uid} 已经在黑名单里了`);
    const row = this.db.insert(blacklist).values({ uid: e.uid, name: e.name ?? '', note: e.note ?? '' }).returning().get();
    this.cache = null;
    return row;
  }

  remove(uid: number): void {
    if (this.db.delete(blacklist).where(eq(blacklist.uid, uid)).run().changes === 0) throw new HttpError(404, 'not_found', '这个用户不在黑名单里');
    this.cache = null;
  }

  /** 为什么被屏蔽；没有被屏蔽返回 null */
  reason(uid: number): 'list' | 'anchor' | 'account' | null {
    this.cache ??= new Set(this.db.select({ uid: blacklist.uid }).from(blacklist).all().map((r) => r.uid));
    if (this.cache.has(uid)) return 'list';
    if (this.settings.get('blockAnchor') && uid === this.room.get()?.anchorUid) return 'anchor';
    const acc = this.account.status();
    if (this.settings.get('blockAccount') && acc.loggedIn && uid === acc.uid) return 'account';
    return null;
  }
}
