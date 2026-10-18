// 事件记录（需求 F-DA-01 ~ 02、F-UI-04）：每个事件一行，带命中规则和播放状态。
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { EventKind, PlayStatus, StdEvent } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { events } from '../db/schema.ts';

export type EventRow = typeof events.$inferSelect;
/** 写进事件记录的事件（触发特效的四种 + 醒目留言） */
export type LoggedEvent = Exclude<StdEvent, { kind: 'live' }>;

/** 原始消息只保留 7 天（用于排查协议问题） */
const RAW_KEEP_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
/** 清理时每批处理几条 */
const PRUNE_BATCH = 500;
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

export interface EventDto {
  id: number;
  ts: number;
  kind: EventKind;
  uid: number;
  uname: string;
  viewer: unknown;
  payload: unknown;
  rule: string | null;
  effectId: number | null;
  status: PlayStatus;
}

const dto = (r: EventRow): EventDto => ({ id: r.id, ts: r.ts, kind: r.kind, uid: r.uid, uname: r.uname, viewer: r.viewer, payload: r.payload, rule: r.rule, effectId: r.effectId, status: r.status as PlayStatus });

function payloadOf(ev: LoggedEvent): unknown {
  switch (ev.kind) {
    case 'enter':
      return { source: ev.source };
    case 'danmu':
      return { text: ev.text };
    case 'gift':
      return { giftId: ev.giftId, giftName: ev.giftName, unitPrice: ev.unitPrice, count: ev.count, paid: ev.paid, ...(ev.icon ? { icon: ev.icon } : {}) };
    case 'guard':
      return { level: ev.level, months: ev.months, op: ev.op, ...(ev.priceGold ? { price: ev.priceGold } : {}) };
    case 'sc':
      return { text: ev.text, price: ev.priceYuan, scId: ev.scId };
  }
}

export interface EventStats {
  enterUnique: number;
  /** 进场的大航海人数 */
  guardUnique: number;
  played: number;
  guardPlayed: number;
  composition: Record<'gov' | 'adm' | 'cap' | 'mod' | 'fan' | 'nor', number>;
  /** 进场观众的荣耀等级分布（每人按最后一次进场时的等级） */
  honor: Record<'l1' | 'l21' | 'l41' | 'l61' | 'none', number>;
}

/** 礼物榜的一行 */
export interface GiftRankRow {
  uid: number;
  viewer: unknown;
  /** 总价值（金瓜子）：付费礼物 + 上舰 + 醒目留言 */
  gold: number;
  /** 送了几次付费礼物（连击合并后） */
  times: number;
  /** 单价最高的一件礼物 */
  topGift: string;
  /** 上舰几次、花了多少（金瓜子） */
  guards: number;
  guardGold: number;
  /** 醒目留言几条、花了多少（金瓜子） */
  scs: number;
  scGold: number;
}

/** 这段时间进场过的大航海 */
export interface GuardVisit {
  uid: number;
  viewer: unknown;
  times: number;
  lastTs: number;
}

export class EventLog {
  private readonly db: Db;
  private readonly listeners = new Set<(e: { type: 'event'; event: EventDto } | { type: 'event_status'; id: number; status: PlayStatus }) => void>();
  /** 这个时间之前的原始消息已经清过了 */
  private rawClearedTo = 0;

  constructor(db: Db) {
    this.db = db;
  }

