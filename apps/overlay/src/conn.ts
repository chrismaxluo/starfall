// 连接服务端：断线自动重连（1 秒起，最长 10 秒）；地址失效（密钥错误）时不再重连。
// 只引入 overlay 子路径：主入口会带上 Zod，特效页用不到
import { OVERLAY_CLOSE } from '@starfall/shared/overlay';
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

  const open = () => {
    if (closed) return;
    const s = new WebSocket(url);
    ws = s;
    s.onopen = () => {
      attempt = 0;
      h.onState?.(true);
    };
    s.onmessage = (e) => {
      try {
        h.onMessage(JSON.parse(String(e.data)) as ServerToOverlay);
      } catch (err) {
        console.error('[星临] 处理消息出错', err);
      }
    };
    s.onclose = (e) => {
      ws = null;
      h.onState?.(false);
      if (e.code === OVERLAY_CLOSE.badKey) {
        closed = true;
        h.onFatal();
        return;
      }
      const delay = Math.min(10_000, 1000 * 2 ** attempt++) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(open, delay);
    };
  };
  open();

  return {
    send(m) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
