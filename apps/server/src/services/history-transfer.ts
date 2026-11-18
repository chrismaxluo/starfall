import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { GIFT_COMBO_MAX_HOLD_MS } from '@starfall/core';
import { HISTORY_KINDS, PLAY_STATUS } from '@starfall/shared';
import type { HistoryCounts, HistoryKind, HistoryOutcome, HistoryPlan } from '@starfall/shared';
import { HttpError } from '../http.ts';
import { platformEventKey } from './events.ts';

const FORM_VERSION = 1;
export const HISTORY_MAX_BYTES = 512 * 1024 * 1024;
const KIND_SQL = "('gift','danmu','guard','sc')";
const DAY = 86_400_000;
const positive = z.int().positive();
const timestamp = z.int().min(0).max(8_640_000_000_000_000 - 1);
const key = z.string().regex(/^[0-9a-f]{64}$/);
const status = z.enum(Object.keys(PLAY_STATUS) as Array<keyof typeof PLAY_STATUS>);
const money = z.int().min(0).max(1_000_000_000_000);
const image = z.string().max(4096).regex(/^(?:https?:)?\/\//i).optional();
const viewerSchema = z.object({
  uid: positive, name: z.string().max(512), face: image.or(z.literal('')),
  guard: z.int().min(0).max(3).default(0), isMod: z.boolean().default(false), mystery: z.boolean().default(false),
  honor: z.int().nonnegative().optional(),
  medal: z.object({
    name: z.string().max(512), level: z.int().nonnegative(), anchorUid: z.int().nonnegative(),
    colors: z.object({ bg: z.string().max(40), level: z.string().max(40), border: z.string().max(40), text: z.string().max(40) }).optional(),
  }).optional(),
});
const payloadSchema = {
  gift: z.object({ giftId: positive, giftName: z.string().max(512), unitPrice: money, count: positive, paid: z.boolean(), icon: image })
    .refine((p) => p.unitPrice * p.count <= 1_000_000_000_000),
  danmu: z.object({ text: z.string().max(16384) }),
  guard: z.object({ level: z.int().min(1).max(3), months: positive, op: z.enum(['open', 'renew']), price: money.optional() }),
  sc: z.object({ text: z.string().max(16384), price: z.number().min(0).max(1_000_000_000), scId: z.string().max(512) }),
};
const sessionSchema = z.object({
  id: positive, room_id: positive.nullable(), started_at: timestamp, ended_at: timestamp.nullable(), last_event: timestamp.nullable(),
});
const eventSchema = z.object({
  id: positive, ts: timestamp, room_id: positive.nullable(), session_id: positive.nullable(), kind: z.enum(HISTORY_KINDS),
  uid: positive, uname: z.string().max(512), viewer: z.string(), payload: z.string(),
  rule: z.string().max(512).nullable(), status, history_key: key.nullable(), platform_key: key.nullable(), guard_key: z.string().nullable(),
});
type Session = z.infer<typeof sessionSchema>;
type ExistingSession = Pick<Session, 'id' | 'started_at' | 'ended_at'>;

const eventFields = 'id, ts, room_id, session_id, kind, uid, uname, viewer, payload, rule, status';
const sessionFields = 'id, room_id, started_at, ended_at';
type Conn = Database.Database;

function columnsOf(db: Conn, table: 'events' | 'live_sessions' | 'event_raw' | 'history_info'): Set<string> {
  return new Set((db.pragma('table_info(' + table + ')') as Array<{ name: string }>).map((c) => c.name));
}

function selectEvents(db: Conn, legacyKeysOnly = false) {
  const columns = columnsOf(db, 'events');
  const raw = columns.has('raw') ? 'e.raw' : 'NULL';
  const hasRaw = realTable(db, 'event_raw');
  const guardRaw = hasRaw ? 'coalesce(r.raw, ' + raw + ')' : raw;
  const join = hasRaw ? "left join event_raw r on r.id = e.id and e.kind = 'guard'" : '';
  // 老备份的支付流水号可能只在原始消息里。只读取已知字段，不复制原始消息。
  const guardId =
    "case when e.kind = 'guard' and json_valid(" + guardRaw + ") then " +
    "cast(coalesce(json_extract(" + guardRaw + ", '$.data.pay_info.payflow_id'), json_extract(" + guardRaw + ", '$.data.payflow_id')) as text) end";
  const where = legacyKeysOnly ? "e.kind in ('guard', 'sc') and e.platform_key is null" : 'e.kind in ' + KIND_SQL;
  return db.prepare(
    'select ' + eventFields.split(', ').map((c) => 'e.' + c).join(', ') +
    ', ' + (columns.has('history_key') ? 'e.history_key' : 'NULL') + ' as history_key' +
    ', ' + (columns.has('platform_key') ? 'e.platform_key' : 'NULL') + ' as platform_key' +
    ', ' + guardId + ' as guard_key from events e ' + join + ' where ' + where + ' order by e.id',
  );
}

function realTable(db: Conn, name: string): boolean {
  return Boolean(db.prepare("select 1 from pragma_table_list where schema = 'main' and name = ? and type = 'table'").get(name));
}

function readEvent(row: unknown) {
  const e = eventSchema.parse(row);
  const viewer = viewerSchema.parse(JSON.parse(e.viewer));
  if (viewer.uid !== e.uid) throw new Error('event viewer uid mismatch');
  const payload: unknown = JSON.parse(e.payload);
  const clean = payloadSchema[e.kind].parse(payload);
  const platform =
    e.platform_key ?? platformEventKey(e.room_id, e.kind, e.kind === 'sc' ? payloadSchema.sc.parse(clean).scId : e.kind === 'guard' ? e.guard_key : null);
  // ID 只用于识别同一来源的快照。绝不拿源库 ID 去覆盖目标库里的同号事件。
  const history = e.history_key ?? createHash('sha256').update(JSON.stringify([e.id, e.ts, e.room_id, e.uid, e.kind, clean])).digest('hex');
  return { ...e, viewer: JSON.stringify(viewer), payload: JSON.stringify(clean), history, platform };
}

function readSessions(db: Conn, cutoff = 0): Session[] {
  return db.prepare(
    "select " + sessionFields + ", case when s.ended_at is null then (select max(e.ts) from events e where e.session_id = s.id) end as last_event" +
    " from live_sessions s where s.started_at >= ? or s.ended_at >= ? or exists (select 1 from events e where e.session_id = s.id and e.ts >= ? and e.kind in " +
    KIND_SQL + ") order by s.id",
  ).all(cutoff, cutoff, cutoff).map((row) => sessionSchema.parse(row));
}

/** 生成一份只含直播历史的 SQLite 文件，桌面版和服务器版共用。 */
export function exportHistory(db: Conn, file: string, now: number): void {
  const output = new Database(file);
  try {
    output.exec(
      "create table history_info (version integer not null, exported_at integer not null);" +
      "create table live_sessions (id integer primary key, room_id integer, started_at integer not null, ended_at integer);" +
      "create table events (id integer primary key, ts integer not null, room_id integer, session_id integer, kind text not null, uid integer not null," +
      " uname text not null, viewer text not null, payload text not null, rule text, status text not null, history_key text not null, platform_key text);" +
      "create index history_events_session on events(session_id);",
    );
    output.transaction(() => {
      output.prepare('insert into history_info values (?, ?)').run(FORM_VERSION, now);
      const addSession = output.prepare('insert into live_sessions values (?, ?, ?, ?)');
      for (const s of readSessions(db)) addSession.run(s.id, s.room_id, s.started_at, s.ended_at);
      const addEvent = output.prepare('insert into events values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of selectEvents(db).iterate()) {
        const e = readEvent(row);
        addEvent.run(e.id, e.ts, e.room_id, e.session_id, e.kind, e.uid, e.uname, e.viewer, e.payload, e.rule, e.status, e.history, e.platform);
      }
    })();
  } finally {
    output.close();
  }
}

export interface HistoryReview {
  plan: HistoryPlan;
  signature: string;
}
const zero = (): HistoryCounts => ({ added: 0, duplicate: 0, overlap: 0, expired: 0 });
const unsupported = () => new HttpError(400, 'invalid_history', '无法读取历史数据。请选择星临导出的历史文件或 v2.0.0 及兼容版本的完整 .db 备份');

function withHistory<T>(file: string, fn: (db: Conn, exportedAt: number | null) => T): T {
  let source: Conn;
  try {
    source = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw unsupported();
  }
  try {
    source.pragma('trusted_schema = OFF');
    source.pragma('query_only = ON');
    if (!realTable(source, 'events') || !realTable(source, 'live_sessions')) throw unsupported();
    const eventColumns = columnsOf(source, 'events');
    const sessionColumns = columnsOf(source, 'live_sessions');
    if (eventFields.split(', ').some((c) => !eventColumns.has(c)) || sessionFields.split(', ').some((c) => !sessionColumns.has(c))) throw unsupported();
    if (realTable(source, 'event_raw')) {
      const rawColumns = columnsOf(source, 'event_raw');
      if (!rawColumns.has('id') || !rawColumns.has('raw')) throw unsupported();
    }
    let exportedAt: number | null = null;
    if (realTable(source, 'history_info')) {
      const metaColumns = columnsOf(source, 'history_info');
      if (!metaColumns.has('version') || !metaColumns.has('exported_at')) throw unsupported();
      const meta = z.object({ version: positive, exported_at: timestamp }).parse(source.prepare('select version, exported_at from history_info').get());
      if (meta.version !== FORM_VERSION) throw new HttpError(400, 'history_version', '这份历史文件的版本暂不支持，请更新星临后重试');
      exportedAt = meta.exported_at;
    } else if (!realTable(source, '__drizzle_migrations')) {
      throw unsupported();
    }
    return fn(source, exportedAt);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Database.SqliteError && ['SQLITE_CORRUPT', 'SQLITE_NOTADB'].includes(error.code))) throw unsupported();
    throw error;
  } finally {
    source.close();
  }
}

