// 直播间信息（总览）：标题、分区、封面、主播、粉丝数，以及直播时的看过人数、高能榜人数、点赞数。
// 标题等用公开接口定时查询；直播时的数字来自弹幕连接里的实时消息（LiveService.onStats）。
// 点赞数只在有人点赞时才推送，所以直播时再用登录账号每分钟查一次点赞总数和看过人数。
import { WbiSigner, getAnchorInfo, getLiveCounts, getRoomInfo } from '@starfall/bili';
import type { BiliHttp, RoomStatsPatch } from '@starfall/bili';
import type { LiveService } from './live.ts';
import type { RoomStore } from './room.ts';

export interface RoomInfoDto {
  roomId: number;
  title: string;
  parentAreaName: string;
  areaName: string;
  /** 封面；没有时为空（后台用主播头像代替） */
  cover: string;
  anchor: { uid: number; name: string; face: string };
  followers: number | null;
  fansClub: number | null;
  /** 只在直播时有，下播后清空 */
  watched: number | null;
  rankCount: number | null;
  likes: number | null;
  updatedAt: number;
}

export interface RoomInfoDeps {
  getRoomInfo: typeof getRoomInfo;
  getAnchorInfo: typeof getAnchorInfo;
  getLiveCounts: typeof getLiveCounts;
  now: () => number;
}

const REFRESH_MS = 5 * 60_000;
/** 直播时查点赞数的间隔 */
const COUNTS_MS = 60_000;
/** 实时数字变化很频繁，合并后再推给后台 */
const EMIT_MS = 2000;

export class RoomInfoService {
  private readonly room: RoomStore;
  private readonly live: Pick<LiveService, 'onStats' | 'onStatus' | 'status'>;
  private readonly http: () => BiliHttp;
  /** 登录账号的请求（没登录时为 null）；只在直播时使用 */
  private readonly authHttp: () => BiliHttp | null;
  private readonly deps: RoomInfoDeps;
  /** 同一个登录一直用同一个签名器（签名密钥会缓存，不用每次都查） */
  private wbi: { sess: string; http: BiliHttp; signer: WbiSigner } | null = null;
  private countsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(info: RoomInfoDto | null) => void>();
  private info: RoomInfoDto | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private wasLive = false;
  /** 每次换直播间加 1：旧直播间的查询结果不再使用 */
  private gen = 0;
  private offs: Array<() => void> = [];

  constructor(
    opts: { room: RoomStore; live: Pick<LiveService, 'onStats' | 'onStatus' | 'status'>; http: () => BiliHttp; authHttp?: () => BiliHttp | null },
    deps: RoomInfoDeps = { getRoomInfo, getAnchorInfo, getLiveCounts, now: Date.now },
  ) {
    this.room = opts.room;
    this.live = opts.live;
    this.http = opts.http;
    this.authHttp = opts.authHttp ?? (() => null);
    this.deps = deps;
  }

  get(): RoomInfoDto | null {
    return this.info;
  }

  onChange(fn: (info: RoomInfoDto | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): Promise<void> {
    this.offs.push(
      this.room.onChange(() => {
        this.gen++;
        this.info = null;
        this.emitNow();
        void this.refresh();
      }),
      this.live.onStats((p) => this.apply(p)),
      this.live.onStatus((s) => {
        if (s.live === this.wasLive) return;
        this.wasLive = s.live;
        // 开播、下播时重新查一次（封面、标题可能刚改过）；下播后直播时的数字清空
        if (!s.live && this.info) Object.assign(this.info, { watched: null, rankCount: null, likes: null });
        void this.refresh().then(() => this.refreshCounts());
      }),
    );
    this.wasLive = this.live.status().live;
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.countsTimer = setInterval(() => void this.refreshCounts(), COUNTS_MS);
    return this.refresh().then(() => this.refreshCounts());
  }

  /** 直播时查一次点赞总数、看过人数（需要登录）；没开播、没登录、查询失败时什么都不做 */
  async refreshCounts(): Promise<void> {
    const room = this.room.get();
    const fresh = this.authHttp();
    if (!room || !fresh || !this.live.status().live || !this.info) return;
    const sess = fresh.cookies.SESSDATA ?? '';
    if (this.wbi?.sess !== sess) this.wbi = { sess, http: fresh, signer: new WbiSigner(fresh) };
    const { http, signer } = this.wbi;
    const gen = this.gen;
    try {
      const c = await this.deps.getLiveCounts(http, signer, room.roomId);
      if (gen !== this.gen || !this.info || !this.live.status().live) return;
      const p: RoomStatsPatch = {};
      if (c.likes !== null) p.likes = c.likes;
      if (c.watched !== null) p.watched = c.watched;
      if (Object.keys(p).length) this.apply(p);
    } catch {
      /* 下次再查 */
    }
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.timer) clearInterval(this.timer);
    if (this.countsTimer) clearInterval(this.countsTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.timer = this.emitTimer = this.countsTimer = null;
  }

  /** 用公开接口查一次；查询失败时保留上一次的结果 */
  async refresh(): Promise<void> {
    const room = this.room.get();
    const gen = this.gen;
    if (!room) {
      this.info = null;
      return this.emitNow();
    }
    const http = this.http();
    const [r, a] = await Promise.allSettled([this.deps.getRoomInfo(http, room.roomId), this.deps.getAnchorInfo(http, room.anchorUid)]);
    if (gen !== this.gen) return;
    const prev = this.info?.roomId === room.roomId ? this.info : null;
    const ri = r.status === 'fulfilled' ? r.value : null;
    const ai = a.status === 'fulfilled' ? a.value : null;
    if (!ri && !prev) return;
    this.info = {
      roomId: room.roomId,
      title: ri?.title ?? prev?.title ?? '',
      parentAreaName: ri?.parentAreaName ?? prev?.parentAreaName ?? '',
      areaName: ri?.areaName ?? prev?.areaName ?? '',
      cover: ri ? ri.cover || ri.keyframe : (prev?.cover ?? ''),
      anchor: { uid: room.anchorUid, name: ai?.name || prev?.anchor.name || room.anchorName, face: ai?.face ?? prev?.anchor.face ?? '' },
      followers: ai?.followers ?? ri?.followers ?? prev?.followers ?? null,
      fansClub: prev?.fansClub ?? null,
      watched: prev?.watched ?? null,
      rankCount: prev?.rankCount ?? null,
      likes: prev?.likes ?? null,
      updatedAt: this.deps.now(),
    };
    this.emitNow();
  }

  private apply(p: RoomStatsPatch): void {
    if (!this.info) return;
    Object.assign(this.info, p, { updatedAt: this.deps.now() });
    this.emitSoon();
  }

  private emitSoon(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, EMIT_MS);
  }

  private emitNow(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    for (const fn of this.listeners) fn(this.info);
  }
}
