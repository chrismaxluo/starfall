// 弹幕点歌（服务端）：认弹幕指令 → 检查规则 → 找歌（本地歌库 / 网易云）→ 排队 → 交给点歌窗口播放。
//
// 播放由服务端安排：快轮到时才去拿播放地址（网易云的地址过一阵会失效），整份状态发给所有点歌窗口；
// 只有一个窗口（最早加到直播软件里的那个）出声音，别的只显示。出声的窗口报「开始了」「放到哪了」「放完了」「放不了」。
// 不放的情况（hold）：点歌关着、后台暂停、没开播（下播自动暂停）、没有点歌窗口。这时正在放的歌停在原处，恢复后接着放。
// 有带声音的特效在播时，让出声的窗口把音乐调小。
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { whoOk } from '@starfall/core/danmu';
import { NeteaseError, pick } from '@starfall/music';
import type { NeteaseSong, PickResult } from '@starfall/music';
import { MUSIC_DEFAULTS, MUSIC_QUEUE_SEND, MusicSettingsSchema, parseLrc } from '@starfall/shared';
import type { DanmuEvent, GuardLevel, LyricLine, MusicHold, MusicItem, MusicNotice, MusicRequester, MusicSettings, MusicSong, MusicState, PlayItem, StdEvent, Viewer } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { musicRequests } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { MusicAccount } from './music-account.ts';
import type { MusicLibrary } from './music-library.ts';
import type { RoomStore } from './room.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

const KEY = 'music';
const PAUSED_KEY = 'musicPaused';
/** 后台显示最近几条点歌提示 */
const NOTICE_KEEP = 30;
/** 两首歌之间停一下 */
export const MUSIC_GAP_MS = 800;
/** 点歌窗口多久没开始出声就算放不了 */
export const MUSIC_LOAD_TIMEOUT_MS = 20_000;
/** 过了歌的时长这么久还没报「放完了」，就当放完了（窗口卡住时不一直等） */
const END_GRACE_MS = 20_000;
const TICK_MS = 2000;

type Row = typeof musicRequests.$inferSelect;
export type MusicStatus = Row['status'];

interface Current {
  row: Row;
  url: string;
  lyric: LyricLine[] | null;
  load: number;
  /** 地址失效时已经重新拿过一次 */
  retried: boolean;
  /** 出声的窗口说已经开始了 */
  started: boolean;
  /** posMs 是 posAt 那一刻放到的位置；没在走（暂停、加载中、没有窗口）时 posAt 为 null */
  posMs: number;
  posAt: number | null;
  /** 从什么时候开始等窗口出声（等太久算放不了） */
  waitSince: number | null;
}

export interface RequestResult {
  ok: boolean;
  text: string;
  item?: MusicItem;
}

/** 后台搜歌的结果：放不了的也列出来，说明原因 */
export type SearchHit = MusicSong & { playable: boolean; note?: string };

export interface MusicHistoryRow {
  id: number;
  item: MusicItem;
  status: MusicStatus;
  note: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface MusicDeps {
  db: Db;
  settings: SettingsStore;
  account: Pick<MusicAccount, 'client' | 'vip'>;
  library: MusicLibrary;
  hub: Hub;
  live: Pick<LiveService, 'status' | 'onStatus' | 'onEvent'>;
  room: RoomStore;
  viewers?: Pick<ViewerStore, 'cached'>;
  /** 正在播的特效（有声音时把音乐调小）；测试里可以不传 */
  fx?: { playingItem(): PlayItem | null; onQueueChange(fn: () => void): () => void };
  now?: () => number;
}

/** 这个特效有没有声音：配了音效，或者画面是有声音的视频 */
export function effectHasSound(item: PlayItem): boolean {
  const e = item.effect;
  if (e.volume <= 0) return false;
  return e.sound !== null || (e.visual.type === 'asset' && e.visual.kind === 'video');
}

const neteaseSong = (n: NeteaseSong): MusicSong => ({ source: 'netease', id: String(n.id), name: n.name, artists: n.artists.join(' / '), ...(n.album ? { album: n.album } : {}), ...(n.cover ? { cover: `${n.cover}?param=300y300` } : {}), durationMs: n.durationMs });

export class MusicService {
  private readonly d: MusicDeps;
  private readonly now: () => number;
  private cur: Current | null = null;
  private pumping = false;
  private readonly cooldown = new Map<number, number>();
  private readonly inflight = new Set<number>();
  private notices: MusicNotice[] = [];
  private duckOn = false;
  /** 没开播时后台手动点了「继续」：这次下播之前不再自动暂停 */
  private offlineOk = false;
  private lastLive = false;
  private player: unknown = null;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();