// 连击保留各设备收到的第一笔时间，按最长聚合时长加一秒时间戳余量检查疑似重复。
const overlapWindow: Record<HistoryKind, number> = { gift: GIFT_COMBO_MAX_HOLD_MS + 1_000, danmu: 1_000, guard: 10_000, sc: 1_000 };
function matchingField(kind: HistoryKind, text: string): number | string {
  const p = JSON.parse(text) as Record<string, number | string>;
  return kind === 'gift' ? p.giftId! : kind === 'guard' ? p.level! : p.text!;
}

type KnownEvent = { kind: HistoryKind; room_id: number | null; payload: string | null; platform_key: string | null; guard_key: string | null };
function knownKey(e: KnownEvent): string | null {
  if (e.platform_key) return e.platform_key;
  let id = e.guard_key;
  if (e.kind === 'sc' && e.payload !== null) {
    const payload = JSON.parse(e.payload) as { scId?: unknown } | null;
    id = typeof payload?.scId === 'string' ? payload.scId : null;
  }
  return platformEventKey(e.room_id, e.kind, id);
}

const SESSION_TIME_TOLERANCE_MS = 5 * 60_000;
const SESSION_MIN_OVERLAP_RATIO = 0.8;
const sessionKey = (s: Session) => JSON.stringify([s.room_id, s.started_at]);

