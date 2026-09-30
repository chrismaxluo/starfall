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
  /** 荣耀等级（B 站消息里的字段叫 wealth）：没有或不知道时不填 */
  honor?: number;
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
  /** 来源消息：interact 为 INTERACT_WORD_V2（信息完整），entry_effect 为 ENTRY_EFFECT（没有粉丝牌） */
  source: 'interact' | 'entry_effect';
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
  /** B 站官方礼物图标（消息里自带的静态图） */
  icon?: string;
}

export interface GuardEvent extends EventBase {
  kind: 'guard';
  viewer: Viewer;
  level: Exclude<GuardLevel, 0>;
  months: number;
  /** 开通 / 续费（按 B 站的提示文案判断） */
  op: 'open' | 'renew';
  /** 来源：toast 为 USER_TOAST_MSG(_V2)（信息完整），guard_buy 为 GUARD_BUY（没有开通 / 续费信息） */
  source: 'toast' | 'guard_buy';
  /** 同一次购买的几条消息共用的编号（B 站的支付流水号），用于去重 */
  dedupeKey?: string;
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
