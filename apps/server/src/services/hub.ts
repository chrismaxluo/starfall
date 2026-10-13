// 在线的特效页和管理后台（方案设计 9.3）。这里不关心 WebSocket 细节，只管"发给谁"。
import { CHAT_MAX_LIMIT, GIFTS_KEEP, OVERLAY_CLOSE } from '@starfall/shared';
import type { ChatItem, GiftListItem, OverlayConfig, ServerToOverlay } from '@starfall/shared';
import type { OutputRow } from './outputs.ts';

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** fx：特效页；chat：弹幕列表；gifts：送礼名单；music：点歌窗口 */
export type OverlayRole = 'fx' | 'chat' | 'gifts' | 'music';

export interface OverlayClient {
  sock: Sock;
  outputId: number;
  role: OverlayRole;
  /** 浏览器查看页（&view=1）：能看特效，但不算"加到了直播软件" */
  view: boolean;
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
  role: OverlayRole;
  view: boolean;
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
  chatEnabled: o.chatEnabled,
  chatSide: o.chatSide,
  chatSize: o.chatSize,
  chatMedal: o.chatMedal,
  chatMax: o.chatMax,
  chatFadeSec: o.chatFadeSec,
  giftsEnabled: o.giftsEnabled,
  giftsSide: o.giftsSide,
  giftsSize: o.giftsSize,
  giftsMax: o.giftsMax,
  giftsSpeed: o.giftsSpeed,
  giftsFilter: o.giftsFilter,
});

export class Hub {
  /** 现在的特效页版本（连接时告诉特效页，旧页面会自动刷新） */
  private readonly build: () => string | null;
  private readonly overlays = new Set<OverlayClient>();
  private readonly admins = new Set<Sock>();
  private readonly overlayListeners = new Set<() => void>();
  /** 最近的几条弹幕（按能设的最多条数记）：弹幕列表刚打开（或刷新）时先显示这些，页面按自己的条数取最后几条 */
  private chatRecent: ChatItem[] = [];
  /** 本场（没开播时是上一场）的送礼名单，最多记 GIFTS_KEEP 条：送礼名单打开时先显示这些，页面按自己的筛选和条数取 */
  private giftsRecent: GiftListItem[] = [];
  /** 送礼名单挂上的记录（按顺序） */
  private giftPins: GiftListItem[] = [];

  constructor(opts: { build?: () => string | null } = {}) {
    this.build = opts.build ?? (() => null);
  }

  /** 特效页上下线、上报环境时通知（管理后台显示在线状态） */
  onOverlaysChange(fn: () => void): () => void {
    this.overlayListeners.add(fn);
    return () => this.overlayListeners.delete(fn);
  }

  private overlaysChanged(): void {
    for (const fn of this.overlayListeners) fn();
  }

  addOverlay(sock: Sock, output: OutputRow, preload: string[], now = Date.now(), role: OverlayRole = 'fx', view = false): OverlayClient {
    const c: OverlayClient = { sock, outputId: output.id, role, view, since: now, env: null, lastError: null, pending: new Map() };
    this.overlays.add(c);
    if (role === 'chat') send(sock, { type: 'hello', config: overlayConfig(output), preload: [], build: this.build(), chat: this.chatRecent });
    else if (role === 'gifts') send(sock, { type: 'hello', config: overlayConfig(output), preload: [], build: this.build(), gifts: this.giftsRecent, pins: this.giftPins });
    // 点歌窗口：点歌的状态由点歌服务在「上下线」通知里发
    else if (role === 'music') send(sock, { type: 'hello', config: overlayConfig(output), preload: [], build: this.build() });
    else send(sock, { type: 'hello', config: overlayConfig(output), preload, build: this.build() });
    this.overlaysChanged();
    return c;
  }

  removeOverlay(c: OverlayClient): void {
    if (this.overlays.delete(c)) this.overlaysChanged();
  }

  report(c: OverlayClient, patch: Partial<Pick<OverlayClient, 'env' | 'lastError'>>): void {
    Object.assign(c, patch);
    // 旧版特效页不在地址里带 view=1，只在上报的环境里写 view
    if (patch.env?.view === true) c.view = true;
    this.overlaysChanged();
  }

