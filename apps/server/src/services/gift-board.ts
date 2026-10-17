// 送礼名单的内容：每个输出按自己的设置（时间范围、哪些礼物、显示方式）从事件记录装好名单；新收到礼物时算出变了的那一行，
// 发给这个输出的送礼名单页和管理后台。设置一样的输出共用一份。
// 「本场」：开播时是本场，下播后保留上一场的，新开一场时清空；今天 / 本周 / 本月按主播时区，到了新的一天 / 周 / 月自动换
import { GIFTS_KEEP, giftBoardAdd, giftRowsSorted, giftRowsTrim, giftsRange, giftsView } from '@starfall/shared';
import type { GiftListItem, GiftRow, GiftsFilter } from '@starfall/shared';
import { dayShift, dayStart, monthStartDay, weekStartDay } from '../time.ts';
import type { EventLog } from './events.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { OutputRow, OutputStore } from './outputs.ts';
import type { RoomStore } from './room.ts';

type LogRow = { id: number; ts: number; kind: string; viewer: unknown; payload: unknown };

export interface GiftBoardDeps {
  log: Pick<EventLog, 'giftListRange'>;
  live: Pick<LiveService, 'status'> & Partial<Pick<LiveService, 'lastSession'>>;
  room: Pick<RoomStore, 'get'>;
  outputs: Pick<OutputStore, 'list'>;
  hub: Pick<Hub, 'giftRow' | 'giftRows'>;
  timeZone: string;
  now: () => number;
  /** 一条事件记录变成名单的一条；免费礼物、看不懂的记录为 null */
  itemOf: (row: LogRow) => GiftListItem | null;
}

interface Board {
  /** 影响名单内容的设置 + 算好的时间范围（场次或开始时间）：一样的输出共用 */
  key: string;
  filter: GiftsFilter;
  rows: Map<string, GiftRow>;
  outputs: Set<number>;
  /** 装进来的记录里最大的编号：比这小的已经算过了（刚记下就装了名单，推过来时不能再算一次） */
  upTo: number;
}

/** 名单装哪些记录：某一场，或者从某个时间起；null 为没有记录可装（从没开过播、没有直播间、只显示挂上的记录） */
type Span = { session: number } | { from: number } | null;

export class GiftBoards {
  private readonly d: GiftBoardDeps;
  private readonly dayFmt: Intl.DateTimeFormat;
  private readonly boards = new Map<string, Board>();
  private readonly byOutput = new Map<number, Board>();
  /** 「本场」用的场次 */
  private session: number | null = null;
  /** 现在的直播间（换了直播间时 reset 重新取） */
  private roomId: number | null = null;
  /** 今天、本周、本月从几点开始，next 为明天 0 点（按日子记住，不用每次都算） */
  private days: { day: string; next: number; today: number; week: number; month: number } | null = null;