  constructor(deps: MusicDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
  }

  // ---------- 设置 ----------

  /** 点歌设置（以前没有的项用默认值补上） */
  cfg(): MusicSettings {
    const raw = this.d.settings.getRaw<Partial<MusicSettings>>(KEY) ?? {};
    return { ...MUSIC_DEFAULTS, ...raw };
  }

  updateSettings(patch: Partial<MusicSettings>): MusicSettings {
    const next = MusicSettingsSchema.parse({ ...this.cfg(), ...patch });
    this.d.settings.setRaw(KEY, next);
    // 关掉点歌：正在等的点歌不要了（列表保留，打开后接着放）
    this.changed();
    this.pump();
    return next;
  }

  /** 状态变了（后台、点歌窗口要更新） */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- 启动 ----------

  start(): void {
    // 上次关掉服务时正在放的：放回列表最前面，从头放
    const playing = this.d.db.select().from(musicRequests).where(eq(musicRequests.status, 'playing')).all();
    if (playing.length) {
      const min = this.queuedRows()[0]?.sort ?? 0;
      playing.forEach((r, i) => this.d.db.update(musicRequests).set({ status: 'queued', sort: min - playing.length + i, startedAt: null }).where(eq(musicRequests.id, r.id)).run());
    }
    this.lastLive = this.d.live.status().live;
    this.offs.push(
      this.d.live.onEvent((ev: StdEvent) => {
        if (ev.kind === 'danmu') this.onDanmu(ev);
      }),
      this.d.live.onStatus((s) => {
        if (s.live === this.lastLive) return;
        this.lastLive = s.live;
        // 下播：之前手动点的「继续」不再算数，下次开播自动接着放
        if (!s.live) this.offlineOk = false;
        this.changed();
        this.pump();
      }),
      this.d.hub.onOverlaysChange(() => this.overlaysChanged()),
    );
    if (this.d.fx) this.offs.push(this.d.fx.onQueueChange(() => this.syncDuck()));
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.pump();
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearInterval(this.timer);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.timer = this.gapTimer = null;
  }

  // ---------- 状态 ----------

  paused(): boolean {
    return this.d.settings.getRaw<boolean>(PAUSED_KEY) === true;
  }

  hold(): MusicHold {
    const s = this.cfg();
    if (!s.enabled) return 'disabled';
    if (this.paused()) return 'manual';
    if (s.autoPause && !this.d.live.status().live && !this.offlineOk) return 'offline';
    if (!this.d.hub.musicPlayer()) return 'no_player';
    return null;
  }

  private pos(c: Current): number {
    return c.posAt === null ? c.posMs : c.posMs + (this.now() - c.posAt);
  }

  private queuedRows(): Row[] {
    return this.d.db.select().from(musicRequests).where(eq(musicRequests.status, 'queued')).orderBy(asc(musicRequests.sort), asc(musicRequests.id)).all();
  }

  item(r: Row): MusicItem {
    const song: MusicSong = { source: r.source, id: r.songId, name: r.name, artists: r.artists, ...(r.album ? { album: r.album } : {}), ...(r.cover ? { cover: r.cover } : {}), durationMs: r.durationMs };
    return { id: r.id, song, by: { uid: r.uid, name: r.uname, ...(r.face ? { face: r.face } : {}), guard: r.guard as GuardLevel }, at: r.createdAt };
  }

