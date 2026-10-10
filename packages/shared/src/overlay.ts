// 服务端与特效页之间的消息（方案设计 9.3）。特效页和服务端共用这些类型。
import type { GuardLevel, TriggerKind } from './events.ts';
import type { Position } from './rules.ts';
import type { MusicNotice, MusicState } from './music.ts';

export * from './music.ts';

/**
 * B 站的大航海头像框（200×200 透明 PNG，1 总督、2 提督、3 舰长）。版权归 B 站：只在运行时从 B 站加载，不打包；
 * 地址来自醒目留言的 user_info.face_frame（B 站换设计后地址会变，加载失败时只显示头像）
 */
export const GUARD_FRAMES: Record<1 | 2 | 3, string> = {
  1: 'https://i0.hdslb.com/bfs/live/39164ebfdd39db3d284b1221765e7e57f5a49958.png',
  2: 'https://i0.hdslb.com/bfs/live/09937c3beb0608e267a50ac3c7125c3f2d709098.png',
  3: 'https://i0.hdslb.com/bfs/live/80f732943cc3367029df65e267960d56736a82ee.png',
};
/** B 站的大航海船锚图标（200×200，1 总督、2 提督、3 舰长）：版权归 B 站，只在运行时加载 */
const BADGE_BASE = 'https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/';
export const GUARD_BADGES: Record<1 | 2 | 3, string> = { 1: `${BADGE_BASE}governor-DpDXKEdA.png`, 2: `${BADGE_BASE}supervisor-u43ElIjU.png`, 3: `${BADGE_BASE}captain-Bjw5Byb5.png` };
/** 头像框画成头像的多少倍（框中间的圆洞直径约为图片的 72%） */
export const GUARD_FRAME_SCALE = 1.4;

/** 上下羽化宽度上限（素材高度的百分比）；特效页也要用，所以放在这里 */
export const FEATHER_MAX = 40;

export interface OverlayConfig {
  outputId: number;
  name: string;
  app: 'livehime' | 'obs';
  orient: 'portrait' | 'landscape';
  width: number;
  height: number;
  /** 安全区，单位：画布高度 / 宽度的百分比 */
  safeTop: number;
  safeBottom: number;
  marginX: number;
  /** 特效整体缩放，百分比 */
  scale: number;
  liteMode: 'auto' | 'on' | 'off';
  /** 弹幕列表：开关、对齐（靠左 / 靠右）、字号、粉丝牌（只显示本直播间的 / 戴什么显示什么） */
  chatEnabled: boolean;
  chatSide: 'left' | 'right';
  chatSize: 'normal' | 'large';
  chatMedal: 'own' | 'all';
  /** 弹幕列表最多显示几条 */
  chatMax: number;
  /** 弹幕列表每条显示多少秒后自动消失；0 为一直显示（只被新弹幕顶走） */
  chatFadeSec: number;
  /** 送礼名单：开关、对齐（靠左 / 靠右）、字号、最多显示几条、显示哪些 */
  giftsEnabled: boolean;
  giftsSide: 'left' | 'right';
  giftsSize: 'normal' | 'large';
  giftsMax: number;
  /** 循环滚动的速度 */
  giftsSpeed: GiftsSpeed;
  giftsFilter: GiftsFilter;
}

/**
 * 送礼名单滚动速度：每秒多少像素（按 1080 宽设计的尺寸）；慢约 5 秒一条、中约 3 秒、快约 2 秒。
 * off 为不滚动：固定挂着，放不下时只留最新的几条（配合「只显示选中的礼物」把特定礼物挂在画面上）
 */
export type GiftsSpeed = 'off' | 'slow' | 'normal' | 'fast';
export const GIFTS_SPEED_PX: Record<GiftsSpeed, number> = { off: 0, slow: 20, normal: 32, fast: 50 };

/**
 * 送礼名单显示哪些：all 为所有付费礼物；only 为只显示 gifts 里勾选的礼物（按礼物编号，名字只用来在后台显示）；
 * pinned 为只显示后台挂上的记录（谁送的哪一次，可以是以前场次的），本场新收到的不进来。
 * 上舰、醒目留言单独勾选，all、only 两种方式看这两项。
 * minGold：all 方式下礼物的最低金额（金瓜子，按连击合起来的总价值算；没有或 0 为不限），只管礼物，不管上舰、醒目留言
 */
export interface GiftsFilter {
  mode: 'all' | 'only' | 'pinned';
  gifts: Array<{ id: number; name: string }>;
  guard: boolean;
  sc: boolean;
  minGold?: number;
}
/** 送礼名单最低金额的选项（金瓜子，1 元 = 1000）：不限、1、5、10、50、100 元 */
export const GIFTS_MIN_OPTIONS = [0, 1000, 5000, 10_000, 50_000, 100_000];
export const GIFTS_FILTER_DEFAULT: GiftsFilter = { mode: 'all', gifts: [], guard: true, sc: true };
/** 送礼名单一屏显示几条：默认 6 条，最多 GIFTS_MAX_LIMIT 条；本场最近 GIFTS_KEEP 条都在循环滚动里（服务端也记这么多） */
export const GIFTS_MAX_DEFAULT = 6;
export const GIFTS_MAX_LIMIT = 20;
export const GIFTS_KEEP = 200;
/** 送礼名单浏览器源的建议宽度、高度（每条约 96，字号大时 1.25 倍） */
export const GIFTS_WIDTH = 640;
export function giftsHeight(max: number, size: 'normal' | 'large'): number {
  const row = size === 'large' ? 120 : 96;
  return Math.max(300, Math.ceil((40 + max * row) / 50) * 50);
}

