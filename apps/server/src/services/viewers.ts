// 观众昵称、头像缓存：添加专属用户、黑名单时按 UID 查询；直播时收到的消息也会更新缓存。
import { eq } from 'drizzle-orm';
import { BiliApiError, getUserCard } from '@starfall/bili';
import type { BiliHttp } from '@starfall/bili';
import type { Db } from '../db/index.ts';
import { viewers } from '../db/schema.ts';
import { HttpError } from '../http.ts';

export interface ViewerCard {
  uid: number;
  name: string;
  face: string;
}

/** 缓存多久以后重新查询 */
const FRESH_MS = 7 * 24 * 3600_000;

export class ViewerStore {
  private readonly db: Db;
  private readonly http: () => BiliHttp;
  private readonly now: () => number;

  constructor(db: Db, http: () => BiliHttp, now: () => number = Date.now) {
    this.db = db;
    this.http = http;
    this.now = now;
  }

  cached(uid: number): (ViewerCard & { updatedAt: number }) | undefined {
    return this.db.select().from(viewers).where(eq(viewers.uid, uid)).get();
  }

  remember(v: ViewerCard): void {
    if (v.uid <= 0 || !v.name) return;
    const values = { ...v, updatedAt: this.now() };
    this.db.insert(viewers).values(values).onConflictDoUpdate({ target: viewers.uid, set: values }).run();
  }

  /** 查询昵称头像：优先用缓存，过期或没有时问 B 站（不使用登录账号） */
  async lookup(uid: number): Promise<ViewerCard> {
    const c = this.cached(uid);
    if (c && this.now() - c.updatedAt < FRESH_MS) return { uid: c.uid, name: c.name, face: c.face };
    try {
      const card = await getUserCard(this.http(), uid);
      this.remember(card);
      return card;
    } catch (e) {
      if (c) return { uid: c.uid, name: c.name, face: c.face };
      if (e instanceof BiliApiError && (e.code === -404 || e.code === -626)) throw new HttpError(404, 'no_such_user', `B 站上没有 UID 为 ${uid} 的用户`);
      if (e instanceof BiliApiError) throw new HttpError(502, 'bili_error', `查询用户失败：${e.message}（B 站错误码 ${e.code}）`);
      throw new HttpError(502, 'bili_unreachable', `查询用户失败：连不上 B 站（${(e as Error).message}）`);
    }
  }
}
