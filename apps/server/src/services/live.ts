// 直播连接（需求 F-BL-04 ~ 07、F-BL-10）。
// 默认"只在开播时连接"：未开播时只用公开接口每分钟查一次状态，账号不在线；开播后才用账号连接直播间。
import { desc, eq, isNull } from 'drizzle-orm';
import { LiveClient, WbiSigner, getDanmuInfo, getRoomAdmins, getRoomInit, parseMessage } from '@starfall/bili';
import type { BiliHttp, ClientState, LiveClientOptions } from '@starfall/bili';
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
  /** 本场直播的开始时间 */
  liveSince: number | null;
  sessionId: number | null;
  connection: ClientState;
  connectionDetail: string | null;
  /** 为什么没有连接 */
  reason: LiveReason;
  adminCount: number;
}

const POLL_MS = 60_000;
const ADMIN_REFRESH_MS = 30 * 60_000;

export class LiveService {
  private readonly db: Db;
  private readonly account: BiliAccount;
  private readonly room: RoomStore;
  private readonly settings: SettingsStore;
  private readonly deps: LiveDeps;
  private readonly eventListeners = new Set<(ev: StdEvent) => void>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private adminTimer: ReturnType<typeof setInterval> | null = null;
  private client: Pick<LiveClient, 'start' | 'stop' | 'state'> | null = null;
  private connectedRoom: number | null = null;
  private admins = new Set<number>();
  private seq = 0;
  private live = false;
  private session: { id: number; startedAt: number } | null = null;
  private connection: ClientState = 'idle';
  private connectionDetail: string | null = null;
  private reason: LiveReason = 'no_room';
  /** 解析失败的消息数（协议可能变了） */
  parseErrors = 0;

  constructor(opts: { db: Db; account: BiliAccount; room: RoomStore; settings: SettingsStore }, deps: LiveDeps = defaultLiveDeps) {
    this.db = opts.db;
    this.account = opts.account;
    this.room = opts.room;
    this.settings = opts.settings;
    this.deps = deps;
  }

  onEvent(fn: (ev: StdEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onStatus(fn: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  status(): LiveStatus {
    return {
      live: this.live,
      liveSince: this.session?.startedAt ?? null,
      sessionId: this.session?.id ?? null,
      connection: this.connection,
      connectionDetail: this.connectionDetail,
      reason: this.reason,
      adminCount: this.admins.size,
    };
  }

  isMod(uid: number): boolean {
    return this.admins.has(uid);
  }

  async start(): Promise<void> {
    this.account.onChange(() => void this.reconcile());
    this.room.onChange(() => {
      this.disconnect();
      void this.poll();
    });
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.disconnect();
  }

  /** 设置变化（连接时机、未开播策略）后调用 */
  async reconcile(): Promise<void> {
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
      this.setLive(init.liveStatus === 1);
    } catch {
      /* 查询失败时保持原状态，下次再查 */
    }
    await this.reconcile();
  }

  private setLive(live: boolean): void {
    const now = this.deps.now();
    if (live && !this.session) {
      // 服务重启时如果上一场还没结束，继续使用（"本场只播一次"的记录不丢）
      const open = this.db.select().from(liveSessions).where(isNull(liveSessions.endedAt)).orderBy(desc(liveSessions.id)).get();
      this.session = open ? { id: open.id, startedAt: open.startedAt } : this.newSession(now);
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

  private newSession(now: number): { id: number; startedAt: number } {
    const r = this.db.insert(liveSessions).values({ startedAt: now }).returning({ id: liveSessions.id }).get();
    return { id: r.id, startedAt: now };
  }

  private async connect(roomId: number, http: BiliHttp): Promise<void> {
    const buvid = await http.ensureBuvid().catch(() => '');
    await this.refreshAdmins(roomId);
    const wbi = new WbiSigner(http);
    this.connectedRoom = roomId;
    this.client = this.deps.createClient({
      roomId,
      uid: http.uid,
      buvid,
      getDanmuInfo: () => this.deps.getDanmuInfo(http, wbi, roomId),
      onState: (s, detail) => {
        this.connection = s;
        this.connectionDetail = detail ?? null;
        this.emitStatus();
      },
      onMessage: (raw) => this.handle(raw),
    });
    this.client.start();
    this.adminTimer = setInterval(() => void this.refreshAdmins(roomId), ADMIN_REFRESH_MS);
  }

  private disconnect(): void {
    if (this.adminTimer) clearInterval(this.adminTimer);
    this.adminTimer = null;
    if (this.client) this.client.stop();
    this.client = null;
    this.connectedRoom = null;
    this.connection = 'idle';
    this.connectionDetail = null;
  }

  private async refreshAdmins(roomId: number): Promise<void> {
    try {
      this.admins = new Set((await this.deps.getRoomAdmins(this.account.anon, roomId)).map((a) => a.uid));
    } catch {
      /* 保留上一次的名单 */
    }
  }

  private handle(raw: { cmd?: string; [k: string]: unknown }): void {
    let ev: StdEvent | null;
    try {
      ev = parseMessage(raw, { newId: () => `b${this.deps.now()}-${++this.seq}`, now: this.deps.now, isMod: (uid) => this.admins.has(uid) });
    } catch {
      this.parseErrors++;
      return;
    }
    if (!ev) return;
    if (ev.kind === 'live') {
      // 开播 / 下播消息比轮询更及时
      this.setLive(ev.live);
      void this.reconcile();
      return;
    }
    for (const fn of this.eventListeners) fn(ev);
  }

  private emitStatus(): void {
    const s = this.status();
    for (const fn of this.statusListeners) fn(s);
  }
}