  state(player = false): MusicState {
    const s = this.cfg();
    const queued = this.queuedRows();
    const c = this.cur;
    return {
      enabled: s.enabled,
      hold: this.hold(),
      now: c ? { item: this.item(c.row), posMs: Math.round(this.pos(c)), paused: c.posAt === null, lyric: c.lyric, load: c.load, ...(player ? { url: c.url } : {}) } : null,
      queue: queued.slice(0, MUSIC_QUEUE_SEND).map((r) => this.item(r)),
      total: queued.length,
      display: { style: s.style, side: s.side, size: s.size, showQueue: s.showQueue, lyrics: s.lyrics, lyricsTrans: s.lyricsTrans },
      cmd: s.cmdRequest,
      volume: s.volume,
    };
  }

  /** 后台用：整份状态 + 最近的提示 + 出声的窗口在不在 */
  snapshot(): { state: MusicState; notices: MusicNotice[]; player: boolean; queue: MusicItem[] } {
    return { state: this.state(), notices: this.notices, player: this.d.hub.musicPlayer() !== null, queue: this.queuedRows().map((r) => this.item(r)) };
  }

  /** 有变化：先按现在能不能放更新位置（暂停时停住、恢复时接着走），再发给所有点歌窗口和后台 */
  private changed(): void {
    const c = this.cur;
    if (c) {
      const running = this.hold() === null;
      if (running && c.started && c.posAt === null) c.posAt = this.now();
      if ((!running || !c.started) && c.posAt !== null) {
        c.posMs = this.pos(c);
        c.posAt = null;
      }
      if (running && !c.started) c.waitSince ??= this.now();
      if (!running) c.waitSince = null;
    }
    this.d.hub.toMusic((player) => ({ type: 'music', state: this.state(player), player }));
    this.d.hub.toAdmins({ type: 'music', ...this.snapshot() });
    for (const fn of this.listeners) fn();
  }

  /** 点歌窗口上下线：换了出声的窗口时，新窗口要重新加载（从停住的地方接着放） */
  private overlaysChanged(): void {
    const p = this.d.hub.musicPlayer();
    if (p !== this.player) {
      this.player = p;
      if (this.cur) {
        this.cur.posMs = this.pos(this.cur);
        this.cur.posAt = null;
        this.cur.started = false;
      }
      this.changed();
      if (p && this.duckOn) this.d.hub.toMusicPlayer({ type: 'music_duck', on: true, pct: this.cfg().duckPct });
      this.pump();
    } else this.changed();
  }

  private notice(ok: boolean, who: string, text: string): MusicNotice {
    const n: MusicNotice = { id: `m${this.now()}-${++this.seq}`, ok, who, text, ts: this.now() };
    this.notices = [n, ...this.notices].slice(0, NOTICE_KEEP);
    this.d.hub.toMusic(() => ({ type: 'music_notice', notice: n }));
    this.d.hub.toAdmins({ type: 'music_notice', notice: n });
    return n;
  }

  // ---------- 弹幕指令 ----------

  /** 收到弹幕：点歌、切歌、取消点歌（别的弹幕不管） */
  onDanmu(ev: DanmuEvent): void {
    const s = this.cfg();
    if (!s.enabled) return;
    const t = ev.text.normalize('NFKC').trim();
    if (t === s.cmdSkip.normalize('NFKC')) return void this.skipBy(ev.viewer);
    if (t === s.cmdCancel.normalize('NFKC')) return void this.cancelBy(ev.viewer);
    const cmd = s.cmdRequest.normalize('NFKC');
    if (!t.startsWith(cmd)) return;
    const q = t.slice(cmd.length).trim();
    if (!q) return;
    void this.request(ev.viewer, q).catch((e: Error) => console.error('[点歌] 处理点歌出错：', e));
  }

  private isAnchor(v: Pick<Viewer, 'uid'>): boolean {
    const a = this.d.room.get()?.anchorUid ?? 0;
    return a > 0 && v.uid === a;
  }

  private requester(v: Viewer): MusicRequester {
    const face = v.face || this.d.viewers?.cached(v.uid)?.face || '';
    return { uid: v.uid, name: v.name, ...(face ? { face } : {}), guard: v.guard };
  }

