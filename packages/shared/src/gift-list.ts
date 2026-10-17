// 送礼名单：设置、名单里的一条，以及服务端和送礼名单页共用的算法（一份礼物算进名单里的哪一行、怎么排）
import type { GuardLevel } from './events.ts';

/**
 * 送礼名单滚动速度：每秒多少像素（按 1080 宽设计的尺寸）；慢约 5 秒一条、中约 3 秒、快约 2 秒。
 * off 为不滚动：固定挂着，放不下时只留最新的几条（配合「只显示选中的礼物」把特定礼物挂在画面上）
 */
export type GiftsSpeed = 'off' | 'slow' | 'normal' | 'fast';
export const GIFTS_SPEED_PX: Record<GiftsSpeed, number> = { off: 0, slow: 20, normal: 32, fast: 50 };

/**
 * 送礼名单的外观：晶彩（彩色横条，和礼物特效同一套）、流光（深色毛玻璃）、手帐（纸条、胶带、手写字）、灵动岛（黑色胶囊）、
 * 电竞（记分牌）、弥散（半透明雾面卡片、柔光）、像素（复古游戏对话框）
 */
export const GIFTS_LOOKS = ['jingcai', 'glass', 'journal', 'island', 'esports', 'diffuse', 'pixel'] as const;
export type GiftsLook = (typeof GIFTS_LOOKS)[number];
/**
 * 送礼名单怎么滚：片尾字幕（一直慢慢往上走）、逐条上移（停一下挪一条）、翻页（一屏停几秒整屏换）、横向跑马灯（排成一行从右往左走）。
 * 速度（GiftsSpeed）对四种都管用；不滚动时都固定挂着
 */
export const GIFTS_MOTIONS = ['credits', 'step', 'page', 'marquee'] as const;
export type GiftsMotion = (typeof GIFTS_MOTIONS)[number];
/** 逐条上移：每条停几秒；翻页：每页停几秒；跑马灯：每秒多少像素 */
export const GIFTS_STEP_HOLD: Record<GiftsSpeed, number> = { off: 0, slow: 4, normal: 2.6, fast: 1.6 };
export const GIFTS_PAGE_HOLD: Record<GiftsSpeed, number> = { off: 0, slow: 8, normal: 5.5, fast: 3.5 };
export const GIFTS_MARQUEE_PX: Record<GiftsSpeed, number> = { off: 0, slow: 45, normal: 70, fast: 100 };
/** 弥散外观卡片的透明度（%）：默认一半，太透字会看不清 */
export const GIFTS_ALPHA_DEFAULT = 50;
export const GIFTS_ALPHA_MIN = 10;
export const GIFTS_ALPHA_MAX = 80;

/** 自动名单算哪段时间收到的：本场直播（没开播时是上一场）、今天、本周（周一起）、本月（1 号起）、从某个时间起 */
export type GiftsRange = 'live' | 'today' | 'week' | 'month' | 'since';
/** 名单怎么显示：一份礼物一条 / 按人合计（每人一条，按总价值排） */
export type GiftsView = 'item' | 'viewer';

/**
 * 送礼名单显示哪些：all 为所有付费礼物；only 为只显示 gifts 里勾选的礼物（按礼物编号，名字只用来在后台显示）；
 * pinned 为只显示后台挂上的记录（谁送的哪一次，可以是以前场次的），自动收到的不进来。
 * 上舰、醒目留言单独勾选，all、only 两种方式看这两项。
 * minGold：all 方式下礼物的最低金额（金瓜子，按连击合起来的总价值算；没有或 0 为不限），只管礼物，不管上舰、醒目留言。
 * 下面几项是 v1.8 加的，没有时按以前的样子（本场、一份一条、按时间）：
 * range / since：自动名单的时间范围，since 为「从某个时间起」的开始时间（毫秒）；
 * view：一份一条 / 按人合计；sort：一份一条时按时间先后还是按金额（大的在上）；merge：一份一条时同一个人的同一种礼物合成一条；
 * pinTop：自动名单的最上面固定显示挂上的记录；amount：按人合计时显示总金额（默认显示）
 */
