// 管理后台的实时连接：事件、队列、连接状态、特效页上下线
import { refreshStatus, state } from './store.ts';
import type { EventDto, LiveStatus, OverlayInfo, PlayStatus, QueueSnapshot, StatusSnapshot } from './types.ts';

type Msg =
  | { type: 'hello'; status: StatusSnapshot; queue: QueueSnapshot; overlays: OverlayInfo[] }
  | { type: 'status'; status: { live: LiveStatus; paused: boolean; overlays: number } }
  | { type: 'queue'; queue: QueueSnapshot; paused: boolean }
  | { type: 'overlays'; overlays: OverlayInfo[] }
  | { type: 'event'; event: EventDto }
  | { type: 'event_status'; id: number; status: PlayStatus };

const eventListeners = new Set<(e: EventDto) => void>();
const statusListeners = new Set<(id: number, s: PlayStatus) => void>();

/** 订阅新事件（事件记录页、总览统计） */
export function onLiveEvent(fn: (e: EventDto) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export function onLiveEventStatus(fn: (id: number, s: PlayStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

let ws: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let stopped = true;

function handle(m: Msg): void {
  switch (m.type) {
    case 'hello':
      state.status = m.status;
      state.queue = m.queue;
      state.overlays = m.overlays;
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
      if (state.status) state.status.overlays = m.overlays.length;
      break;
    case 'event':
      state.feed.unshift(m.event);
      if (state.feed.length > 50) state.feed.length = 50;
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
  open();
}

export function stopLive(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  ws?.close();
  ws = null;
}
