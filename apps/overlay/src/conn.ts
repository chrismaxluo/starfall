// 连接服务端：断线自动重连（1 秒起，最长 10 秒）；地址失效（密钥错误）时不再重连。
// 网络中途断掉时浏览器不一定会触发关闭事件（直播软件、代理、路由器都可能悄悄丢掉连接），
// 所以服务端定时发心跳，这边太久没收到任何消息就主动重连；同时定时报平安，让服务端能发现页面卡死。
// 只引入 overlay 子路径：主入口会带上 Zod，特效页用不到
import { OVERLAY_CLOSE, OVERLAY_TIMING } from '@starfall/shared/overlay';
import type { OverlayToServer, ServerToOverlay } from '@starfall/shared/overlay';

export interface Conn {
  send(m: OverlayToServer): void;
  close(): void;
}

export function connect(url: string, h: { onMessage: (m: ServerToOverlay) => void; onFatal: () => void; onState?: (online: boolean) => void }): Conn {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastMsg = 0;

  const send = (m: OverlayToServer) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  const retry = () => {
    if (closed || timer) return;
    const delay = Math.min(10_000, 1000 * 2 ** attempt++) * (0.8 + Math.random() * 0.4);
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  };

  /** 丢掉当前连接（不等它的关闭事件），马上开始重连 */
  const drop = () => {
    const s = ws;
    if (!s) return;
    ws = null;
    s.onopen = s.onmessage = s.onclose = null;
    s.close();
    h.onState?.(false);
    retry();
  };

  const open = () => {
    if (closed) return;
    const s = new WebSocket(url);
    ws = s;
    lastMsg = Date.now();
    s.onopen = () => {
      attempt = 0;
      lastMsg = Date.now();
      h.onState?.(true);
    };
    s.onmessage = (e) => {
      lastMsg = Date.now();
      try {
        h.onMessage(JSON.parse(String(e.data)) as ServerToOverlay);
      } catch (err) {
        console.error('[星临] 处理消息出错', err);
      }
    };
    s.onclose = (e) => {
      if (ws !== s) return;
      ws = null;
      h.onState?.(false);
      if (e.code === OVERLAY_CLOSE.badKey) {
        closed = true;
        h.onFatal();
        return;
      }
      retry();
    };
  };
  open();

  // 连接中或已连上，但太久没有任何消息：认为已经断了
  const watchdog = setInterval(() => {
    if (ws && Date.now() - lastMsg > OVERLAY_TIMING.deadMs) {
      console.warn('[星临] 长时间没有收到服务端消息，重新连接');
      drop();
    }
  }, 5000);
  const alive = setInterval(() => send({ type: 'alive' }), OVERLAY_TIMING.aliveMs);

  // 页面重新可见、网络恢复时，如果正在等待重连，立即重连
  const wake = () => {
    if (closed || ws || !timer) return;
    clearTimeout(timer);
    timer = null;
    attempt = 0;
    open();
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
  addEventListener('online', wake);

  return {
    send,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(watchdog);
      clearInterval(alive);
      ws?.close();
    },
  };
}
