// 直播连接（需求 F-BL-04 ~ 07、F-BL-10）。
// 默认"只在开播时连接"：未开播时只用公开接口每分钟查一次状态，账号不在线；开播后才用账号连接直播间。
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { BiliApiError, LiveClient, WbiSigner, getDanmuInfo, getRoomAdmins, getRoomInit, parseMessage, parseRoomStats } from '@starfall/bili';
import type { BiliHttp, ClientState, LiveClientOptions, RoomStatsPatch } from '@starfall/bili';
import type { StdEvent } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { liveSessions } from '../db/schema.ts';
import type { BiliAccount } from './bili-account.ts';
import type { RoomStore } from './room.ts';
import type { SettingsStore } from './settings.ts';

export interface LiveDeps {
  getRoomInit: typeof getRoomInit;
  getRoomAdmins: typeof getRoomAdmins;
  getDanmuInfo: typeof getDanmuInfo;
  createClient: (o: LiveClientOptions) => Pick<LiveClient, 'start' | 'stop' | 'state'>;
  now: () => number;
}

export const defaultLiveDeps: LiveDeps = {
  getRoomInit,
  getRoomAdmins,
  getDanmuInfo,
  createClient: (o) => new LiveClient(o),
  now: Date.now,
};

export type LiveReason = 'ok' | 'no_room' | 'not_logged_in' | 'offline';

export interface LiveStatus {
  live: boolean;
  /** 本场直播的开始时间（B 站记录的开播时间；拿不到时是发现开播的时间） */
  liveSince: number | null;
  sessionId: number | null;
  connection: ClientState;
  connectionDetail: string | null;
  /** 为什么没有连接 */
  reason: LiveReason;
  /** B 站说登录已失效（在别处退出或过期）：要重新扫码，不然收不到直播间消息 */
  loginInvalid: boolean;
  adminCount: number;
}

const POLL_MS = 60_000;
/** 我们发现开播的时间总比 B 站记录的开播时间晚；早于开播时间这么多以上的记录算上一场 */
const SESSION_SLACK_MS = 60_000;
/** 本场记录的开始时间和 B 站的开播时间差得不多时，改成 B 站的时间（旧版本记录的是发现开播的时间） */
const SINCE_FIX_MS = 12 * 3600_000;
const ADMIN_REFRESH_MS = 30 * 60_000;

export class LiveService {
  private readonly db: Db;
  private readonly account: BiliAccount;
  private readonly room: RoomStore;
  private readonly settings: SettingsStore;
  private readonly deps: LiveDeps;
  private readonly eventListeners = new Set<(ev: StdEvent, raw: unknown) => void>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private readonly statsListeners = new Set<(p: RoomStatsPatch) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconciling: Promise<void> = Promise.resolve();
  /** 每次断开加 1：连接过程中断开过就放弃这次连接 */
  private gen = 0;
  private stopped = false;
  private adminTimer: ReturnType<typeof setInterval> | null = null;
  private client: Pick<LiveClient, 'start' | 'stop' | 'state'> | null = null;
  private connectedRoom: number | null = null;
  private admins = new Set<number>();
  private seq = 0;
  private live = false;
  private session: { id: number; roomId: number | null; startedAt: number } | null = null;
  private connection: ClientState = 'idle';
  private connectionDetail: string | null = null;
  private loginInvalid = false;
  private reason: LiveReason = 'no_room';
  /** 解析失败的消息数（协议可能变了） */
  parseErrors = 0;
  /** 协议层的警告合并后写日志：每分钟最多一条，避免坏数据刷屏 */
  private warnings = new Map<string, number>();
  private warnFlushAt = 0;

  constructor(opts: { db: Db; account: BiliAccount; room: RoomStore; settings: SettingsStore }, deps: LiveDeps = defaultLiveDeps) {
    this.db = opts.db;
    this.account = opts.account;
    this.room = opts.room;
    this.settings = opts.settings;
    this.deps = deps;
  }