  constructor(d: GiftBoardDeps) {
    this.d = d;
    // sv-SE 的日期格式就是 YYYY-MM-DD
    this.dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: d.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  /** 服务启动时：「本场」先用上一场的（直播中重启时，接上本场后 sync 会换成本场的）；给每个输出装好名单（这时还没有页面连着） */
  restore(): void {
    const room = this.d.room.get();
    this.roomId = room?.roomId ?? null;
    this.session = this.d.live.status().sessionId ?? (room ? (this.d.live.lastSession?.(room.roomId)?.id ?? null) : null);
    this.boards.clear();
    this.byOutput.clear();
    for (const o of this.d.outputs.list()) this.attach(o.id, o.giftsFilter, false);
  }

  /** 换了直播间：「本场」先清空，所有名单按新的直播间重新装 */
  reset(): void {
    this.session = null;
    this.roomId = this.d.room.get()?.roomId ?? null;
    this.sync(true);
  }

  /** 输出设置变了：影响名单内容时重新装、整份发过去；删掉了就不再管 */
  outputChanged(o: OutputRow, change: 'update' | 'key' | 'delete'): void {
    if (change === 'delete') this.detach(o.id);
    else if (change === 'update') this.attach(o.id, o.giftsFilter, true);
  }

  /** 定时调用（很频繁，平时只比一下场次和时间）：新开了一场、到了新的一天 / 周 / 月时重新装（force 为全部重新装） */
  sync(force = false): void {
    const sid = this.d.live.status().sessionId;
    const newSession = sid !== null && sid !== this.session;
    if (newSession) this.session = sid;
    if (!force && !newSession && !(this.days && this.d.now() >= this.days.next)) return;
    const all = [...this.byOutput].map(([id, b]) => [id, b.filter] as const);
    if (force) {
      this.boards.clear();
      this.byOutput.clear();
    }
    for (const [id, f] of all) {
      const b = this.byOutput.get(id);
      if (!b || this.keyOf(f) !== b.key) this.attach(id, f, true);
    }
  }

  /** 新收到一份（付费礼物、上舰、醒目留言；编号是 log-事件记录编号）：算进每份名单，变了的那一行发给用这份名单的输出 */
  push(item: GiftListItem): void {
    this.sync();
    const n = Number(item.id.replace(/^log-/, ''));
    for (const b of this.boards.values()) {
      if (Number.isFinite(n)) {
        if (n <= b.upTo) continue;
        b.upTo = n;
      }
      const row = giftBoardAdd(b.rows, b.filter, item);
      if (!row) continue;
      // 一份一条、不合并时只记排在前面的那些（每条都不会再变）；按金额排时太小的这一条可能直接排在外面
      if (giftsView(b.filter) === 'item' && !b.filter.merge) giftRowsTrim(b.rows, b.filter, GIFTS_KEEP);
      if (!b.rows.has(row.id)) continue;
      for (const id of b.outputs) this.d.hub.giftRow(id, row);
    }
  }

  /** 某个输出现在的名单（排好顺序）：送礼名单页刚连上、后台刚打开时用 */
  rows(outputId: number): GiftRow[] {
    let b = this.byOutput.get(outputId);
    if (!b) {
      // 新建的输出：第一次用到时再装
      const o = this.d.outputs.list().find((x) => x.id === outputId);
      if (!o) return [];
      b = this.attach(o.id, o.giftsFilter, false);
    }
    return giftRowsSorted(b.rows.values(), b.filter);
  }

  private attach(outputId: number, filter: GiftsFilter, send: boolean): Board {
    const key = this.keyOf(filter);
    const cur = this.byOutput.get(outputId);
    if (cur && cur.key === key) {
      cur.filter = filter;
      return cur;
    }
    this.detach(outputId);
    let b = this.boards.get(key);
    if (!b) {
      b = { key, filter, ...this.load(filter), outputs: new Set() };
      this.boards.set(key, b);
    }
    b.outputs.add(outputId);
    this.byOutput.set(outputId, b);
    if (send) this.d.hub.giftRows(outputId, giftRowsSorted(b.rows.values(), b.filter));
    return b;
  }

  private detach(outputId: number): void {
    const b = this.byOutput.get(outputId);
    if (!b) return;
    this.byOutput.delete(outputId);
    b.outputs.delete(outputId);
    if (!b.outputs.size && this.boards.get(b.key) === b) this.boards.delete(b.key);
  }

  /** 从事件记录装名单：按时间先后一条条算进来 */
  private load(f: GiftsFilter): { rows: Map<string, GiftRow>; upTo: number } {
    const rows = new Map<string, GiftRow>();
    const roomId = this.roomId;
    const span = this.span(f);
    let upTo = 0;
    if (roomId === null || !span) return { rows, upTo };
    const logs = 'session' in span ? this.d.log.giftListRange({ roomId, sessionId: span.session }) : this.d.log.giftListRange({ roomId, from: span.from });
    for (const r of logs) {
      upTo = Math.max(upTo, r.id);
      const it = this.d.itemOf(r);
      if (it) giftBoardAdd(rows, f, it);
    }
    if (giftsView(f) === 'item' && !f.merge) giftRowsTrim(rows, f, GIFTS_KEEP);
    return { rows, upTo };
  }

  private span(f: GiftsFilter): Span {
    if (f.mode === 'pinned') return null;
    const range = giftsRange(f);
    if (range === 'live') return this.session === null ? null : { session: this.session };
    if (range === 'since') return { from: f.since ?? 0 };
    const day = this.dayFmt.format(this.d.now());
    if (this.days?.day !== day) {
      const tz = this.d.timeZone;
      this.days = { day, next: dayStart(dayShift(day, 1), tz), today: dayStart(day, tz), week: dayStart(weekStartDay(day), tz), month: dayStart(monthStartDay(day), tz) };
    }
    return { from: this.days[range] };
  }

  /** 只算影响名单内容的设置（置顶、显示金额只管怎么画，不用重新装） */
  private keyOf(f: GiftsFilter): string {
    const kinds = f.mode === 'only' ? f.gifts.map((g) => g.id).sort((a, b) => a - b) : (f.minGold ?? 0);
    return JSON.stringify([this.roomId, this.span(f), f.mode, kinds, f.guard, f.sc, giftsView(f), f.sort ?? 'time', Boolean(f.merge)]);
  }
}