  /** 加到直播软件里的特效页数量（不算弹幕列表，也不算浏览器查看页） */
  overlayCount(): number {
    return [...this.overlays].filter((c) => c.role === 'fx' && !c.view).length;
  }

  overlayList(): OverlayInfo[] {
    return [...this.overlays].map((c) => ({ outputId: c.outputId, role: c.role, view: c.view, since: c.since, env: c.env, lastError: c.lastError }));
  }

  /** 发给所有特效页（所有输出同步播放）；版本更新也发给弹幕列表、送礼名单 */
  toOverlays(msg: ServerToOverlay, now = Date.now()): void {
    for (const c of this.overlays) {
      if (c.role !== 'fx' && msg.type !== 'version') continue;
      send(c.sock, msg);
      if (msg.type === 'play') c.pending.set(msg.item.id, { at: now, label: `${msg.item.effect.name} · ${msg.item.viewer.name}` });
    }
  }

  /**
   * 负责出声音的点歌窗口：最早连上的、加在直播软件里的那个（浏览器查看页只显示，不出声）。
   * 同时加了好几个点歌窗口时只有一个出声，免得两首叠在一起
   */
  musicPlayer(): OverlayClient | null {
    let best: OverlayClient | null = null;
    for (const c of this.overlays) if (c.role === 'music' && !c.view && (!best || c.since < best.since)) best = c;
    return best;
  }

  /** 发给所有点歌窗口：build 按「是不是出声音的那个」生成消息 */
  toMusic(build: (player: boolean) => ServerToOverlay): void {
    const player = this.musicPlayer();
    for (const c of this.overlays) if (c.role === 'music') send(c.sock, build(c === player));
  }

  /** 只发给出声音的点歌窗口 */
  toMusicPlayer(msg: ServerToOverlay): void {
    const p = this.musicPlayer();
    if (p) send(p.sock, msg);
  }

  /** 新的一条弹幕：发给所有弹幕列表和管理后台（后台的预览用），记住最近的几条 */
  toChat(item: ChatItem): void {
    this.chatRecent = [...this.chatRecent, item].slice(-CHAT_MAX_LIMIT);
    for (const c of this.overlays) if (c.role === 'chat') send(c.sock, { type: 'chat', item });
    this.toAdmins({ type: 'chat', item });
  }

  /** 换了直播间：清空弹幕列表 */
  clearChat(): void {
    this.chatRecent = [];
    for (const c of this.overlays) if (c.role === 'chat') send(c.sock, { type: 'chat_clear' });
    this.toAdmins({ type: 'chat_clear' });
  }

  /** 最近的几条弹幕（管理后台打开时用） */
  recentChat(): ChatItem[] {
    return this.chatRecent;
  }

  /** 送礼名单新的一条：发给所有送礼名单和管理后台 */
  toGifts(item: GiftListItem): void {
    this.giftsRecent = [...this.giftsRecent, item].slice(-GIFTS_KEEP);
    for (const c of this.overlays) if (c.role === 'gifts') send(c.sock, { type: 'gift_item', item });
    this.toAdmins({ type: 'gift_item', item });
  }

  /** 新开了一场直播、换了直播间：清空送礼名单；items 是重新装进来的记录（服务启动时从事件记录恢复，那时还没有页面连着） */
  resetGifts(items: GiftListItem[] = []): void {
    this.giftsRecent = items.slice(-GIFTS_KEEP);
    for (const c of this.overlays) if (c.role === 'gifts') send(c.sock, { type: 'gifts_clear' });
    this.toAdmins({ type: 'gifts_clear' });
  }

  /** 挂上的记录变了：发给所有送礼名单和管理后台 */
  setPins(items: GiftListItem[]): void {
    this.giftPins = items;
    for (const c of this.overlays) if (c.role === 'gifts') send(c.sock, { type: 'gift_pins', items });
    this.toAdmins({ type: 'gift_pins', items });
  }

  pins(): GiftListItem[] {
    return this.giftPins;
  }

  /** 本场的送礼名单（管理后台打开时用） */
  recentGifts(): GiftListItem[] {
    return this.giftsRecent;
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
