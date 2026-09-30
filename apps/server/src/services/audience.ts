// 总览右侧面板的 B 站名单：在线观众（高能榜：只列出这场投喂、点赞、发过弹幕的观众）、舰队（大航海榜）。只在后台打开这一页时按需读取，带缓存。
// 头像、头像框等图片只记地址，后台运行时从 B 站加载。
import { getGuardPage, getOnlineRank } from '@starfall/bili';
import type { BiliHttp, ListViewer, OnlineRank } from '@starfall/bili';
import { HttpError } from '../http.ts';
import type { LiveService } from './live.ts';
import type { RoomStore } from './room.ts';

/** 在线名单缓存多久（后台 30 秒刷新一次，几个页面同时打开也只读一次） */
const ONLINE_TTL_MS = 20_000;
/** 在线名单最多读几页（每页 50 人） */
const ONLINE_PAGES = 2;
/** 舰队名单变化慢，15 分钟读一次 */
const FLEET_TTL_MS = 15 * 60_000;
/** 舰队名单最多读几页（每页 30 人）：人特别多的直播间只读前 1200 人 */
const FLEET_PAGES = 40;
/** 两页之间歇一下，别一下子请求太多 */
const PAGE_GAP_MS = 150;

export interface OnlineList {
  live: boolean;
  count: number;
  /** isMod：本直播间房管（B 站的名单里没有，按房管名单补上） */
  items: Array<OnlineRank['items'][number] & { isMod: boolean }>;
  updatedAt: number | null;
}

export interface FleetList {
  total: number;
  /** 读到的名单（人特别多时只有前面一部分） */
  members: Array<ListViewer & { isMod: boolean }>;
  updatedAt: number;
}

export interface AudienceDeps {
  room: RoomStore;
  live: Pick<LiveService, 'status' | 'isMod'>;
  anon: () => BiliHttp;
  fetchOnline?: typeof getOnlineRank;
  fetchGuards?: typeof getGuardPage;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class AudienceService {
  private readonly d: Required<Omit<AudienceDeps, 'room' | 'live' | 'anon'>> & AudienceDeps;
  private onlineCache: { roomId: number; at: number; value: OnlineList } | null = null;
  private onlineLoading: Promise<OnlineList> | null = null;
  private fleetCache: { roomId: number; value: FleetList } | null = null;
  private fleetLoading: Promise<FleetList> | null = null;

  constructor(deps: AudienceDeps) {
    this.d = { fetchOnline: getOnlineRank, fetchGuards: getGuardPage, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), ...deps };
  }

  private room() {
    const r = this.d.room.get();
    if (!r) throw new HttpError(409, 'no_room', '请先在设置里填写直播间号');
    return r;
  }

  /** 在线观众：没开播时是空的 */
  async online(): Promise<OnlineList> {
    const r = this.room();
    if (!this.d.live.status().live) return { live: false, count: 0, items: [], updatedAt: null };
    const c = this.onlineCache;
    if (c && c.roomId === r.roomId && this.d.now() - c.at < ONLINE_TTL_MS) return c.value;
    this.onlineLoading ??= (async () => {
      // 高能榜是公开的，不用登录（登录了拿到的也一样）
      const http = this.d.anon();
      const items: OnlineList['items'] = [];
      let count = 0;
      for (let page = 1; page <= ONLINE_PAGES; page++) {
        const p = await this.d.fetchOnline(http, r.roomId, r.anchorUid, page, 50);
        count = p.count;
        items.push(...p.items.filter((x) => !items.some((y) => y.uid === x.uid)).map((x) => ({ ...x, isMod: this.d.live.isMod(x.uid) })));
        if (p.items.length < 50 || items.length >= count) break;
        await this.d.sleep(PAGE_GAP_MS);
      }
      const value: OnlineList = { live: true, count, items, updatedAt: this.d.now() };
      this.onlineCache = { roomId: r.roomId, at: this.d.now(), value };
      return value;
    })()
      .catch((e: Error) => {
        if (c && c.roomId === r.roomId) return c.value;
        throw new HttpError(502, 'bili_error', `读取在线观众失败：${e.message}`);
      })
      .finally(() => (this.onlineLoading = null));
    return this.onlineLoading;
  }

  /** 舰队名单（大航海榜） */
  async fleet(): Promise<FleetList> {
    const r = this.room();
    const c = this.fleetCache;
    if (c && c.roomId === r.roomId && this.d.now() - c.value.updatedAt < FLEET_TTL_MS) return c.value;
    this.fleetLoading ??= (async () => {
      const http = this.d.anon();
      const members: FleetList['members'] = [];
      let total = 0;
      for (let page = 1; page <= FLEET_PAGES; page++) {
        const p = await this.d.fetchGuards(http, r.roomId, r.anchorUid, page);
        total = p.total;
        for (const m of p.items) if (!members.some((x) => x.uid === m.uid)) members.push({ ...m, isMod: this.d.live.isMod(m.uid) });
        if (page >= p.pages || !p.items.length) break;
        await this.d.sleep(PAGE_GAP_MS);
      }
      const value: FleetList = { total, members, updatedAt: this.d.now() };
      this.fleetCache = { roomId: r.roomId, value };
      return value;
    })()
      .catch((e: Error) => {
        if (c && c.roomId === r.roomId) return c.value;
        throw new HttpError(502, 'bili_error', `读取舰队名单失败：${e.message}`);
      })
      .finally(() => (this.fleetLoading = null));
    return this.fleetLoading;
  }
}