/** 起播时间可能来自不同设备。只归并互为唯一候选、且起止时间接近的已结束场次。 */
function matchSessions(dst: Conn, sessions: Session[]): Map<number, ExistingSession> {
  const alias = dst.prepare(
    'select s.id, s.started_at, s.ended_at from history_session_aliases a' +
    ' join live_sessions s on s.id = a.session_id and s.room_id = a.room_id' +
    ' where a.room_id = ? and a.source_started_at = ?',
  );
  const exact = dst.prepare('select id, started_at, ended_at from live_sessions where room_id is ? and started_at = ? order by id limit 1');
  const nearby = dst.prepare(
    'select id, started_at, ended_at from live_sessions where room_id = ? and started_at between ? and ?' +
    ' and ended_at between ? and ? and ended_at > started_at',
  );
  const matches = new Map<number, ExistingSession>();
  const claimed = new Set<number>();
  const checked = new Set<string>();
  const unmatched: Session[] = [];
  const possible = new Map<number, ExistingSession>();
  const candidateCounts = new Map<number, number>();
  const tolerance = SESSION_TIME_TOLERANCE_MS;
  for (const s of sessions) {
    const key = sessionKey(s);
    if (checked.has(key)) continue;
    checked.add(key);
    const same = (alias.get(s.room_id, s.started_at) ?? exact.get(s.room_id, s.started_at)) as ExistingSession | undefined;
    if (same) {
      matches.set(s.id, same);
      claimed.add(same.id);
    } else {
      unmatched.push(s);
    }
  }
  // 已确认的对应关系和精确时间优先，剩下的场次才按时间范围匹配。
  for (const s of unmatched) {
    const start = s.started_at;
    const end = s.ended_at;
    if (s.room_id === null || end === null || end <= start) continue;
    const candidates = (nearby.all(s.room_id, start - tolerance, start + tolerance, end - tolerance, end + tolerance) as Array<ExistingSession & { ended_at: number }>).filter((previous) => {
      if (claimed.has(previous.id)) return false;
      const overlap = Math.min(end, previous.ended_at) - Math.max(start, previous.started_at);
      const shorter = Math.min(end - start, previous.ended_at - previous.started_at);
      return overlap >= shorter * SESSION_MIN_OVERLAP_RATIO;
    });
    for (const candidate of candidates) candidateCounts.set(candidate.id, (candidateCounts.get(candidate.id) ?? 0) + 1);
    if (candidates.length === 1) possible.set(s.id, candidates[0]!);
  }
  for (const [id, target] of possible) {
    if (candidateCounts.get(target.id) === 1) matches.set(id, target);
  }
  return matches;
}

