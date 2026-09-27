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
      return { giftId: ev.giftId, giftName: ev.giftName, unitPrice: ev.unitPrice, count: ev.count, paid: ev.paid, ...(ev.icon ? { icon: ev.icon } : {}) };
    case 'guard':
      return { level: ev.level, months: ev.months, op: ev.op };
  }
}

export interface EventStats {
  enterUnique: number;
  /** 进场的大航海人数 */
  guardUnique: number;
  played: number;
  guardPlayed: number;
  composition: Record<'gov' | 'adm' | 'cap' | 'mod' | 'fan' | 'nor', number>;
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

  record(ev: TriggerEvent, r: { roomId: number | null; sessionId: number | null; rule: string | null; effectId: number | null; status: PlayStatus; raw?: unknown }): EventDto {
    const row = this.db
      .insert(events)
      .values({ ts: ev.ts, roomId: r.roomId, sessionId: r.sessionId, kind: ev.kind, uid: ev.viewer.uid, uname: ev.viewer.name, viewer: ev.viewer, payload: payloadOf(ev), rule: r.rule, effectId: r.effectId, status: r.status, raw: r.raw ?? null })
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

  /** 按时间倒序分页查询；cursor 是上一页最后一条的 id；roomId 只看这个直播间的 */
  query(f: { roomId?: number; kind?: TriggerKind; status?: PlayStatus[]; q?: string; cursor?: number; limit?: number }): { events: EventDto[]; nextCursor: number | null } {
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const conds = [];
    if (f.roomId !== undefined) conds.push(eq(events.roomId, f.roomId));
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

  /** 一段时间里某个直播间的统计（总览）：进场人数（去重）、播放次数、身份构成。to 为 null 表示到现在 */
  stats(roomId: number, from: number, to: number | null, anchorUid: number): EventStats {
    const db = this.db.$client;
    const end = to ?? Number.MAX_SAFE_INTEGER;
    const where = 'room_id = ? and ts >= ? and ts < ?';
    const args = [roomId, from, end];
    const enterUnique = (db.prepare(`select count(distinct uid) n from events where ${where} and kind = 'enter'`).get(...args) as { n: number }).n;
    const played = (db.prepare(`select count(*) n from events where ${where} and status = 'played'`).get(...args) as { n: number }).n;
    const guardPlayed = (db.prepare(`select count(*) n from events where ${where} and status = 'played' and cast(json_extract(viewer, '$.guard') as integer) > 0`).get(...args) as { n: number }).n;
    // 每个人取这段时间里最后一次进场时的身份
    const rows = db
      .prepare(
        `select json_extract(viewer, '$.guard') g, json_extract(viewer, '$.isMod') m, json_extract(viewer, '$.medal.anchorUid') a, json_extract(viewer, '$.medal.level') l
         from events where id in (select max(id) from events where ${where} and kind = 'enter' group by uid)`,
      )
      .all(...args) as Array<{ g: number | null; m: number | null; a: number | null; l: number | null }>;
    const composition = { gov: 0, adm: 0, cap: 0, mod: 0, fan: 0, nor: 0 };
    for (const r of rows) {
      if (r.g === 1) composition.gov++;
      else if (r.g === 2) composition.adm++;
      else if (r.g === 3) composition.cap++;
      else if (r.m) composition.mod++;
      else if (r.a === anchorUid && (r.l ?? 0) > 0) composition.fan++;
      else composition.nor++;
    }
    return { enterUnique, guardUnique: composition.gov + composition.adm + composition.cap, played, guardPlayed, composition };
  }

  /** 本场已经播放过进场特效的 UID（服务重启后恢复"每场一次"）。排队中没播出来的不算 */
  playedEnterUids(sessionId: number): number[] {
    return this.db
      .selectDistinct({ uid: events.uid })
      .from(events)
      .where(and(eq(events.sessionId, sessionId), eq(events.kind, 'enter'), eq(events.status, 'played')))
      .all()
      .map((r) => r.uid);
  }

  /** 服务启动时：上次退出（包括崩溃）时还在排队的事件没有播出来，改为"已清空" */
  clearStaleQueued(): number {
    return this.db.update(events).set({ status: 'cleared' }).where(eq(events.status, 'queued')).run().changes;
  }

  /** 清理：超过保留期的事件删除；超过 7 天的原始消息清空 */
  prune(now: number, retentionDays: number): { deleted: number; rawCleared: number } {
    const deleted = retentionDays > 0 ? this.db.delete(events).where(lt(events.ts, now - retentionDays * DAY_MS)).run().changes : 0;
    const rawCleared = this.db.update(events).set({ raw: null }).where(and(lt(events.ts, now - RAW_KEEP_MS), isNotNull(events.raw))).run().changes;
    return { deleted, rawCleared };
  }
}
