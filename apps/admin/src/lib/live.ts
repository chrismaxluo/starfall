// 管理后台的实时连接：事件、队列、连接状态、特效页上下线
import { setTimeZone } from './format.ts';
import { CHAT_MAX_LIMIT, GIFTS_KEEP, OVERLAY_BUILD_RE } from '@starfall/shared/overlay';
import type { ChatItem, GiftListItem } from '@starfall/shared/overlay';
import { FEED_KEEP, isFxLive, refreshEffects, refreshFeed, refreshOutputs, refreshQuick, refreshRules, refreshSettings, refreshStatus, state, ui } from './store.ts';
import type { EventDto, LiveStatus, OverlayInfo, PlayStatus, QueueSnapshot, RoomInfo, StatusSnapshot } from './types.ts';

type Msg =
  | { type: 'hello'; status: StatusSnapshot; queue: QueueSnapshot; overlays: OverlayInfo[]; roomInfo: RoomInfo | null; build?: string | null; chat?: ChatItem[]; gifts?: GiftListItem[]; pins?: GiftListItem[] }
  /** 弹幕列表：新的一条、换直播间清空 */
  | { type: 'chat'; item: ChatItem }
  | { type: 'chat_clear' }
  /** 送礼名单：新的一条、新开一场清空 */
  | { type: 'gift_item'; item: GiftListItem }
  | { type: 'gifts_clear' }
  | { type: 'gift_pins'; items: GiftListItem[] }
  /** 服务端的后台重新构建了 */
  | { type: 'version'; build: string }
  | { type: 'room_info'; info: RoomInfo | null }
  | { type: 'status'; status: { live: LiveStatus; paused: boolean; overlays: number } }
  | { type: 'queue'; queue: QueueSnapshot; paused: boolean }
  | { type: 'overlays'; overlays: OverlayInfo[] }
  | { type: 'event'; event: EventDto }
  | { type: 'event_status'; id: number; status: PlayStatus }
  /** 别的设备（或这台）改了规则、素材、设置、输出 */
  | { type: 'changed'; what: 'rules' | 'library' | 'settings' | 'outputs' | 'quickplay' | 'all' };

const eventListeners = new Set<(e: EventDto) => void>();
const statusListeners = new Set<(id: number, s: PlayStatus) => void>();
const resyncListeners = new Set<() => void>();
const chatListeners = new Set<(item: ChatItem | null) => void>();