  /**
   * 点歌：检查能不能点 → 找歌 → 排队。admin 为后台点的（不受规则限制，点歌关着也能加）。
   * 结果同时显示在点歌窗口和后台
   */
  async request(viewer: Viewer, query: string, opts: { admin?: boolean } = {}): Promise<RequestResult> {
    const s = this.cfg();
    const exempt = opts.admin === true || this.isAnchor(viewer);
    const fail = (text: string, quiet = false): RequestResult => {
      if (!quiet) this.notice(false, viewer.name, text);
      return { ok: false, text };
    };
    if (!s.enabled && !opts.admin) return fail('点歌没有打开');
    const anchorUid = this.d.room.get()?.anchorUid ?? 0;
    if (!exempt && (s.bannedUids.includes(viewer.uid) || !whoOk(s.who, viewer, anchorUid))) return fail('没有点歌的权限');
    const full = () => this.queuedRows().length >= s.queueMax;
    if (full()) return fail(`列表满了（${s.queueMax} 首），等放完几首再点`);
    if (!exempt) {
      const mine = this.queuedRows().filter((r) => r.uid === viewer.uid).length;
      if (mine >= s.perUser) return fail(s.perUser === 1 ? '你点的歌还没放，放完再点' : `你已经点了 ${mine} 首，放完再点`);
      const last = this.cooldown.get(viewer.uid);
      const wait = last === undefined ? 0 : last + s.userCdSec * 1000 - this.now();
      if (wait > 0) return fail(`点得太快了，${Math.ceil(wait / 1000)} 秒后再点`);
      // 上一首还在找：不重复处理（同一个人连发两条）
      if (this.inflight.has(viewer.uid)) return fail('正在找你点的上一首', true);
    }
    this.inflight.add(viewer.uid);
    let found: PickResult<MusicSong>;
    try {
      found = await this.find(query, s);
    } finally {
      this.inflight.delete(viewer.uid);
    }
    if (!found.ok) return fail(found.text);
    const song = found.song;
    const same = (r: Row) => r.source === song.source && r.songId === song.id;
    if ((this.cur && same(this.cur.row)) || this.queuedRows().some(same)) return fail(`《${song.name}》已经在列表里了`);
    if (full()) return fail(`列表满了（${s.queueMax} 首），等放完几首再点`);
    const row = this.insert(song, this.requester(viewer), s.guardFirst && viewer.guard > 0);
    if (!exempt) this.cooldown.set(viewer.uid, this.now());
    const pos = this.queuedRows().findIndex((r) => r.id === row.id);
    const where = pos === 0 && !this.cur ? '马上播放' : `排在第 ${pos + 1 + (this.cur ? 1 : 0)} 首`;
    this.notice(true, viewer.name, `点了《${song.name}》，${where}`);
    this.changed();
    this.pump();
    return { ok: true, text: `已点《${song.name}》，${where}`, item: this.item(row) };
  }

  /** 后台直接加一首（搜歌结果里选的） */
  add(song: MusicSong, front = false): MusicItem {
    if (this.queuedRows().length >= 100) throw new HttpError(409, 'queue_full', '列表里已经有 100 首了');
    const same = (r: Row) => r.source === song.source && r.songId === song.id;
    if ((this.cur && same(this.cur.row)) || this.queuedRows().some(same)) throw new HttpError(409, 'duplicate', `《${song.name}》已经在列表里了`);
    const room = this.d.room.get();
    const face = room ? this.d.viewers?.cached(room.anchorUid)?.face : undefined;
    const row = this.insert(song, { uid: room?.anchorUid ?? 0, name: room?.anchorName || '主播', ...(face ? { face } : {}), guard: 0 }, false, front);
    this.changed();
    this.pump();
    return this.item(row);
  }

