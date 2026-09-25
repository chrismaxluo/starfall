// 事件记录（需求 F-DA-01 ~ 02、F-UI-04）：每个事件一行，带命中规则和播放状态。
import { and, desc, eq, inArray, isNotNull, like, lt, or } from 'drizzle-orm';
import type { PlayStatus, StdEvent, TriggerKind } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { events } from '../db/schema.ts';

export type EventRow = typeof events.$inferSelect;
type TriggerEvent = Exclude<StdEvent, { kind: 'live' }>;

/** 原始消息只保留 7 天（用于排查协议问题） */
const RAW_KEEP_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

export interface EventDto {
  id: number;
  ts: number;
  kind: TriggerKind;
  uid: number;
  uname: string;
  viewer: unknown;
  payload: unknown;
  rule: string | null;
  effectId: number | null;
  status: PlayStatus;
}

const dto = (r: EventRow): EventDto => ({ id: r.id, ts: r.ts, kind: r.kind, uid: r.uid, uname: r.uname, viewer: r.viewer, payload: r.payload, rule: r.rule, effectId: r.effectId, status: r.status as PlayStatus });

function payloadOf(ev: TriggerEvent): unknown {
  switch (ev.kind) {
    case 'enter':
      return { source: ev.source };
    case 'danmu':
      return { text: ev.text };
    case 'gift':
      return { giftId: ev.giftId, giftName: ev.giftName, unitPrice: ev.unitPrice, count: ev.count, paid: ev.paid };
    case 'guard':
      return { level: ev.level, months: ev.months, op: ev.op };
  }
}

export class EventLog {
  private readonly db: Db;
  private readonly listeners = new Set<(e: { type: 'event'; event: EventDto } | { type: 'event_status'; id: number; status: PlayStatus }) => void>();

  constructor(db: Db) {
    this.db = db;
  }

  onChange(fn: (e: { type: 'event'; event: EventDto } | { type: 'event_status'; id: number; status: PlayStatus }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  record(ev: TriggerEvent, r: { sessionId: number | null; rule: string | null; effectId: number | null; status: PlayStatus; raw?: unknown }): EventDto {
    const row = this.db
      .insert(events)
      .values({ ts: ev.ts, sessionId: r.sessionId, kind: ev.kind, uid: ev.viewer.uid, uname: ev.viewer.name, viewer: ev.viewer, payload: payloadOf(ev), rule: r.rule, effectId: r.effectId, status: r.status, raw: r.raw ?? null })
      .returning()
      .get();
    const d = dto(row);
    for (const fn of this.listeners) fn({ type: 'event', event: d });
    return d;
  }

  setStatus(id: number, status: PlayStatus): void {
    this.db.update(events).set({ status }).where(eq(events.id, id)).run();
    for (const fn of this.listeners) fn({ type: 'event_status', id, status });
  }

  /** 按时间倒序分页查询；cursor 是上一页最后一条的 id */
  query(f: { kind?: TriggerKind; status?: PlayStatus[]; q?: string; cursor?: number; limit?: number }): { events: EventDto[]; nextCursor: number | null } {
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const conds = [];
    if (f.kind) conds.push(eq(events.kind, f.kind));
    if (f.status?.length) conds.push(inArray(events.status, f.status));
    if (f.cursor) conds.push(lt(events.id, f.cursor));
    const q = f.q?.trim();
    if (q) {
      const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      conds.push(/^\d+$/.test(q) ? or(eq(events.uid, Number(q)), like(events.uname, `%${esc}%`)) : like(events.uname, `%${esc}%`));
    }
    const rows = this.db
      .select()
      .from(events)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(events.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit).map(dto);
    return { events: page, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  /** 本场已经播放过进场特效的 UID（服务重启后恢复"每场一次"） */
  playedEnterUids(sessionId: number): number[] {
    return this.db
      .selectDistinct({ uid: events.uid })
      .from(events)
      .where(and(eq(events.sessionId, sessionId), eq(events.kind, 'enter'), inArray(events.status, ['played', 'queued'])))
      .all()
      .map((r) => r.uid);
  }

  /** 清理：超过保留期的事件删除；超过 7 天的原始消息清空 */
  prune(now: number, retentionDays: number): { deleted: number; rawCleared: number } {
    const deleted = retentionDays > 0 ? this.db.delete(events).where(lt(events.ts, now - retentionDays * DAY_MS)).run().changes : 0;
    const rawCleared = this.db.update(events).set({ raw: null }).where(and(lt(events.ts, now - RAW_KEEP_MS), isNotNull(events.raw))).run().changes;
    return { deleted, rawCleared };
  }
}