/** 订阅新事件（事件记录页、总览统计） */
export function onLiveEvent(fn: (e: EventDto) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export function onLiveEventStatus(fn: (id: number, s: PlayStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** 订阅新弹幕（弹幕列表预览）；null 表示清空 */
const giftListeners = new Set<(item: GiftListItem | null) => void>();
/** 送礼名单新的一条（null 为清空） */
export function onGiftItem(fn: (item: GiftListItem | null) => void): () => void {
  giftListeners.add(fn);
  return () => giftListeners.delete(fn);
}

export function onChat(fn: (item: ChatItem | null) => void): () => void {
  chatListeners.add(fn);
  return () => chatListeners.delete(fn);
}

/** 断线重连后（可能漏了事件）：事件记录页等重新加载 */
export function onResync(fn: () => void): () => void {
  resyncListeners.add(fn);
  return () => resyncListeners.delete(fn);
}

/** 这个页面的版本（入口脚本名，和特效页用同样的规则）；开发模式下没有，不提示 */
const MY_BUILD = Array.from(document.scripts).map((s) => s.src.match(OVERLAY_BUILD_RE)?.[0]).find(Boolean) ?? null;
function checkBuild(b: string | null | undefined): void {
  if (MY_BUILD && b && b !== MY_BUILD) ui.newVersion = b;
}

let ws: WebSocket | null = null;
let hellos = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let stopped = true;

function handle(m: Msg): void {
  switch (m.type) {
    case 'hello':
      checkBuild(m.build);
      state.status = m.status;
      setTimeZone(m.status.timeZone);
      state.queue = m.queue;
      state.overlays = m.overlays;
      state.roomInfo = m.roomInfo;
      state.chat = m.chat ?? [];
      state.gifts = m.gifts ?? [];
      state.giftPins = m.pins ?? [];
      // 重连：断开期间的事件和别处的修改都补回来
      if (hellos++ > 0) {
        void Promise.all([refreshFeed(), refreshRules(), refreshEffects(), refreshSettings(), refreshOutputs(), refreshQuick()]).catch(() => undefined);
        for (const fn of resyncListeners) fn();
      }
      break;
    case 'changed': {
      const jobs = { rules: [refreshRules], library: [refreshEffects, refreshRules, refreshQuick], settings: [refreshSettings, refreshStatus], outputs: [refreshOutputs], quickplay: [refreshQuick], all: [refreshRules, refreshEffects, refreshSettings, refreshOutputs, refreshQuick] }[m.what] ?? [];
      void Promise.all(jobs.map((f) => f())).catch(() => undefined);
      break;
    }
    case 'version':
      checkBuild(m.build);
      break;
    case 'room_info':
      // 换了直播间：实时动态也换成新直播间的
      if (!m.info || (state.roomInfo && m.info.roomId !== state.roomInfo.roomId)) void refreshFeed();
      state.roomInfo = m.info;
      break;
    case 'status':
      if (state.status) Object.assign(state.status, { live: m.status.live, paused: m.status.paused, overlays: m.status.overlays });
      break;
    case 'queue':
      state.queue = m.queue;
      if (state.status) {
        state.status.paused = m.paused;
        state.status.queue = { playing: m.queue.playing !== null, size: m.queue.items.length };
      }
      if (state.settings) state.settings.paused = m.paused;
      break;
    case 'overlays':
      state.overlays = m.overlays;
      if (state.status) state.status.overlays = m.overlays.filter(isFxLive).length;
      break;
    case 'chat':
      state.chat = [...state.chat, m.item].slice(-CHAT_MAX_LIMIT);
      for (const fn of chatListeners) fn(m.item);
      break;
    case 'chat_clear':
      state.chat = [];
      for (const fn of chatListeners) fn(null);
      break;
    case 'gift_item':
      state.gifts = [...state.gifts, m.item].slice(-GIFTS_KEEP);
      for (const fn of giftListeners) fn(m.item);
      break;
    case 'gifts_clear':
      state.gifts = [];
      for (const fn of giftListeners) fn(null);
      break;
    case 'gift_pins':
      state.giftPins = m.items;
      break;
    case 'event':
      state.feed.unshift(m.event);
      if (state.feed.length > FEED_KEEP) state.feed.length = FEED_KEEP;
      for (const fn of eventListeners) fn(m.event);
      break;
    case 'event_status': {
      const e = state.feed.find((x) => x.id === m.id);
      if (e) e.status = m.status;
      for (const fn of statusListeners) fn(m.id, m.status);
      break;
    }
  }
}

function open(): void {
  if (stopped) return;
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
  ws = s;
  s.onopen = () => {
    attempt = 0;
    state.wsOnline = true;
  };
  s.onmessage = (e) => {
    try {
      handle(JSON.parse(String(e.data)) as Msg);
    } catch (err) {
      console.error('[星临] 实时消息处理出错', err);
    }
  };
  s.onclose = (e) => {
    // 已经被新连接取代（退出后很快又登录）：旧连接的关闭不影响新连接
    if (ws !== s) return;
    ws = null;
    state.wsOnline = false;
    if (stopped) return;
    // 4401：会话失效，交给接口的 401 处理（跳回登录）
    if (e.code === 4401) {
      void refreshStatus().catch(() => undefined);
      return;
    }
    timer = setTimeout(open, Math.min(10_000, 1000 * 2 ** attempt++));
  };
}

export function startLive(): void {
  if (!stopped) return;
  stopped = false;
  if (timer) clearTimeout(timer);
  timer = null;
  open();
}

export function stopLive(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  const s = ws;
  ws = null;
  hellos = 0;
  s?.close();
}