  /** 按设置的顺序在本地歌库、网易云里找；都没有时说明原因（优先说网易云的） */
  private async find(query: string, s: MusicSettings): Promise<PickResult<MusicSong>> {
    const opts = { maxMs: s.maxDurationSec * 1000, blockWords: s.blockWords };
    const order: Array<'local' | 'netease'> = s.localFirst ? ['local', 'netease'] : ['netease', 'local'];
    let failed: PickResult<MusicSong> | null = null;
    let tried = false;
    for (const src of order) {
      if (src === 'local') {
        if (!s.sourceLocal) continue;
        tried = true;
        const r = pick(query, this.d.library.search(query), opts);
        if (r.ok) return { ok: true, song: this.d.library.song(r.song.row) };
        // 本地没有很正常，不拿它当原因
        if (r.reason !== 'not_found' && r.reason !== 'no_version') failed ??= r;
      } else {
        if (!s.sourceNetease) continue;
        tried = true;
        let songs: NeteaseSong[];
        try {
          songs = await this.d.account.client().search(query, 10);
        } catch (e) {
          console.warn('[点歌] 网易云搜歌失败：', (e as Error).message);
          failed = { ok: false, reason: 'not_found', text: '网易云暂时连不上，过一会儿再点' };
          continue;
        }
        const r = pick(query, songs, opts);
        if (r.ok) return { ok: true, song: neteaseSong(r.song) };
        failed = r;
      }
    }
    if (!tried) return { ok: false, reason: 'not_found', text: '没有可以找歌的地方（网易云和本地歌库都关着）' };
    return failed ?? { ok: false, reason: 'not_found', text: `没有找到「${query}」` };
  }

  /** 加进列表：大航海插到第一首普通观众点的歌前面；front 放最前面；其余放最后。然后重新编顺序 */
  private insert(song: MusicSong, by: MusicRequester, priority: boolean, front = false): Row {
    const row = this.d.db
      .insert(musicRequests)
      .values({ roomId: this.d.room.get()?.roomId ?? null, source: song.source, songId: song.id, name: song.name, artists: song.artists, album: song.album ?? '', cover: song.cover ?? '', durationMs: song.durationMs, uid: by.uid, uname: by.name, face: by.face ?? '', guard: by.guard, status: 'queued', sort: 0, createdAt: this.now() })
      .returning()
      .get();
    const rest = this.queuedRows().filter((r) => r.id !== row.id);
    let at = rest.length;
    if (front) at = 0;
    else if (priority) {
      const i = rest.findIndex((r) => r.guard === 0);
      if (i >= 0) at = i;
    }
    rest.splice(at, 0, row);
    this.renumber(rest);
    return this.d.db.select().from(musicRequests).where(eq(musicRequests.id, row.id)).get()!;
  }

  private renumber(rows: Row[]): void {
    this.d.db.transaction((tx) => rows.forEach((r, i) => tx.update(musicRequests).set({ sort: (i + 1) * 10 }).where(eq(musicRequests.id, r.id)).run()));
  }

  /** 弹幕「切歌」：点这首歌的人、房管（看设置）、主播 */
  private skipBy(v: Viewer): void {
    const c = this.cur;
    if (!c) return;
    const s = this.cfg();
    const ok = this.isAnchor(v) || (s.skipByRequester && c.row.uid === v.uid && v.uid > 0) || (s.skipByMod && v.isMod);
    if (!ok) return;
    this.notice(true, v.name, `切掉了《${c.row.name}》`);
    this.finish('skipped', `${v.name} 切歌`);
  }

  /** 弹幕「取消点歌」：撤掉自己最后点的、还没放的那首 */
  private cancelBy(v: Viewer): void {
    const mine = this.queuedRows().filter((r) => r.uid === v.uid);
    const r = mine[mine.length - 1];
    if (!r || v.uid <= 0) return;
    this.setStatus(r.id, 'cancelled', '观众取消');
    this.notice(true, v.name, `取消了《${r.name}》`);
    this.changed();
  }

  // ---------- 后台操作 ----------

  /** 切掉正在放的 */
  skip(): boolean {
    if (!this.cur) return false;
    this.finish('skipped', '后台切歌');
    return true;
  }