/** 送礼名单里的一条：礼物（连击合成一条）、上舰、醒目留言 */
export interface GiftListItem {
  id: string;
  ts: number;
  kind: 'gift' | 'guard' | 'sc';
  viewer: { name: string; face?: string; guard: GuardLevel };
  /** 总价值（金瓜子），决定颜色 */
  value: number;
  gift?: { id: number; name: string; count: number; img?: string };
  guard?: { level: 1 | 2 | 3; months: number; op: 'open' | 'renew' };
  /** 醒目留言：内容、金额（元） */
  sc?: { text: string; price: number };
}

/** 这一条在不在送礼名单里显示（本场收到的；只显示挂上的记录时都不显示） */
export function giftListShows(f: GiftsFilter, it: GiftListItem): boolean {
  if (f.mode === 'pinned') return false;
  if (it.kind === 'guard') return f.guard;
  if (it.kind === 'sc') return f.sc;
  if (f.mode === 'all') return it.value >= (f.minGold ?? 0);
  return f.gifts.some((g) => g.id === it.gift?.id);
}

/** 弹幕列表条数：默认 8 条，最多能设 CHAT_MAX_LIMIT 条（服务端也最多记住这么多条） */
export const CHAT_MAX_DEFAULT = 8;
export const CHAT_MAX_LIMIT = 20;
/** 弹幕自动消失的时间：3 – 600 秒（0 为一直显示）；后台的常用选项 */
export const CHAT_FADE_MIN = 3;
export const CHAT_FADE_MAX = 600;
export const CHAT_FADE_OPTIONS = [5, 10, 15, 30, 60];
/** 弹幕列表浏览器源的建议宽度 */
export const CHAT_WIDTH = 600;

/** 弹幕列表浏览器源的建议高度：普通长度的弹幕每条约 110（字号大时 1.2 倍），上下留边，按 50 取整，至少 300 */
export function chatHeight(max: number, size: 'normal' | 'large'): number {
  const row = size === 'large' ? 132 : 110;
  return Math.max(300, Math.ceil((32 + max * row - 14) / 50) * 50);
}

/** 弹幕列表里的一条弹幕 */
export interface ChatItem {
  id: string;
  ts: number;
  viewer: {
    uid: number;
    name: string;
    face?: string;
    guard: GuardLevel;
    isMod: boolean;
    /** 主播本人 */
    anchor: boolean;
    /** own：本直播间的粉丝牌（设置成「只显示本直播间的」时只显示这种） */
    medal?: { name: string; level: number; own: boolean; colors?: { bg: string; level: string; border: string; text: string } };
    honor?: { level: number; url?: string };
  };
  text: string;
  /** 文字里的小表情：写法 → 图片地址 */
  emots?: Record<string, string>;
  /** 表情包：显示这张图，不显示文字 */
  sticker?: { url: string; width: number; height: number };
}

export type PlayVisual =
  | { type: 'builtin_style'; style: string }
  | { type: 'asset'; url: string; ext: string; kind: 'video' | 'image' | 'fx'; width: number | null; height: number | null; hasAlpha: boolean; dyn?: SvgaDyn[] };

/** SVGA 图层替换：图片给 url（空字符串 = 这一层藏起来），文字给 text（头像的 text 是昵称，加载不到头像时画首字）；w、h 是原图大小，按它画 */
export interface SvgaDyn {
  key: string;
  role: 'avatar' | 'avatarSquare' | 'frame' | 'badge' | 'honor' | 'name' | 'welcome';
  w: number;
  h: number;
  url?: string;
  text?: string;
}

