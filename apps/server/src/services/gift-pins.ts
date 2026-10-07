// 送礼名单挂上的记录：后台从本场或以前场次的送礼记录里挑出来，送礼名单设成「只显示挂上的记录」时只显示这些。
// 挂上时存一份当时的样子（事件记录过期删掉了也照样显示），一直保留到手动撤下
import { asc, eq } from 'drizzle-orm';
import type { GiftListItem } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { giftPins } from '../db/schema.ts';
import { HttpError } from '../http.ts';

export interface GiftPin {
  id: number;
  eventId: number;
  item: GiftListItem;
}

/** 最多挂多少条 */
export const PINS_MAX = 50;

export class GiftPinStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): GiftPin[] {
    return this.db
      .select()
      .from(giftPins)
      .orderBy(asc(giftPins.sort), asc(giftPins.id))
      .all()
      .map((r) => ({ id: r.id, eventId: r.eventId, item: { ...r.item, id: `pin-${r.id}` } }));
  }

  /** 送礼名单收到的格式（按顺序） */
  items(): GiftListItem[] {
    return this.list().map((p) => p.item);
  }

  /** 挂上一条；已经挂着时不重复挂 */
  add(eventId: number, item: GiftListItem): GiftPin[] {
    if (this.db.select().from(giftPins).where(eq(giftPins.eventId, eventId)).get()) return this.list();
    const all = this.list();
    if (all.length >= PINS_MAX) throw new HttpError(409, 'too_many', `最多挂 ${PINS_MAX} 条，先撤下几条`);
    const sort = (this.db.$client.prepare('select coalesce(max(sort), 0) as m from gift_pins').get() as { m: number }).m + 1;
    this.db.insert(giftPins).values({ eventId, item, sort }).run();
    return this.list();
  }

  remove(id: number): GiftPin[] {
    const r = this.db.delete(giftPins).where(eq(giftPins.id, id)).run();
    if (r.changes === 0) throw new HttpError(404, 'not_found', '这条已经撤下了');
    return this.list();
  }

  /** 调整顺序：ids 是全部挂着的记录的新顺序（上面的在前） */
  reorder(ids: number[]): GiftPin[] {
    const have = new Set(this.list().map((p) => p.id));
    if (ids.length !== have.size || !ids.every((id) => have.has(id))) throw new HttpError(400, 'bad_order', '顺序和挂着的记录对不上，请刷新后再试');
    this.db.transaction((tx) => {
      ids.forEach((id, i) => tx.update(giftPins).set({ sort: i + 1 }).where(eq(giftPins.id, id)).run());
    });
    return this.list();
  }
}