function inspect(dst: Conn, src: Conn, exportedAt: number | null, days: number, now: number, apply: boolean): HistoryReview {
  const plan: HistoryPlan = {
    events: { gift: zero(), danmu: zero(), guard: zero(), sc: zero() }, sessions: { added: 0, existing: 0 },
    exportedAt, from: null, to: null, retentionDays: days,
  };
  const cutoff = days > 0 ? now - days * DAY : 0;
  const digest = createHash('sha256');
  const captureBoundary = (dst.prepare('select coalesce(max(id),0) as id from events').get() as { id: number }).id;
  const sessionIds = new Map<number, { id: number | null; room: number | null }>();
  const sessionsByStart = new Map<string, { id: number | null; originalId: number | null }>();
  const sourceSessions = readSessions(src, cutoff);
  const matches = matchSessions(dst, sourceSessions);
  const addSession = dst.prepare('insert into live_sessions (room_id,started_at,ended_at) values (?,?,?) returning id');
  const rememberSession = dst.prepare('insert or ignore into history_session_aliases (room_id,source_started_at,session_id) values (?,?,?)');
  const widenSession = dst.prepare('update live_sessions set started_at = min(started_at, ?), ended_at = max(ended_at, ?) where id = ?');
  for (const s of sourceSessions) {
    const key = sessionKey(s);
    const mapped = sessionsByStart.get(key);
    if (mapped) {
      plan.sessions.existing++;
      digest.update(JSON.stringify(['session', s.id, mapped.originalId]));
      sessionIds.set(s.id, { id: mapped.id, room: s.room_id });
      continue;
    }
    const existing = matches.get(s.id);
    const adjusted = existing !== undefined && existing.started_at !== s.started_at;
    digest.update(JSON.stringify(['session', s.id, existing?.id ?? null, adjusted ? existing : null]));
    plan.sessions[existing ? 'existing' : 'added']++;
    const endedAt = s.ended_at ?? Math.max(s.started_at, (s.last_event ?? s.started_at) + 1);
    if (apply && adjusted && s.room_id !== null) {
      rememberSession.run(s.room_id, s.started_at, existing.id);
      rememberSession.run(s.room_id, existing.started_at, existing.id);
      widenSession.run(s.started_at, endedAt, existing.id);
    }
    const id = existing?.id ?? (apply ? (addSession.get(s.room_id, s.started_at, endedAt) as { id: number }).id : null);
    sessionIds.set(s.id, { id, room: s.room_id });
    sessionsByStart.set(key, { id, originalId: existing?.id ?? null });
  }

  const imported = dst.prepare('select 1 from events where history_key = ?');
  const exact = dst.prepare('select 1 from events where platform_key = ?');
  // 旧版的上舰时间是接收设备的时间。同一笔订单在两台电脑上的时间可能相差很大。
  const oldKeys = new Set<string>();
  for (const row of selectEvents(dst, true).iterate() as Iterable<KnownEvent>) {
    const key = knownKey(row);
    if (key) oldKeys.add(key);
  }
  const candidates = dst.prepare(
    "select e.payload, e.platform_key, case when e.kind = 'guard' and json_valid(coalesce(r.raw,e.raw)) then " +
    "cast(coalesce(json_extract(coalesce(r.raw,e.raw), '$.data.pay_info.payflow_id'), json_extract(coalesce(r.raw,e.raw), '$.data.payflow_id')) as text) end as guard_key" +
    " from events e left join event_raw r on r.id = e.id and e.kind = 'guard'" +
    " where e.room_id is ? and e.ts between ? and ? and e.kind = ? and e.uid = ? and e.id <= ? and e.payload is not null",
  );
  const stableSeen = new Set<string>();
  const sourceSeen = new Set<string>();
  const insert = dst.prepare(
    'insert into events (ts,room_id,session_id,kind,uid,uname,viewer,payload,rule,status,history_key,platform_key) values (?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  const lastImportedBySession = new Map<number, number>();
  for (const row of selectEvents(src).iterate()) {
    const e = readEvent(row);
    plan.from = Math.min(plan.from ?? e.ts, e.ts);
    plan.to = Math.max(plan.to ?? e.ts, e.ts);
    let outcome: HistoryOutcome = 'added';
    if (e.ts < cutoff) outcome = 'expired';
    else if (sourceSeen.has(e.history) || imported.get(e.history) || (e.platform && (oldKeys.has(e.platform) || exact.get(e.platform) || stableSeen.has(e.platform)))) outcome = 'duplicate';
    else {
      const window = overlapWindow[e.kind];
      const comparable = matchingField(e.kind, e.payload);
      for (const match of candidates.iterate(e.room_id, e.ts - window, e.ts + window, e.kind, e.uid, captureBoundary) as Iterable<{ payload: string; platform_key: string | null; guard_key: string | null }>) {
        const priorKey = knownKey({ ...match, kind: e.kind, room_id: e.room_id });
        if (priorKey && e.platform) {
          if (priorKey === e.platform) { outcome = 'duplicate'; break; }
          continue;
        }
        if (matchingField(e.kind, match.payload) === comparable) outcome = 'overlap';
      }
    }
    plan.events[e.kind][outcome]++;
    digest.update(JSON.stringify([e.id, outcome]));
    if (outcome !== 'added') continue;
    sourceSeen.add(e.history);
    if (e.platform) stableSeen.add(e.platform);
    if (apply) {
      const mapped = e.session_id === null ? undefined : sessionIds.get(e.session_id);
      const sessionId = mapped?.room === e.room_id ? mapped.id : null;
      insert.run(e.ts, e.room_id, sessionId, e.kind, e.uid, e.uname, e.viewer, e.payload, e.rule, e.status === 'queued' ? 'cleared' : e.status, e.history, e.platform);
      if (sessionId !== null) lastImportedBySession.set(sessionId, Math.max(e.ts, lastImportedBySession.get(sessionId) ?? 0));
    }
  }
  // 「本场」统计按半开时间段查询。离线设备可能比源设备更早记录了下播时间。
  if (lastImportedBySession.size) {
    const extendSession = dst.prepare('update live_sessions set ended_at = ? where id = ? and ended_at <= ?');
    for (const [sessionId, lastEvent] of lastImportedBySession) extendSession.run(lastEvent + 1, sessionId, lastEvent);
  }
  return { plan, signature: digest.digest('hex') };
}

export function previewHistory(db: Conn, file: string, days: number, now = Date.now()): HistoryReview {
  return withHistory(file, (source, exportedAt) => inspect(db, source, exportedAt, days, now, false));
}

export function applyHistory(db: Conn, file: string, days: number, expected: string, now = Date.now()): HistoryReview {
  return withHistory(file, (source, exportedAt) => db.transaction(() => {
    const result = inspect(db, source, exportedAt, days, now, true);
    if (result.signature !== expected) throw new HttpError(409, 'history_changed', '导入范围已变化，请重新预览', result);
    return result;
  }).immediate());
}
