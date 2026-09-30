// 观众昵称、头像缓存：添加专属用户、黑名单时按 UID 查询；直播时收到的消息也会更新缓存。
import { and, eq, lt, sql } from 'drizzle-orm';
import { BiliApiError, getUserCard } from '@starfall/bili';
import type { BiliHttp } from '@starfall/bili';
import type { Db } from '../db/index.ts';
import { blacklist, ruleExclusive, viewers } from '../db/schema.ts';
import { HttpError } from '../http.ts';

export interface ViewerCard {
  uid: number;
  name: string;
  face: string;
  /** 在当前直播间是大航海几级（0 不是或不知道），后台给头像套头像框 */
  guard?: number;
  /** 最近一次看到的荣耀等级（0 不知道） */
  honor?: number;
}

/** 缓存多久以后重新查询 */
const FRESH_MS = 7 * 24 * 3600_000;

export class ViewerStore {
  private readonly db: Db;
  private readonly http: () => BiliHttp;
  private readonly now: () => number;
  /** 当前直播间（大航海等级只在同一个直播间里算数） */
  private readonly roomId: () => number | null;

  constructor(db: Db, http: () => BiliHttp, now: () => number = Date.now, roomId: () => number | null = () => null) {
    this.db = db;
    this.http = http;
    this.now = now;
    this.roomId = roomId;
  }

  cached(uid: number): typeof viewers.$inferSelect | undefined {
    return this.db.select().from(viewers).where(eq(viewers.uid, uid)).get();
  }

  /** 记住昵称头像（头像为空、honor 不传时保留以前记的）；guard：这次消息里 TA 在哪个直播间是大航海几级（不传时保留以前记的） */
  remember(v: Omit<ViewerCard, 'guard'>, guard?: { level: number; roomId: number }): void {
    if (v.uid <= 0 || !v.name) return;
    const values = { uid: v.uid, name: v.name, face: v.face, updatedAt: this.now(), ...(v.honor ? { honor: v.honor } : {}), ...(guard ? { guard: guard.level, guardRoom: guard.roomId } : {}) };
    // 有的消息不带头像（例如 ENTRY_EFFECT、部分弹幕）：不要把以前记的头像清掉
    const { face, ...rest } = values;
    this.db.insert(viewers).values(values).onConflictDoUpdate({ target: viewers.uid, set: face ? values : rest }).run();
  }

  /** 在当前直播间是大航海几级（没见过、或者是在别的直播间记的，都算 0） */
  guardIn(uid: number): number {
    const c = this.cached(uid);
    const room = this.roomId();
    return c && room !== null && c.guardRoom === room ? c.guard : 0;
  }

  /** 清理很久没出现的观众（专属用户、黑名单里的保留）；keepDays 为 0 表示不清理 */
  prune(keepDays: number): number {
    if (keepDays <= 0) return 0;
    const keep = sql`${viewers.uid} not in (select ${ruleExclusive.uid} from ${ruleExclusive}) and ${viewers.uid} not in (select ${blacklist.uid} from ${blacklist})`;
    return this.db.delete(viewers).where(and(lt(viewers.updatedAt, this.now() - keepDays * 86400_000), keep)).run().changes;
  }

  /** 查询昵称头像：优先用缓存，过期或没有时问 B 站（不使用登录账号） */
  async lookup(uid: number): Promise<ViewerCard> {
    const c = this.cached(uid);
    const guard = this.guardIn(uid);
    const honor = c?.honor ?? 0;
    if (c && this.now() - c.updatedAt < FRESH_MS) return { uid: c.uid, name: c.name, face: c.face, guard, honor };
    try {
      const card = await getUserCard(this.http(), uid);
      this.remember(card);
      return { ...card, guard, honor };
    } catch (e) {
      if (c) return { uid: c.uid, name: c.name, face: c.face, guard, honor };
      if (e instanceof BiliApiError && (e.code === -404 || e.code === -626)) throw new HttpError(404, 'no_such_user', `B 站上没有 UID 为 ${uid} 的用户`);
      if (e instanceof BiliApiError) throw new HttpError(502, 'bili_error', `查询用户失败：${e.message}（B 站错误码 ${e.code}）`);
      throw new HttpError(502, 'bili_unreachable', `查询用户失败：连不上 B 站（${(e as Error).message}）`);
    }
  }
}