  onChange(fn: (e: { type: 'event'; event: EventDto } | { type: 'event_status'; id: number; status: PlayStatus }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  record(ev: LoggedEvent, r: { roomId: number | null; sessionId: number | null; rule: string | null; effectId: number | null; status: PlayStatus; raw?: unknown }): EventDto {
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
  query(f: { roomId?: number; kind?: EventKind; status?: PlayStatus[]; q?: string; cursor?: number; limit?: number; from?: number; to?: number }): { events: EventDto[]; nextCursor: number | null } {
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const conds = [];
    if (f.roomId !== undefined) conds.push(eq(events.roomId, f.roomId));
    if (f.kind) conds.push(eq(events.kind, f.kind));
    if (f.status?.length) conds.push(inArray(events.status, f.status));
    if (f.cursor) conds.push(lt(events.id, f.cursor));
    if (f.from !== undefined) conds.push(gte(events.ts, f.from));
    if (f.to !== undefined) conds.push(lt(events.ts, f.to));
    const q = f.q?.trim();
    // 先只取编号（按名字找时走 (room_id, id, uname) 索引，不用把每条记录连原始消息读出来），再按编号取整条。
    // 数字同时按 UID 和名字找：分成两次查询各走各的索引（写成 or 会整表扫）
    const ids = (extra?: SQL) =>
      this.db
        .select({ id: events.id })
        .from(events)
        .where(and(...conds, extra))
        .orderBy(desc(events.id))
        .limit(limit + 1)
        .all()
        .map((r) => r.id);
    let picked: number[] | null = null;
    if (q) {
      const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      picked = ids(sql`${events.uname} like ${pat} escape '\\'`);
      if (/^\d+$/.test(q)) picked = [...new Set([...picked, ...ids(eq(events.uid, Number(q)))])].sort((a, b) => b - a).slice(0, limit + 1);
    }
    const rows = this.db
      .select()
      .from(events)
      .where(picked ? inArray(events.id, picked.length ? picked : [0]) : conds.length ? and(...conds) : undefined)
      .orderBy(desc(events.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit).map(dto);
    return { events: page, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  /** 一段时间里某个直播间的统计（总览）：进场人数（去重）、播放次数、身份构成（都不算主播本人）。to 为 null 表示到现在 */
  stats(roomId: number, from: number, to: number | null, anchorUid: number): EventStats {
    const db = this.db.$client;
    const end = to ?? Number.MAX_SAFE_INTEGER;
    const where = 'room_id = ? and ts >= ? and ts < ?';
    const args = [roomId, from, end];
    // 主播本人不算观众：进场人数、身份构成都不算主播
    const enterUnique = (db.prepare(`select count(distinct uid) n from events where ${where} and kind = 'enter' and uid != ?`).get(...args, anchorUid) as { n: number }).n;
    const played = (db.prepare(`select count(*) n from events where ${where} and status = 'played'`).get(...args) as { n: number }).n;
    const guardPlayed = (db.prepare(`select count(*) n from events where ${where} and status = 'played' and cast(json_extract(viewer, '$.guard') as integer) > 0`).get(...args) as { n: number }).n;
    // 每个人取这段时间里最后一次进场时的身份
    const rows = db
      .prepare(
        `select json_extract(viewer, '$.guard') g, json_extract(viewer, '$.isMod') m, json_extract(viewer, '$.medal.anchorUid') a, json_extract(viewer, '$.medal.level') l
         , json_extract(viewer, '$.honor') h
         from events where id in (select max(id) from events where ${where} and kind = 'enter' and uid != ? group by uid)`,
      )
      .all(...args, anchorUid) as Array<{ g: number | null; m: number | null; a: number | null; l: number | null; h: number | null }>;
    const composition = { gov: 0, adm: 0, cap: 0, mod: 0, fan: 0, nor: 0 };
    const honor = { l1: 0, l21: 0, l41: 0, l61: 0, none: 0 };
    for (const r of rows) {
      const h = Number(r.h) || 0;
      honor[h >= 61 ? 'l61' : h >= 41 ? 'l41' : h >= 21 ? 'l21' : h >= 1 ? 'l1' : 'none']++;
      if (r.g === 1) composition.gov++;
      else if (r.g === 2) composition.adm++;
      else if (r.g === 3) composition.cap++;
      else if (r.m) composition.mod++;
      else if (r.a === anchorUid && (r.l ?? 0) > 0) composition.fan++;
      else composition.nor++;
    }
    return { enterUnique, guardUnique: composition.gov + composition.adm + composition.cap, played, guardPlayed, composition, honor };
  }

  /** 礼物榜：这段时间里每人花的钱（付费礼物 + 上舰 + 醒目留言），从高到低。盲盒按开出来的礼物算（和 B 站高能榜一样） */
  giftRank(roomId: number, from: number, to: number | null, limit = 50): { people: number; gold: number; rows: GiftRankRow[] } {
    const db = this.db.$client;
    const args = [roomId, from, to ?? Number.MAX_SAFE_INTEGER];
    const value = `case kind
        when 'gift' then case when json_extract(payload, '$.paid') = 1 then json_extract(payload, '$.unitPrice') * json_extract(payload, '$.count') else 0 end
        when 'guard' then coalesce(json_extract(payload, '$.price'), 0)
        when 'sc' then json_extract(payload, '$.price') * 1000
      end`;
    const base = `select id, uid, kind, viewer, (${value}) v, json_extract(payload, '$.unitPrice') p, json_extract(payload, '$.giftName') name
      from events where room_id = ? and ts >= ? and ts < ? and kind in ('gift', 'guard', 'sc')`;
    const sum = db.prepare(`with g as (${base}) select count(distinct uid) people, coalesce(sum(v), 0) gold from g where v > 0`).get(...args) as { people: number; gold: number };
    const rows = db
      .prepare(
        `with g as (${base}),
              top as (select uid, sum(v) gold, sum(kind = 'gift') times, sum(kind = 'guard') guards, sum(case when kind = 'guard' then v else 0 end) guardGold,
                        sum(kind = 'sc') scs, sum(case when kind = 'sc' then v else 0 end) scGold, max(id) last
                      from g where v > 0 group by uid order by gold desc, last desc limit ?)
         select top.*, (select viewer from events where id = top.last) viewer,
                (select name from g where g.uid = top.uid and g.kind = 'gift' and g.v > 0 order by p desc, id desc limit 1) topGift
         from top order by top.gold desc, top.last desc`,
      )
      .all(...args, limit) as Array<{ uid: number; gold: number; times: number; guards: number; guardGold: number; scs: number; scGold: number; viewer: string; topGift: string | null }>;
    return {
      people: sum.people,
      gold: sum.gold,
      rows: rows.map((r) => ({ uid: r.uid, viewer: JSON.parse(r.viewer), gold: r.gold, times: r.times, topGift: r.topGift ?? '', guards: r.guards, guardGold: r.guardGold, scs: r.scs, scGold: r.scGold })),
    };
  }

  /** 以前记录的上舰没有存价格：从留着的原始消息里补上（原始消息只留 7 天）。返回补了几条 */
  backfillGuardPrices(priceOf: (raw: unknown) => number | undefined): number {
    const rows = this.db.$client
      .prepare(`select id, payload, raw from events where kind = 'guard' and raw is not null and json_extract(payload, '$.price') is null`)
      .all() as Array<{ id: number; payload: string; raw: string }>;
    const upd = this.db.$client.prepare(`update events set payload = ? where id = ?`);
    let n = 0;
    for (const r of rows) {
      const price = priceOf(JSON.parse(r.raw));
      if (!price) continue;
      upd.run(JSON.stringify({ ...JSON.parse(r.payload), price }), r.id);
      n++;
    }
    return n;
  }

  /** 这段时间进场过的大航海：进场几次、最后一次什么时候（按最后一次进场时的身份算） */
  guardVisits(roomId: number, from: number, to: number | null): GuardVisit[] {
    const db = this.db.$client;
    const rows = db
      .prepare(
        `with e as (select id, uid, ts, viewer from events where room_id = ? and ts >= ? and ts < ? and kind = 'enter'),
              last as (select uid, count(*) times, max(ts) lastTs, max(id) id from e group by uid)
         select last.uid, last.times, last.lastTs, e.viewer from last join e on e.id = last.id
         where cast(json_extract(e.viewer, '$.guard') as integer) > 0 order by last.lastTs desc`,
      )
      .all(roomId, from, to ?? Number.MAX_SAFE_INTEGER) as Array<{ uid: number; times: number; lastTs: number; viewer: string }>;
    return rows.map((r) => ({ uid: r.uid, times: r.times, lastTs: r.lastTs, viewer: JSON.parse(r.viewer) }));
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

  /** 最近几场直播（送礼名单挑记录用）：每场有几条礼物、上舰、醒目留言，最新的在前 */
  sessionList(roomId: number, limit = 30): Array<{ id: number; startedAt: number; endedAt: number | null; gifts: number }> {
    return this.db.$client
      .prepare(
        `select s.id, s.started_at as startedAt, s.ended_at as endedAt,
           (select count(*) from events e where e.session_id = s.id and e.kind in ('gift', 'guard', 'sc')) as gifts
         from live_sessions s where s.room_id = ? order by s.id desc limit ?`,
      )
      .all(roomId, limit) as Array<{ id: number; startedAt: number; endedAt: number | null; gifts: number }>;
  }

  /** 一条礼物、上舰、醒目留言的记录（挂到送礼名单用） */
  giftEvent(id: number): { id: number; ts: number; kind: string; viewer: unknown; payload: unknown } | null {
    return (
      this.db
        .select({ id: events.id, ts: events.ts, kind: events.kind, viewer: events.viewer, payload: events.payload })
        .from(events)
        .where(and(eq(events.id, id), inArray(events.kind, ['gift', 'guard', 'sc'])))
        .get() ?? null
    );
  }

  /**
   * 送礼名单装一段时间的记录：本直播间某一场（sessionId）或者 from 起（到 to 为止）的付费礼物、上舰、醒目留言，按时间先后。
   * 最多取最近 limit 条（按人合计、合并时要全部算进来，这个上限只防止内存撑爆）
   */
  giftListRange(o: { roomId: number; sessionId?: number; from?: number; to?: number | null; limit?: number }): Array<{ id: number; ts: number; kind: string; viewer: unknown; payload: unknown }> {
    const where = ["kind in ('gift', 'guard', 'sc')", 'room_id = ?', "not (kind = 'gift' and coalesce(json_extract(payload, '$.paid'), 1) = 0)"];
    const args: unknown[] = [o.roomId];
    if (o.sessionId !== undefined) {
      where.push('session_id = ?');
      args.push(o.sessionId);
    } else {
      where.push('ts >= ?');
      args.push(o.from ?? 0);
      if (o.to != null) {
        where.push('ts < ?');
        args.push(o.to);
      }
    }
    // 按时间范围装时指定走 (room_id, kind, id)：只看礼物、上舰、醒目留言，不然会把这段时间的进场、弹幕全读一遍
    const from = o.sessionId !== undefined ? 'events' : 'events indexed by events_room_kind_id';
    const rows = this.db.$client
      .prepare(`select id, ts, kind, viewer, payload from ${from} where ${where.join(' and ')} order by id desc limit ?`)
      .all(...args, o.limit ?? 50_000) as Array<{ id: number; ts: number; kind: string; viewer: string; payload: string | null }>;
    return rows.reverse().map((r) => ({ ...r, viewer: JSON.parse(r.viewer), payload: r.payload ? JSON.parse(r.payload) : null }));
  }

  /**
   * 找送礼记录（送礼名单挑记录用）：本直播间的付费礼物、上舰、醒目留言，最新的在前。
   * sessionId 为 null 时找全部场次；q 匹配观众名、UID、礼物名、醒目留言内容；minGold 为总价值下限（金瓜子）
   */
  searchGiftEvents(o: { roomId: number; sessionId: number | null; q: string; minGold: number; limit: number }): Array<{ id: number; ts: number; kind: string; viewer: unknown; payload: unknown; sessionId: number | null }> {
    const where = ["kind in ('gift', 'guard', 'sc')", 'room_id = ?', "not (kind = 'gift' and coalesce(json_extract(payload, '$.paid'), 1) = 0)"];
    const args: unknown[] = [o.roomId];
    if (o.sessionId !== null) {
      where.push('session_id = ?');
      args.push(o.sessionId);
    }
    if (o.minGold > 0) {
      // 总价值：礼物 单价 × 数量，上舰 实际价格，醒目留言 元 × 1000
      where.push(`(case kind when 'gift' then coalesce(json_extract(payload, '$.unitPrice'), 0) * coalesce(json_extract(payload, '$.count'), 1) when 'guard' then coalesce(json_extract(payload, '$.price'), 0) else coalesce(json_extract(payload, '$.price'), 0) * 1000 end) >= ?`);
      args.push(o.minGold);
    }
    const q = o.q.trim();
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const conds = ["uname like ? escape '\\'", "json_extract(payload, '$.giftName') like ? escape '\\'", "(kind = 'sc' and json_extract(payload, '$.text') like ? escape '\\')"];
      args.push(like, like, like);
      if (/^\d+$/.test(q)) {
        conds.push('uid = ?');
        args.push(Number(q));
      }
      where.push(`(${conds.join(' or ')})`);
    }
    // 找全部场次时指定走 (room_id, kind, id)：不然搜不到时要把整个直播间的记录（大部分是进场、弹幕）全读一遍
    const from = o.sessionId !== null ? 'events' : 'events indexed by events_room_kind_id';
    const rows = this.db.$client
      .prepare(`select id, ts, kind, viewer, payload, session_id as sessionId from ${from} where ${where.join(' and ')} order by id desc limit ?`)
      .all(...args, o.limit) as Array<{ id: number; ts: number; kind: string; viewer: string; payload: string | null; sessionId: number | null }>;
    return rows.map((r) => ({ ...r, viewer: JSON.parse(r.viewer), payload: r.payload ? JSON.parse(r.payload) : null }));
  }

  /** 服务启动时：上次退出（包括崩溃）时还在排队的事件没有播出来，改为"已清空" */
  clearStaleQueued(): number {
    return this.db.update(events).set({ status: 'cleared' }).where(eq(events.status, 'queued')).run().changes;
  }

  /**
   * 清理：超过保留期的事件删除；超过 7 天的原始消息清空。
   * 分批做、批与批之间让出：把保留天数改小后一次要删几十万条，一条语句删完会让整个服务卡住好几秒。
   * 直播中只清原始消息，过期的记录等没开播时再删
   */
  async prune(now: number, retentionDays: number, o: { live?: boolean } = {}): Promise<{ deleted: number; rawCleared: number }> {
    const db = this.db.$client;
    let deleted = 0;
    // 直播中不删：这台机器写盘慢时一批也可能顿一两秒，等下播后（下一次定时清理）再删
    if (retentionDays > 0 && !o.live) {
      const del = db.prepare('delete from events where id in (select id from events where ts < ? limit ?)');
      for (let n = PRUNE_BATCH; n === PRUNE_BATCH; await yieldLoop()) {
        n = del.run(now - retentionDays * DAY_MS, PRUNE_BATCH).changes;
        deleted += n;
      }
    }
    // 原始消息：从上次清到的时间往后找，不用每次把 7 天前的记录全看一遍
    const cut = now - RAW_KEEP_MS;
    const pick = db.prepare('select id, ts from events where ts >= ? and ts < ? and raw is not null order by ts limit ?');
    const clear = db.prepare('update events set raw = null where id = ?');
    let rawCleared = 0;
    for (;;) {
      const rows = pick.all(this.rawClearedTo, cut, PRUNE_BATCH) as Array<{ id: number; ts: number }>;
      db.transaction(() => {
        for (const r of rows) clear.run(r.id);
      })();
      rawCleared += rows.length;
      if (rows.length < PRUNE_BATCH) break;
      this.rawClearedTo = rows[rows.length - 1]!.ts;
      await yieldLoop();
    }
    this.rawClearedTo = cut;
    return { deleted, rawCleared };
  }
}
