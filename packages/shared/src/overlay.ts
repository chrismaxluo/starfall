// 服务端与特效页之间的消息（方案设计 9.3）。特效页和服务端共用这些类型。
import type { GuardLevel, TriggerKind } from './events.ts';
import type { Position } from './rules.ts';

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
  /** 礼物事件：礼物名称、数量（连击合并后的）、礼物图（从直播间礼物面板查，查不到时没有） */
  gift?: { name: string; count: number; img?: string };
  /** 后台"测试播放"发出的 */
  test?: boolean;
}

/** 特效页的版本：构建出的入口脚本名（带哈希），重新构建后会变 */
export const OVERLAY_BUILD_RE = /index-[\w-]+\.js/;

export type ServerToOverlay =
  /** build：服务端现在的特效页版本；和页面自己的不一样时，页面会在空闲时自动刷新 */
  | { type: 'hello'; config: OverlayConfig; preload: string[]; build: string | null; chat?: ChatItem[] }
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
  /** 心跳：特效页据此判断连接是否还活着（浏览器里收不到协议层的 ping） */
  | { type: 'ping' };

export type OverlayToServer =
  | { type: 'report'; env: Record<string, string | number | boolean | null> }
  | { type: 'started'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'error'; id?: string; message: string }
  /** 特效页定时报平安：页面卡死时服务端能发现 */
  | { type: 'alive' };

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