export interface GiftsFilter {
  mode: 'all' | 'only' | 'pinned';
  gifts: Array<{ id: number; name: string }>;
  guard: boolean;
  sc: boolean;
  minGold?: number;
  range?: GiftsRange;
  since?: number;
  view?: GiftsView;
  sort?: 'time' | 'value';
  merge?: boolean;
  pinTop?: boolean;
  amount?: boolean;
}
/** 送礼名单最低金额的选项（金瓜子，1 元 = 1000）：不限、1、5、10、50、100 元 */
export const GIFTS_MIN_OPTIONS = [0, 1000, 5000, 10_000, 50_000, 100_000];
export const GIFTS_FILTER_DEFAULT: GiftsFilter = { mode: 'all', gifts: [], guard: true, sc: true };
/** 送礼名单一屏显示几条：默认 6 条，最多 GIFTS_MAX_LIMIT 条；名单里最多 GIFTS_KEEP 条（一份一条时是最新的，按金额、按人合计时是最多的）都在循环滚动里 */
export const GIFTS_MAX_DEFAULT = 6;
export const GIFTS_MAX_LIMIT = 20;
export const GIFTS_KEEP = 200;
/** 名单标题最多几个字 */
export const GIFTS_TITLE_MAX = 20;
/** 送礼名单浏览器源的建议宽度、高度（每条约 96，字号大时 1.25 倍；有标题时多出一行） */
export const GIFTS_WIDTH = 640;
export function giftsHeight(max: number, size: 'normal' | 'large', title = false): number {
  const k = size === 'large' ? 1.25 : 1;
  return Math.max(300, Math.ceil((40 + max * 96 * k + (title ? 64 * k : 0)) / 50) * 50);
}
/** 横向跑马灯：一整行放在竖屏画面最上面或最下面，标题在左边，高度只跟字号走 */
export const GIFTS_MARQUEE_WIDTH = 1080;
export const giftsMarqueeHeight = (size: 'normal' | 'large'): number => (size === 'large' ? 190 : 150);
/** 浏览器源建议的宽高（按滚法） */
export function giftsSourceSize(c: { giftsMax: number; giftsSize: 'normal' | 'large'; giftsTitle: string; giftsMotion: GiftsMotion }): { w: number; h: number } {
  if (c.giftsMotion === 'marquee') return { w: GIFTS_MARQUEE_WIDTH, h: giftsMarqueeHeight(c.giftsSize) };
  return { w: GIFTS_WIDTH, h: giftsHeight(c.giftsMax, c.giftsSize, Boolean(c.giftsTitle)) };
}

/** 送礼名单里的一条：礼物（连击合成一条）、上舰、醒目留言 */
export interface GiftListItem {
  id: string;
  ts: number;
  kind: 'gift' | 'guard' | 'sc';
  /** uid 用来合并同一个人的（以前挂上的记录里没有） */
  viewer: { uid?: number; name: string; face?: string; guard: GuardLevel };
  /** 总价值（金瓜子），决定颜色 */
  value: number;
  gift?: { id: number; name: string; count: number; img?: string };
  guard?: { level: 1 | 2 | 3; months: number; op: 'open' | 'renew' };
  /** 醒目留言：内容、金额（元） */
  sc?: { text: string; price: number };
  /** 合并同一个人的同一种礼物时：合了几次 */
  times?: number;
  /** 挂上的记录：原来那一条的编号（自动名单里同一条不再重复显示） */
  ref?: string;
}

/** 按人合计的一条：这段时间一共送了多少 */
export interface GiftRankRow {
  id: string;
  /** 最近一次送的时间 */
  ts: number;
  kind: 'viewer';
  viewer: { uid?: number; name: string; face?: string; guard: GuardLevel };
  /** 总价值（金瓜子） */
  value: number;
  /** 送礼几次（连击合成的算一次）、醒目留言几条 */
  times: number;
  scs: number;
  /** 这段时间上过舰：最高的一档（1 总督） */
  guard?: 1 | 2 | 3;
  /** 送过的最贵的礼物（按单价，金瓜子） */
  top?: { name: string; img?: string; price: number };
}

/** 送礼名单显示的一行 */
export type GiftRow = GiftListItem | GiftRankRow;

/** 这一条在不在送礼名单里显示（自动收到的；只显示挂上的记录时都不显示） */
export function giftListShows(f: GiftsFilter, it: GiftListItem): boolean {
  if (f.mode === 'pinned') return false;
  if (it.kind === 'guard') return f.guard;
  if (it.kind === 'sc') return f.sc;
  if (f.mode === 'all') return it.value >= (f.minGold ?? 0);
  return f.gifts.some((g) => g.id === it.gift?.id);
}

