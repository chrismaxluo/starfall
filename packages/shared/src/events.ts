// 标准事件：B 站各种原始消息解析后统一成这个格式，后续的合并、匹配、判断只认它。
// 字段来源见 docs/bili-protocol.md。

/** 大航海等级：0 无，1 总督，2 提督，3 舰长（与 B 站一致） */
export type GuardLevel = 0 | 1 | 2 | 3;

export const GUARD_NAMES: Record<Exclude<GuardLevel, 0>, string> = { 1: '总督', 2: '提督', 3: '舰长' };

/** 粉丝牌。颜色直接使用 B 站下发的值（熄灭的牌子是灰色，不需要自己计算） */
export interface Medal {
  name: string;
  level: number;
  /** 牌子所属主播的 UID，用来判断是不是本直播间的牌子 */
  anchorUid: number;
  colors?: {
    bg: string;
    level: string;
    border: string;
    text: string;
  };
}

export interface Viewer {
  uid: number;
  name: string;
  face?: string;
  /** 本直播间的大航海等级 */
  guard: GuardLevel;
  /** 本直播间房管 */
  isMod: boolean;
  /** 观众佩戴的粉丝牌（不一定属于本直播间） */
  medal?: Medal;
  /** 神秘人 */
  mystery: boolean;
}

interface EventBase {
  /** 事件编号，用于去重和记录 */
  id: string;
  /** 事件时间（毫秒时间戳） */
  ts: number;
}

export interface EnterEvent extends EventBase {
  kind: 'enter';
  viewer: Viewer;
}

export interface DanmuEvent extends EventBase {
  kind: 'danmu';
  viewer: Viewer;
  text: string;
}

export interface GiftEvent extends EventBase {
  kind: 'gift';
  viewer: Viewer;
  giftId: number;
  giftName: string;
  /** 单价，单位：金瓜子 */
  unitPrice: number;
  count: number;
  /** 付费礼物（gold）为 true，免费礼物（silver）为 false */
  paid: boolean;
  /** 连击批次号，用于合并连击 */
  comboKey?: string;
}

export interface GuardEvent extends EventBase {
  kind: 'guard';
  viewer: Viewer;
  level: Exclude<GuardLevel, 0>;
  months: number;
  op: 'open' | 'renew';
}

export interface LiveEvent extends EventBase {
  kind: 'live';
  live: boolean;
}

export type StdEvent = EnterEvent | DanmuEvent | GiftEvent | GuardEvent | LiveEvent;

/** 会触发特效的事件类型 */
export type TriggerKind = 'enter' | 'danmu' | 'gift' | 'guard';

/** 判断粉丝牌是否属于本直播间 */
export function isOwnMedal(viewer: Viewer, anchorUid: number): boolean {
  return viewer.medal !== undefined && viewer.medal.anchorUid === anchorUid && viewer.medal.level > 0;
}