  /** 从列表里删掉一首（正在放的就是切歌） */
  remove(id: number): void {
    if (this.cur?.row.id === id) return void this.skip();
    const r = this.queuedRows().find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'not_found', '这首歌已经不在列表里了');
    this.setStatus(id, 'cancelled', '后台删除');
    this.changed();
  }

  /** 调整顺序：ids 是新的顺序（没写到的按原来的顺序排在后面） */
  reorder(ids: number[]): void {
    const rows = this.queuedRows();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const seen = new Set(ordered.map((r) => r.id));
    this.renumber([...ordered, ...rows.filter((r) => !seen.has(r.id))]);
    this.changed();
    this.pump();
  }

  /** 清空列表（正在放的放完） */
  clear(): number {
    const rows = this.queuedRows();
    if (rows.length) this.d.db.update(musicRequests).set({ status: 'cancelled', note: '后台清空', endedAt: this.now() }).where(inArray(musicRequests.id, rows.map((r) => r.id))).run();
    this.changed();
    return rows.length;
  }

  /** 暂停 / 继续。没开播时点「继续」：这次下播前不再自动暂停 */
  setPaused(p: boolean): void {
    this.d.settings.setRaw(PAUSED_KEY, p);
    if (!p && !this.d.live.status().live) this.offlineOk = true;
    this.changed();
    this.pump();
  }

  /** 模拟点歌：用一位测试观众发弹幕（照样按规则判断，不用开播） */
  async simulate(text: string, viewer: Partial<Viewer> = {}): Promise<RequestResult> {
    const v: Viewer = { uid: 1, name: '测试观众', guard: 0, isMod: false, mystery: false, ...viewer };
    const s = this.cfg();
    const t = text.normalize('NFKC').trim();
    if (!s.enabled) return { ok: false, text: '点歌没有打开：先打开右上角的「点歌」开关' };
    const cmd = s.cmdRequest.normalize('NFKC');
    if (t === s.cmdSkip.normalize('NFKC') || t === s.cmdCancel.normalize('NFKC')) {
      this.onDanmu({ kind: 'danmu', id: `sim${this.now()}`, ts: this.now(), viewer: v, text: t });
      return { ok: true, text: '已发送' };
    }
    if (!t.startsWith(cmd) || !t.slice(cmd.length).trim()) return { ok: false, text: `点歌弹幕要以「${s.cmdRequest}」开头，后面写歌名` };
    return this.request(v, t.slice(cmd.length).trim());
  }

  /** 后台搜歌：本地歌库和网易云的结果都列出来（放不了的也列，写明原因） */
  async search(query: string): Promise<{ local: SearchHit[]; netease: SearchHit[]; neteaseError?: string }> {
    const s = this.cfg();
    const maxMs = s.maxDurationSec * 1000;
    const local = this.d.library.search(query, 10).map((c) => ({ ...this.d.library.song(c.row), playable: true }));
    try {
      const songs = await this.d.account.client().search(query, 20);
      const netease = songs.map((n): SearchHit => ({ ...neteaseSong(n), playable: n.playable, ...(!n.playable ? { note: n.fee === 1 ? '需要会员' : n.fee === 4 ? '要单独购买' : '暂时放不了' } : n.durationMs > maxMs ? { note: '超过设置的最长时间（后台加可以）' } : {}) }));
      return { local, netease };
    } catch (e) {
      return { local, netease: [], neteaseError: e instanceof NeteaseError ? e.message : '网易云暂时连不上' };
    }
  }

  // ---------- 播放 ----------

  /** 能放的时候拿下一首：快轮到时才拿播放地址；拿不到的跳过 */
  private pump(): void {
    if (this.pumping || this.cur || this.gapTimer || this.hold() !== null) return;
    const next = this.queuedRows()[0];
    if (!next) return;
    this.pumping = true;
    this.d.db.update(musicRequests).set({ status: 'playing', startedAt: this.now() }).where(eq(musicRequests.id, next.id)).run();
    void this.resolve(next)
      .then((r) => {
        const row = this.d.db.select().from(musicRequests).where(eq(musicRequests.id, next.id)).get()!;
        if (typeof r === 'string') {
          this.setStatus(row.id, 'failed', r);
          this.notice(false, row.uname, `${r}，已跳过`);
        } else this.cur = { row, url: r.url, lyric: r.lyric, load: 1, retried: false, started: false, posMs: 0, posAt: null, waitSince: null };
      })
      .catch((e: Error) => {
        console.error('[点歌] 准备播放出错：', e);
        this.setStatus(next.id, 'failed', '准备播放出错');
      })
      .finally(() => {
        this.pumping = false;
        this.changed();
        this.pump();
      });
  }