export const giftsView = (f: GiftsFilter): GiftsView => f.view ?? 'item';
export const giftsRange = (f: GiftsFilter): GiftsRange => f.range ?? 'live';
/** 按金额排（按人合计总是按金额） */
const byValue = (f: GiftsFilter) => giftsView(f) === 'viewer' || f.sort === 'value';

/** 同一个人：有 uid 按 uid，没有（以前的记录）按名字 */
const who = (v: { uid?: number; name: string }) => (v.uid ? String(v.uid) : `n:${v.name}`);

/** 一份礼物归到名单里的哪一行：按人合计时每人一行；合并同人同礼物时同一个人的同一种礼物一行；否则一份一行 */
export function giftRowId(f: GiftsFilter, it: GiftListItem): string {
  if (giftsView(f) === 'viewer') return `v:${who(it.viewer)}`;
  if (f.merge && it.kind === 'gift' && it.gift) return `m:${who(it.viewer)}:${it.gift.id}`;
  return it.id;
}

/**
 * 把一份礼物算进名单（rows 会被改）：返回变了的那一行（新加的或者加上之后的）；按筛选不显示时返回 null。
 * 礼物要按时间先后算进来：头像、名字用最新的那一次
 */
export function giftBoardAdd(rows: Map<string, GiftRow>, f: GiftsFilter, it: GiftListItem): GiftRow | null {
  if (!giftListShows(f, it)) return null;
  const id = giftRowId(f, it);
  const old = rows.get(id);
  let row: GiftRow;
  if (giftsView(f) === 'viewer') {
    const o = old?.kind === 'viewer' ? old : undefined;
    const g = it.kind === 'gift' ? it.gift : undefined;
    const price = g ? it.value / (g.count || 1) : 0;
    const top = g && (!o?.top || price >= o.top.price) ? { name: g.name, ...(g.img ? { img: g.img } : {}), price } : o?.top;
    const lv = it.kind === 'guard' ? it.guard?.level : undefined;
    const guard = lv && o?.guard ? (Math.min(lv, o.guard) as 1 | 2 | 3) : (lv ?? o?.guard);
    row = {
      id,
      ts: Math.max(it.ts, o?.ts ?? 0),
      kind: 'viewer',
      viewer: !o || it.ts >= o.ts ? it.viewer : o.viewer,
      value: (o?.value ?? 0) + it.value,
      times: (o?.times ?? 0) + (it.kind === 'gift' ? 1 : 0),
      scs: (o?.scs ?? 0) + (it.kind === 'sc' ? 1 : 0),
      ...(guard ? { guard } : {}),
      ...(top ? { top } : {}),
    };
  } else if (id !== it.id && old?.kind === 'gift' && old.gift && it.kind === 'gift' && it.gift) {
    const newer = it.ts >= old.ts;
    row = {
      ...(newer ? it : old),
      id,
      ts: Math.max(it.ts, old.ts),
      value: old.value + it.value,
      gift: { ...it.gift, count: old.gift.count + it.gift.count, ...(it.gift.img || old.gift.img ? { img: (newer ? it.gift.img : old.gift.img) || it.gift.img || old.gift.img } : {}) },
      times: (old.times ?? 1) + 1,
    };
  } else row = id === it.id ? it : { ...it, id, times: 1 };
  rows.set(id, row);
  return row;
}

/** 名单的先后：按时间时旧的在上；按金额、按人合计时多的在上，一样多时先到的在上 */
export function giftRowCompare(f: GiftsFilter): (a: GiftRow, b: GiftRow) => number {
  const tie = (a: GiftRow, b: GiftRow) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return byValue(f) ? (a, b) => b.value - a.value || tie(a, b) : tie;
}

/** 排好顺序，最多 keep 条：按时间时留最新的，按金额、按人合计时留最多的 */
export function giftRowsSorted(rows: Iterable<GiftRow>, f: GiftsFilter, keep = GIFTS_KEEP): GiftRow[] {
  const all = [...rows].sort(giftRowCompare(f));
  if (all.length <= keep) return all;
  return byValue(f) ? all.slice(0, keep) : all.slice(-keep);
}

/** 名单行数超过 keep 时去掉排在外面的（rows 会被改）；返回去掉的行号 */
export function giftRowsTrim(rows: Map<string, GiftRow>, f: GiftsFilter, keep = GIFTS_KEEP): string[] {
  if (rows.size <= keep) return [];
  const stay = new Set(giftRowsSorted(rows.values(), f, keep).map((r) => r.id));
  const gone = [...rows.keys()].filter((id) => !stay.has(id));
  for (const id of gone) rows.delete(id);
  return gone;
}
