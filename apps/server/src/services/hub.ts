// 在线的特效页和管理后台（方案设计 9.3）。这里不关心 WebSocket 细节，只管"发给谁"。
import { OVERLAY_CLOSE } from '@starfall/shared';
import type { OverlayConfig, ServerToOverlay } from '@starfall/shared';
import type { OutputRow } from './outputs.ts';

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface OverlayClient {
  sock: Sock;
  outputId: number;
  since: number;
  /** 特效页上报的运行环境（直播软件、内核版本、能力检测） */
  env: Record<string, unknown> | null;
  lastError: string | null;
  /** 已发出、特效页还没回"开始播放"的特效：播放编号 → 发出时间、说明 */
  pending: Map<string, { at: number; label: string }>;
}

/** 特效页收到播放指令后多久内应该回"开始播放" */
export const PLAY_ACK_MS = 5000;

export interface OverlayInfo {
  outputId: number;
  since: number;
  env: Record<string, unknown> | null;
  lastError: string | null;
}

export const overlayConfig = (o: OutputRow): OverlayConfig => ({
  outputId: o.id,
  name: o.name,
  app: o.app,
  orient: o.orient,
  width: o.width,
  height: o.height,
  safeTop: o.safeTop,
  safeBottom: o.safeBottom,
  marginX: o.marginX,
  scale: o.scale,
  liteMode: o.liteMode,
});

export class Hub {
  private readonly overlays = new Set<OverlayClient>();
  private readonly admins = new Set<Sock>();
  private readonly overlayListeners = new Set<() => void>();

  /** 特效页上下线、上报环境时通知（管理后台显示在线状态） */
  onOverlaysChange(fn: () => void): () => void {
    this.overlayListeners.add(fn);
    return () => this.overlayListeners.delete(fn);
  }

  private overlaysChanged(): void {
    for (const fn of this.overlayListeners) fn();
  }

  addOverlay(sock: Sock, output: OutputRow, preload: string[], now = Date.now()): OverlayClient {
    const c: OverlayClient = { sock, outputId: output.id, since: now, env: null, lastError: null, pending: new Map() };
    this.overlays.add(c);
    send(sock, { type: 'hello', config: overlayConfig(output), preload });
    this.overlaysChanged();
    return c;
  }

  removeOverlay(c: OverlayClient): void {
    if (this.overlays.delete(c)) this.overlaysChanged();
  }

  report(c: OverlayClient, patch: Partial<Pick<OverlayClient, 'env' | 'lastError'>>): void {
    Object.assign(c, patch);
    this.overlaysChanged();
  }

  overlayCount(): number {
    return this.overlays.size;
  }

  overlayList(): OverlayInfo[] {
    return [...this.overlays].map((c) => ({ outputId: c.outputId, since: c.since, env: c.env, lastError: c.lastError }));
  }

  /** 发给所有特效页（所有输出同步播放） */
  toOverlays(msg: ServerToOverlay, now = Date.now()): void {
    for (const c of this.overlays) {
      send(c.sock, msg);
      if (msg.type === 'play') c.pending.set(msg.item.id, { at: now, label: `${msg.item.effect.name} · ${msg.item.viewer.name}` });
    }
  }

  /** 特效页回了"开始播放"：返回这次播放的说明和延迟；不是等待中的播放时返回 null */
  playStarted(c: OverlayClient, id: string, now = Date.now()): { label: string; ms: number } | null {
    const p = c.pending.get(id);
    if (!p) return null;
    c.pending.delete(id);
    return { label: p.label, ms: now - p.at };
  }

  /** 取出超时还没回"开始播放"的播放（特效页可能卡住了） */
  playTimeouts(c: OverlayClient, now = Date.now()): string[] {
    const out: string[] = [];
    for (const [id, p] of c.pending) {
      if (now - p.at < PLAY_ACK_MS) continue;
      c.pending.delete(id);
      out.push(p.label);
    }
    return out;
  }

  /** 输出设置变了：更新配置，或（重置密钥、删除时）断开 */
  outputChanged(o: OutputRow, change: 'update' | 'key' | 'delete'): void {
    for (const c of [...this.overlays]) {
      if (c.outputId !== o.id) continue;
      if (change === 'update') send(c.sock, { type: 'config', config: overlayConfig(o) });
      else {
        c.sock.close(OVERLAY_CLOSE.badKey, change === 'key' ? 'key reset' : 'output deleted');
        this.removeOverlay(c);
      }
    }
  }

  addAdmin(sock: Sock): void {
    this.admins.add(sock);
  }

  removeAdmin(sock: Sock): void {
    this.admins.delete(sock);
  }

  toAdmins(msg: { type: string; [k: string]: unknown }): void {
    if (!this.admins.size) return;
    const data = JSON.stringify(msg);
    for (const s of this.admins) trySend(s, data);
  }

  closeAll(): void {
    for (const c of this.overlays) c.sock.close(1001, 'server shutdown');
    for (const s of this.admins) s.close(1001, 'server shutdown');
    this.overlays.clear();
    this.admins.clear();
  }
}

function send(sock: Sock, msg: ServerToOverlay): void {
  trySend(sock, JSON.stringify(msg));
}

function trySend(sock: Sock, data: string): void {
  try {
    sock.send(data);
  } catch {
    /* 连接正在关闭，由关闭事件清理 */
  }
}