  /** 拿播放地址和歌词；拿不到地址时返回原因 */
  private async resolve(r: Row): Promise<{ url: string; lyric: LyricLine[] | null } | string> {
    if (r.source === 'local') {
      const row = this.d.library.get(Number(r.songId));
      if (!row) return `《${r.name}》已经从歌库里删掉了`;
      const lyric = row.lyric ? parseLrc(row.lyric) : null;
      return { url: this.d.library.url(row), lyric: lyric?.length ? lyric : null };
    }
    const n = this.d.account.client();
    const id = Number(r.songId);
    let url: { url: string } | null;
    try {
      url = await n.songUrl(id);
    } catch (e) {
      console.warn('[点歌] 获取网易云播放地址失败：', (e as Error).message);
      return `《${r.name}》获取播放地址失败（网易云暂时连不上）`;
    }
    if (!url) return `《${r.name}》放不了（可能需要会员，或者暂时没有版权）`;
    const ly = await n.lyric(id).catch(() => null);
    const lyric = ly ? parseLrc(ly.lrc, ly.trans) : null;
    return { url: url.url, lyric: lyric?.length ? lyric : null };
  }

  private setStatus(id: number, status: MusicStatus, note: string | null = null): void {
    this.d.db.update(musicRequests).set({ status, note, endedAt: this.now() }).where(eq(musicRequests.id, id)).run();
  }