/** 一次播放：入队时生成的快照，播放过程中修改素材不影响它 */
export interface PlayItem {
  id: string;
  kind: TriggerKind;
  effect: {
    id: number;
    name: string;
    visual: PlayVisual;
    showText: boolean;
    position: Position;
    durationMs: number;
    fadeIn: boolean;
    fadeOut: boolean;
    fadeInMs: number;
    fadeOutMs: number;
    /** 在位置的基础上挪动（画面宽、高的百分比） */
    offsetX: number;
    offsetY: number;
    /** 大小：自动大小的百分比 */
    sizePct: number;
    /** 上下羽化宽度（素材高度的百分比，0 为不羽化）：已经按全局设置算好 */
    featherPct: number;
    /** 大航海观众的头像套上 B 站头像框 */
    guardFrame: boolean;
    /** 名字旁边显示荣耀等级勋章 */
    honorBadge: boolean;
    sound: { url: string } | null;
    volume: number;
  };
  /** 替换好变量的欢迎语（纯文本，特效页不能当作 HTML 显示） */
  text: string;
  viewer: {
    name: string;
    face?: string;
    guard: GuardLevel;
    isMod: boolean;
    medal?: { name: string; level: number; colors?: { bg: string; level: string; border: string; text: string } };
    /** 荣耀等级；url 是这一级的勋章图（B 站的图，查不到时没有） */
    honor?: { level: number; url?: string };
  };
  /** 上舰事件：开通还是续费（宫廷特效的印章用） */
  guardOp?: 'open' | 'renew';
  /** 礼物事件：名称、数量（连击合并后的）、礼物图（从礼物面板查，设置里选了动图时是动图，查不到时没有）、总价值（金瓜子）；fx 是 B站全屏动画（「B站动画」样式用） */
  gift?: { name: string; count: number; img?: string; value?: number; fx?: GiftFx };
  /** 后台"测试播放"发出的 */
  test?: boolean;
  /** 素材快捷播放发出的 */
  quick?: boolean;
}

/** 特效页的版本：构建出的入口脚本名（带哈希），重新构建后会变 */
export const OVERLAY_BUILD_RE = /index-[\w-]+\.js/;

export type ServerToOverlay =
  /** build：服务端现在的特效页版本；和页面自己的不一样时，页面会在空闲时自动刷新 */
  | { type: 'hello'; config: OverlayConfig; preload: string[]; build: string | null; chat?: ChatItem[]; gifts?: GiftListItem[]; pins?: GiftListItem[] }
  /** 特效页重新构建了（不用重启服务） */
  | { type: 'version'; build: string }
  | { type: 'config'; config: OverlayConfig }
  | { type: 'preload'; preload: string[] }
  | { type: 'play'; item: PlayItem }
  | { type: 'stop' }
  /** 弹幕列表：新的一条弹幕 */
  | { type: 'chat'; item: ChatItem }
  /** 弹幕列表：换了直播间，清空 */
  | { type: 'chat_clear' }
  /** 送礼名单：新的一条 */
  | { type: 'gift_item'; item: GiftListItem }
  /** 送礼名单：新开了一场直播或换了直播间，清空 */
  | { type: 'gifts_clear' }
  /** 送礼名单：挂上的记录变了（整份发过来，按顺序） */
  | { type: 'gift_pins'; items: GiftListItem[] }
  /** 点歌窗口：全部状态（有变化就整份发）；player 为 true 的那个窗口负责出声音，别的只显示 */
  | { type: 'music'; state: MusicState; player: boolean }
  /** 点歌窗口（出声音的那个）：有带声音的特效在播，音乐调小 / 恢复 */
  | { type: 'music_duck'; on: boolean; pct: number }
  /** 点歌窗口：点歌结果的提示 */
  | { type: 'music_notice'; notice: MusicNotice }
  /** 心跳：特效页据此判断连接是否还活着（浏览器里收不到协议层的 ping） */
  | { type: 'ping' };

export type OverlayToServer =
  | { type: 'report'; env: Record<string, string | number | boolean | null> }
  | { type: 'started'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'error'; id?: string; message: string }
  /** 特效页定时报平安：页面卡死时服务端能发现 */
  | { type: 'alive' }
  /** 点歌窗口（出声音的那个）：开始出声了、播放到哪里（每几秒报一次）、放完了、放不了 */
  | { type: 'music_started'; id: number; load: number }
  | { type: 'music_pos'; id: number; pos: number }
  | { type: 'music_ended'; id: number }
  | { type: 'music_error'; id: number; load: number; message: string };

/** 连接保活的时间（毫秒） */
export const OVERLAY_TIMING = {
  /** 服务端给特效页发心跳的间隔 */
  pingMs: 15_000,
  /** 特效页超过这么久没收到任何消息，就认为连接已断，主动重连 */
  deadMs: 45_000,
  /** 特效页报平安的间隔 */
  aliveMs: 20_000,
  /** 服务端超过这么久没收到报平安，就认为页面卡死并断开（只对报过平安的页面生效） */
  aliveTimeoutMs: 90_000,
};

/** 特效页被服务端断开的原因（WebSocket 关闭码） */
export const OVERLAY_CLOSE = {
  /** 输出不存在或密钥不对（包括重置了密钥、删除了输出）：特效页不再重连 */
  badKey: 4003,
} as const;

/** 「B站动画」样式：有 B站全屏动画的礼物播官方动画，没有时按价值显示晶耀（不低于 BIG_GIFT_GOLD）或晶礼 */
export const BILI_GIFT_STYLE = 'bili-gift';
/** 礼物「大额」的分界（金瓜子）：100 元 */
export const BIG_GIFT_GOLD = 100_000;

/** B站礼物全屏动画：一个 MP4 里一块是画面、一块是透明度（x, y, 宽, 高，按视频像素） */
export interface GiftFx {
  src: string;
  w: number;
  h: number;
  videoW: number;
  videoH: number;
  rgb: [number, number, number, number];
  alpha: [number, number, number, number];
}