  /** 收到的事件；raw 是原始消息，写进事件记录用于排查协议问题 */
  onEvent(fn: (ev: StdEvent, raw: unknown) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** 直播间实时数据（看过人数、高能榜、点赞、粉丝、标题分区变更） */
  onStats(fn: (p: RoomStatsPatch) => void): () => void {
    this.statsListeners.add(fn);
    return () => this.statsListeners.delete(fn);
  }

  status(): LiveStatus {
    return {
      live: this.live,
      liveSince: this.session?.startedAt ?? null,
      sessionId: this.session?.id ?? null,
      connection: this.connection,
      connectionDetail: this.connectionDetail,
      reason: this.reason,
      loginInvalid: this.loginInvalid,
      adminCount: this.admins.size,
    };
  }

  isMod(uid: number): boolean {
    return this.admins.has(uid);
  }

  async start(): Promise<void> {
    // 换了账号（重新扫码、退出）：断开，用新的登录信息重新连接
    this.account.onChange(() => {
      this.disconnect();
      void this.reconcile();
    });
    this.room.onChange(() => {
      // 换了直播间：上一个直播间的这一场到此为止，数据分开算
      this.disconnect();
      this.setLive(false);
      void this.poll();
    });
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.disconnect();
  }

  /** 设置变化（连接时机、未开播策略）后调用。同一时间只运行一个，否则两次调用可能各建一个连接 */
  reconcile(): Promise<void> {
    const run = this.reconciling.then(() => this.doReconcile());
    this.reconciling = run.catch(() => undefined);
    return run;
  }

  private async doReconcile(): Promise<void> {
    if (this.stopped) return;
    const room = this.room.get();
    const http = this.account.http();
    const mode = this.settings.get('connectMode');
    const rehearsal = this.settings.get('offlinePolicy') === 'play';
    const want = Boolean(room && http && (this.live || mode === 'always' || rehearsal));
    this.reason = !room ? 'no_room' : !http ? 'not_logged_in' : !want ? 'offline' : 'ok';
    if (want && (!this.client || this.connectedRoom !== room!.roomId)) {
      this.disconnect();
      await this.connect(room!.roomId, http!);
    } else if (!want) {
      this.disconnect();
    }
    this.emitStatus();
  }

  /** 用公开接口查一次开播状态（不带登录信息） */
  async poll(): Promise<void> {
    const room = this.room.get();
    if (!room) {
      this.setLive(false);
      return this.reconcile();
    }
    try {
      const init = await this.deps.getRoomInit(this.account.anon, room.roomId);
      // 查询期间换了直播间：这是旧直播间的结果，丢掉
      if (this.room.get()?.roomId !== room.roomId) return;
      this.setLive(init.liveStatus === 1, init.liveSince ?? null);
    } catch {
      /* 查询失败时保持原状态，下次再查 */
    }
    await this.reconcile();
  }

  /** liveSince：B 站给的这一场开播时间（毫秒），用来判断没关闭的记录是不是同一场，也作为本场的开始时间 */
  private setLive(live: boolean, liveSince: number | null = null): void {
    const now = this.deps.now();
    const roomId = this.room.get()?.roomId ?? null;
    if (live && !this.session) {
      // 服务重启时如果这一场还没结束，继续使用（"本场只播一次"的记录不丢）；
      // 没关闭的记录早于这一场的开播时间（或者是别的直播间的），说明是上一场，先关掉再新建
      const open = this.db.select().from(liveSessions).where(isNull(liveSessions.endedAt)).orderBy(desc(liveSessions.id)).get();
      const sameRoom = open !== undefined && (open.roomId === null || open.roomId === roomId);
      const sameLive = open !== undefined && sameRoom && (liveSince === null || open.startedAt >= liveSince - SESSION_SLACK_MS);
      if (open && !sameLive) this.db.update(liveSessions).set({ endedAt: sameRoom ? (liveSince ?? now) : now }).where(isNull(liveSessions.endedAt)).run();
      this.session = open && sameLive ? { id: open.id, roomId: open.roomId ?? roomId, startedAt: open.startedAt } : this.newSession(roomId, liveSince ?? now);
    }
    // 开播时间以 B 站为准（开播消息里没有开播时间，下一次查询时补上）
    if (live && this.session && liveSince !== null && liveSince !== this.session.startedAt && Math.abs(liveSince - this.session.startedAt) < SINCE_FIX_MS) {
      this.session.startedAt = liveSince;
      this.db.update(liveSessions).set({ startedAt: liveSince }).where(eq(liveSessions.id, this.session.id)).run();
      this.emitStatus();
    }
    if (!live) {
      if (this.session) this.db.update(liveSessions).set({ endedAt: now }).where(eq(liveSessions.id, this.session.id)).run();
      else this.db.update(liveSessions).set({ endedAt: now }).where(isNull(liveSessions.endedAt)).run();
      this.session = null;
    }
    if (live !== this.live) {
      this.live = live;
      this.emitStatus();
    }
  }

  private newSession(roomId: number | null, startedAt: number): { id: number; roomId: number | null; startedAt: number } {
    const r = this.db.insert(liveSessions).values({ roomId, startedAt }).returning({ id: liveSessions.id }).get();
    return { id: r.id, roomId, startedAt };
  }

  /** 这个直播间最近一场已经结束的直播 */
  lastSession(roomId: number): { id: number; startedAt: number; endedAt: number } | null {
    const r = this.db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.roomId, roomId), isNotNull(liveSessions.endedAt)))
      .orderBy(desc(liveSessions.id))
      .limit(1)
      .get();
    return r ? { id: r.id, startedAt: r.startedAt, endedAt: r.endedAt! } : null;
  }

  private async connect(roomId: number, http: BiliHttp): Promise<void> {
    const gen = this.gen;
    const buvid = await http.ensureBuvid().catch(() => '');
    await this.refreshAdmins(roomId);
    // 等待期间断开了（换了直播间、停止服务）：不再连接
    if (gen !== this.gen || this.stopped) return;
    const wbi = new WbiSigner(http);
    this.connectedRoom = roomId;
    this.loginInvalid = false;
    this.client = this.deps.createClient({
      roomId,
      uid: http.uid,
      buvid,
      getDanmuInfo: () =>
        this.deps.getDanmuInfo(http, wbi, roomId).catch((e: unknown) => {
          // -101：账号未登录（登录已过期或在别处退出）
          if (e instanceof BiliApiError && e.code === -101) {
            if (!this.loginInvalid) {
              this.loginInvalid = true;
              this.emitStatus();
            }
            throw new Error('B 站登录已失效');
          }
          throw e;
        }),
      onState: (s, detail) => {
        if (s === 'connected') this.loginInvalid = false;
        this.connection = s;
        this.connectionDetail = detail ?? null;
        this.emitStatus();
      },
      onMessage: (raw) => this.handle(raw),
      onWarn: (msg) => this.warn(msg),
    });
    this.client.start();
    this.adminTimer = setInterval(() => void this.refreshAdmins(roomId), ADMIN_REFRESH_MS);
  }

  private disconnect(): void {
    this.gen++;
    if (this.adminTimer) clearInterval(this.adminTimer);
    this.adminTimer = null;
    if (this.client) this.client.stop();
    this.client = null;
    this.connectedRoom = null;
    this.connection = 'idle';
    this.connectionDetail = null;
    this.loginInvalid = false;
  }

  private async refreshAdmins(roomId: number): Promise<void> {
    try {
      this.admins = new Set((await this.deps.getRoomAdmins(this.account.anon, roomId)).map((a) => a.uid));
    } catch {
      /* 保留上一次的名单 */
    }
  }

  private handle(raw: { cmd?: string; [k: string]: unknown }): void {
    const stats = parseRoomStats(raw as Parameters<typeof parseRoomStats>[0]);
    if (stats) {
      for (const fn of this.statsListeners) fn(stats);
      return;
    }
    let ev: StdEvent | null;
    try {
      ev = parseMessage(raw, { newId: () => `b${this.deps.now()}-${++this.seq}`, now: this.deps.now, isMod: (uid) => this.admins.has(uid), anchorUid: this.room.get()?.anchorUid ?? 0 });
    } catch (e) {
      this.parseErrors++;
      this.warn(`解析 ${raw.cmd ?? '?'} 失败：${(e as Error).message}`);
      return;
    }
    if (!ev) return;
    if (ev.kind === 'live') {
      // 开播 / 下播消息比轮询更及时
      this.setLive(ev.live);
      void this.reconcile();
      return;
    }
    for (const fn of this.eventListeners) fn(ev, raw);
  }

  private warn(msg: string): void {
    this.warnings.set(msg, (this.warnings.get(msg) ?? 0) + 1);
    const now = this.deps.now();
    if (now < this.warnFlushAt) return;
    this.warnFlushAt = now + 60_000;
    for (const [m, n] of this.warnings) console.warn(`[直播连接] ${m}${n > 1 ? `（${n} 次）` : ''}`);
    this.warnings.clear();
  }

  private emitStatus(): void {
    const s = this.status();
    for (const fn of this.statusListeners) fn(s);
  }
}