  /** 这首结束了（放完、切掉、放不了）：停一下再放下一首 */
  private finish(status: MusicStatus, note: string | null = null): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.setStatus(c.row.id, status, note);
    this.changed();
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.pump();
    }, MUSIC_GAP_MS);
  }

  private mine(client: unknown, id: number, load?: number): Current | null {
    const c = this.cur;
    if (!c || c.row.id !== id || client !== this.d.hub.musicPlayer()) return null;
    if (load !== undefined && load !== c.load) return null;
    return c;
  }

  /** 出声的窗口：开始出声了 */
  playerStarted(client: unknown, id: number, load: number): void {
    const c = this.mine(client, id, load);
    if (!c) return;
    c.started = true;
    c.waitSince = null;
    this.changed();
  }

  /** 出声的窗口：放到哪了（不广播，下次有变化时一起发） */
  playerPos(client: unknown, id: number, pos: number): void {
    const c = this.mine(client, id);
    if (!c || !c.started) return;
    c.posMs = Math.max(0, pos);
    c.posAt = this.hold() === null ? this.now() : null;
  }

  playerEnded(client: unknown, id: number): void {
    if (this.mine(client, id)) this.finish('played');
  }

  /** 出声的窗口：放不了。网易云的地址可能过期了，重新拿一次；还不行就跳过 */
  playerError(client: unknown, id: number, load: number, message: string): void {
    const c = this.mine(client, id, load);
    if (!c) return;
    console.warn(`[点歌] 《${c.row.name}》放不了：${message}`);
    void this.retryOrFail(c, message);
  }

  private async retryOrFail(c: Current, message: string): Promise<void> {
    if (c.row.source === 'netease' && !c.retried) {
      c.retried = true;
      const r = await this.resolve(c.row).catch(() => null);
      if (this.cur !== c) return;
      if (r && typeof r !== 'string') {
        c.url = r.url;
        c.load++;
        c.started = false;
        c.waitSince = null;
        this.changed();
        return;
      }
    }
    if (this.cur !== c) return;
    this.notice(false, c.row.uname, `《${c.row.name}》放不了，已跳过`);
    this.finish('failed', message.slice(0, 200));
  }

  /** 定时检查：窗口一直没出声（算放不了）、过了时长还没报放完（当放完了） */
  private tick(): void {
    const c = this.cur;
    if (!c) return;
    const now = this.now();
    if (!c.started && c.waitSince !== null && now - c.waitSince > MUSIC_LOAD_TIMEOUT_MS) {
      c.waitSince = null;
      void this.retryOrFail(c, `${MUSIC_LOAD_TIMEOUT_MS / 1000} 秒内没有开始播放`);
      return;
    }
    if (c.started && c.posAt !== null && c.row.durationMs > 0 && this.pos(c) > c.row.durationMs + END_GRACE_MS) this.finish('played', '没收到放完的消息');
  }

  /** 有带声音的特效在播：让出声的窗口把音乐调小 */
  private syncDuck(): void {
    const s = this.cfg();
    const item = this.d.fx?.playingItem() ?? null;
    const on = s.duck && item !== null && effectHasSound(item);
    if (on === this.duckOn) return;
    this.duckOn = on;
    this.d.hub.toMusicPlayer({ type: 'music_duck', on, pct: s.duckPct });
  }

  // ---------- 历史 ----------

  history(limit = 100, before?: number): MusicHistoryRow[] {
    const where = before ? and(inArray(musicRequests.status, ['played', 'skipped', 'cancelled', 'failed']), lt(musicRequests.id, before)) : inArray(musicRequests.status, ['played', 'skipped', 'cancelled', 'failed']);
    return this.d.db
      .select()
      .from(musicRequests)
      .where(where)
      .orderBy(desc(musicRequests.id))
      .limit(limit)
      .all()
      .map((r) => ({ id: r.id, item: this.item(r), status: r.status, note: r.note, startedAt: r.startedAt, endedAt: r.endedAt }));
  }

  /** 最近 days 天点得最多的歌、点歌最多的观众（不算放不了、被取消的） */
  stats(days = 30): { songs: Array<{ song: MusicSong; count: number }>; people: Array<{ uid: number; name: string; face: string; count: number }>; total: number } {
    const since = this.now() - days * 86400_000;
    const cond = and(gte(musicRequests.createdAt, since), inArray(musicRequests.status, ['played', 'skipped', 'playing', 'queued']));
    const songs = this.d.db
      .select({ source: musicRequests.source, songId: musicRequests.songId, name: sql<string>`max(${musicRequests.name})`, artists: sql<string>`max(${musicRequests.artists})`, cover: sql<string>`max(${musicRequests.cover})`, durationMs: sql<number>`max(${musicRequests.durationMs})`, count: sql<number>`count(*)` })
      .from(musicRequests)
      .where(cond)
      .groupBy(musicRequests.source, musicRequests.songId)
      .orderBy(desc(sql`count(*)`))
      .limit(10)
      .all();
    const people = this.d.db
      .select({ uid: musicRequests.uid, name: sql<string>`max(${musicRequests.uname})`, face: sql<string>`max(${musicRequests.face})`, count: sql<number>`count(*)` })
      .from(musicRequests)
      .where(cond)
      .groupBy(musicRequests.uid)
      .orderBy(desc(sql`count(*)`))
      .limit(10)
      .all();
    const total = this.d.db.select({ n: sql<number>`count(*)` }).from(musicRequests).where(cond).get()?.n ?? 0;
    return {
      songs: songs.map((x) => ({ song: { source: x.source, id: x.songId, name: x.name, artists: x.artists, ...(x.cover ? { cover: x.cover } : {}), durationMs: x.durationMs }, count: x.count })),
      people,
      total,
    };
  }

  /** 清理旧的点歌记录（跟事件记录保留同样的天数；列表里的不删） */
  prune(days: number): number {
    if (days <= 0) return 0;
    const before = this.now() - days * 86400_000;
    return this.d.db
      .delete(musicRequests)
      .where(and(lt(musicRequests.createdAt, before), inArray(musicRequests.status, ['played', 'skipped', 'cancelled', 'failed'])))
      .run().changes;
  }
}
