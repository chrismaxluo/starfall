// 事件处理管道（方案设计第 5 节）：
// B 站事件 → 进场合并 → 匹配规则 → 判断能不能播 → 入队 → 播放循环 → 推送给所有在线特效页。
// 每个事件都写进事件记录，带上命中的规则和最终的播放状态。
// 第一期只有进场会播放；弹幕、礼物、上舰先照常记录（第二期接入规则）。
import { Cooldowns, EnterMerger, OncePerLive, PlayQueue, decide, enterRuleKey, fillText, matchEnter, pickText } from '@starfall/core';
import type { EnterMatch, QueueItem } from '@starfall/core';
import type { EnterEvent, PlayItem, PlayStatus, StdEvent, TriggerKind, Viewer } from '@starfall/shared';
import { HttpError } from '../http.ts';
import type { BlacklistStore } from './blacklist.ts';
import type { EffectDto, EffectStore } from './effects.ts';
import type { EventLog } from './events.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { RoomStore } from './room.ts';
import type { EnterRuleStore } from './rules.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

type TriggerEvent = Exclude<StdEvent, { kind: 'live' }>;

/** 两次播放之间的间隔 */
export const PLAY_GAP_MS = 300;
const FLUSH_MS = 200;
/** 原始消息在内存中最多保留多久（等待进场合并） */
const RAW_TTL_MS = 10_000;

interface Queued {
  item: PlayItem;
  eventId: number | null;
}

export interface QueueSnapshot {
  playing: { id: string; kind: TriggerKind; effectName: string; viewerName: string; startedAt: number; durationMs: number; test: boolean } | null;
  items: Array<{ id: string; kind: TriggerKind; effectName: string; viewerName: string; enqueuedAt: number; test: boolean }>;
}

export interface SimulateResult {
  rule: string | null;
  effect: { id: number; name: string } | null;
  status: PlayStatus;
}

export interface PipelineDeps {
  live: Pick<LiveService, 'onEvent' | 'status'>;
  room: RoomStore;
  settings: SettingsStore;
  enterRules: EnterRuleStore;
  effects: EffectStore;
  blacklist: BlacklistStore;
  viewers: ViewerStore;
  log: EventLog;
  hub: Hub;
  timeZone: string;
  now?: () => number;
  rng?: () => number;
}

export class Pipeline {
  private readonly d: PipelineDeps;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly merger = new EnterMerger();
  private readonly cooldowns = new Cooldowns();
  private readonly once = new OncePerLive();
  private readonly queue = new PlayQueue<Queued>();
  private readonly raws = new Map<string, { raw: unknown; at: number }>();
  private readonly listeners = new Set<(q: QueueSnapshot) => void>();
  private readonly remembered = new Map<number, string>();
  private current: { q: QueueItem<Queued>; startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private onceSession: number | null = null;
  private seq = 0;
  private readonly dayFmt: Intl.DateTimeFormat;

  constructor(deps: PipelineDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.rng = deps.rng ?? Math.random;
    // sv-SE 的日期格式就是 YYYY-MM-DD
    this.dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: deps.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  start(): void {
    this.unsubscribe = this.d.live.onEvent((ev, raw) => this.handle(ev, raw));
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.current) clearTimeout(this.current.timer);
    this.current = null;
  }

  onQueueChange(fn: (q: QueueSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  today(): string {
    return this.dayFmt.format(this.now());
  }

  // ---------- 收事件 ----------

  handle(ev: StdEvent, raw?: unknown): void {
    if (ev.kind === 'live') return;
    const now = this.now();
    if (raw !== undefined) this.raws.set(ev.id, { raw, at: now });
    this.remember(ev.viewer);
    if (ev.kind === 'enter') {
      for (const e of this.merger.push(ev, now)) this.processEnter(e);
    } else {
      // 第二期接入弹幕、礼物、上舰规则
      this.record(ev, null, 'no_rule');
    }
  }

  /** 取出等待超时的进场（定时调用） */
  flush(): void {
    const now = this.now();
    for (const e of this.merger.flush(now)) this.processEnter(e);
    for (const [id, r] of this.raws) if (now - r.at > RAW_TTL_MS) this.raws.delete(id);
  }

  private remember(v: Viewer): void {
    if (v.uid <= 0 || !v.name || v.mystery || this.remembered.get(v.uid) === v.name) return;
    this.remembered.set(v.uid, v.name);
    if (this.remembered.size > 50_000) this.remembered.clear();
    this.d.viewers.remember({ uid: v.uid, name: v.name, face: v.face ?? '' });
  }

  private record(ev: TriggerEvent, match: EnterMatch | null, status: PlayStatus): number {
    const raw = this.raws.get(ev.id)?.raw;
    this.raws.delete(ev.id);
    return this.d.log.record(ev, { sessionId: this.d.live.status().sessionId, rule: match?.label ?? null, effectId: match?.effectId ?? null, status, raw }).id;
  }

  // ---------- 判断 ----------

  /** 判断一次进场的结果；commit 为假时只判断（模拟），不改变冷却等状态 */
  private judgeEnter(ev: EnterEvent): { match: EnterMatch | null; status: PlayStatus; effect: EffectDto | null } {
    const room = this.d.room.get();
    const rules = this.d.enterRules.full();
    const match = matchEnter(ev.viewer, { rules, anchorUid: room?.anchorUid ?? 0, today: this.today() });
    const live = this.d.live.status();
    const oncePerLive = rules.cooldownMode === 'oncePerLive';
    this.syncOnceSession(live.sessionId);
    const now = this.now();
    let effect: EffectDto | null = null;
    if (match) {
      try {
        effect = this.d.effects.get(match.effectId);
      } catch {
        effect = null;
      }
    }
    const result = decide({
      blocked: this.d.blacklist.reason(ev.viewer.uid) !== null,
      matched: Boolean(match && effect),
      paused: this.d.settings.get('paused'),
      live: live.live,
      playWhenOffline: this.d.settings.get('offlinePolicy') === 'play',
      inCooldown: !oncePerLive && match !== null && this.cooldowns.active(`${enterRuleKey(match.rule)}:${ev.viewer.uid}`, now),
      playedThisLive: oncePerLive && this.once.has(ev.viewer.uid),
      overlayOnline: this.d.hub.overlayCount() > 0,
    });
    return { match, status: result.play ? 'queued' : result.status, effect };
  }

  /** 换了一场直播："每场一次"重新计算；服务重启后从事件记录恢复本场已播放的人 */
  private syncOnceSession(sessionId: number | null): void {
    if (sessionId === this.onceSession) return;
    this.onceSession = sessionId;
    if (sessionId === null) this.once.setSession(null);
    else this.once.restore(String(sessionId), this.d.log.playedEnterUids(sessionId));
  }

  private processEnter(ev: EnterEvent): void {
    const { match, status, effect } = this.judgeEnter(ev);
    const eventId = this.record(ev, match, status);
    if (status !== 'queued' || !match || !effect) return;
    const now = this.now();
    if (this.d.enterRules.base().cooldownMode === 'oncePerLive') this.once.mark(ev.viewer.uid);
    else this.cooldowns.hit(`${enterRuleKey(match.rule)}:${ev.viewer.uid}`, now, match.cooldownMin);
    this.enqueue(this.playItem(effect, ev.viewer, 'enter'), eventId, false);
  }

  /** 模拟一次进场：只判断，不入队、不记录、不影响冷却（F-RU-05） */
  simulate(viewer: Viewer): SimulateResult {
    const { match, status, effect } = this.judgeEnter({ kind: 'enter', id: 'sim', ts: this.now(), viewer, source: 'interact' });
    return { rule: match?.label ?? null, effect: effect ? { id: effect.id, name: effect.name } : null, status: status === 'queued' ? 'played' : status };
  }

  // ---------- 播放 ----------

  private playItem(effect: EffectDto, viewer: Viewer, kind: TriggerKind, test = false): PlayItem {
    const a = effect.asset;
    return {
      id: `p${this.now()}-${++this.seq}`,
      kind,
      effect: {
        id: effect.id,
        name: effect.name,
        visual:
          effect.visual.type === 'asset' && a
            ? { type: 'asset', url: a.url, ext: a.ext, kind: a.kind === 'audio' ? 'video' : a.kind, width: a.width, height: a.height, hasAlpha: a.hasAlpha }
            : { type: 'builtin_style', style: effect.visual.type === 'builtin_style' ? effect.visual.style : 'line' },
        showText: effect.showText,
        position: effect.position,
        durationMs: effect.durationMs,
        sound: effect.sound ? { url: effect.sound.url } : null,
        volume: effect.volume,
      },
      text: fillText(pickText(effect.texts, kind, this.rng), { viewer }),
      viewer: {
        name: viewer.name,
        ...(viewer.face ? { face: viewer.face } : {}),
        guard: viewer.guard,
        isMod: viewer.isMod,
        ...(viewer.medal ? { medal: { name: viewer.medal.name, level: viewer.medal.level, ...(viewer.medal.colors ? { colors: viewer.medal.colors } : {}) } } : {}),
      },
      ...(test ? { test: true } : {}),
    };
  }

  private enqueue(item: PlayItem, eventId: number | null, jump: boolean): void {
    this.queue.max = this.d.settings.get('queueMax');
    const { dropped } = this.queue.enqueue({ id: item.id, kind: item.kind, enqueuedAt: this.now(), jump, payload: { item, eventId } });
    if (dropped?.payload.eventId) this.d.log.setStatus(dropped.payload.eventId, 'dropped');
    this.pump();
    this.emitQueue();
  }

  private pump(): void {
    while (!this.current) {
      const q = this.queue.next();
      if (!q) return;
      const { item, eventId } = q.payload;
      // 排队期间特效页全部掉线：不积压（F-OU-12）
      if (this.d.hub.overlayCount() === 0) {
        if (eventId) this.d.log.setStatus(eventId, 'no_overlay');
        continue;
      }
      this.d.hub.toOverlays({ type: 'play', item });
      if (eventId) this.d.log.setStatus(eventId, 'played');
      // 播放节奏由服务端控制：时长 + 间隔后播下一个，多个特效页始终同步
      const timer = setTimeout(() => {
        this.current = null;
        this.pump();
        this.emitQueue();
      }, item.effect.durationMs + PLAY_GAP_MS);
      this.current = { q, startedAt: this.now(), timer };
    }
  }

  /** 紧急暂停：立即停止画面、清空队列；暂停期间的事件照常记录（F-PL-05） */
  pause(): void {
    this.d.settings.set('paused', true);
    this.stopCurrent();
    for (const q of this.queue.clear()) if (q.payload.eventId) this.d.log.setStatus(q.payload.eventId, 'paused');
    this.emitQueue();
  }

  resume(): void {
    this.d.settings.set('paused', false);
    this.emitQueue();
  }

  /** 清空待播放的特效（正在播的播完）（F-PL-06） */
  clear(): number {
    const items = this.queue.clear();
    for (const q of items) if (q.payload.eventId) this.d.log.setStatus(q.payload.eventId, 'cleared');
    this.emitQueue();
    return items.length;
  }

  private stopCurrent(): void {
    if (!this.current) return;
    clearTimeout(this.current.timer);
    this.current = null;
    this.d.hub.toOverlays({ type: 'stop' });
  }

  /** 测试播放：把素材发到直播画面，不经过规则（界面上需要二次确认） */
  test(effectId: number, viewer?: Partial<Viewer>): { id: string } {
    if (this.d.settings.get('paused')) throw new HttpError(409, 'paused', '已暂停，恢复后才能测试');
    if (this.d.hub.overlayCount() === 0) throw new HttpError(409, 'no_overlay', '特效页不在线：请先把特效页地址加到直播软件的浏览器源里');
    const effect = this.d.effects.get(effectId);
    const v: Viewer = { uid: 0, name: '测试观众', guard: 3, isMod: false, mystery: false, medal: { name: '星临', level: 21, anchorUid: 0 }, ...viewer };
    const item = this.playItem(effect, v, 'enter', true);
    this.enqueue(item, null, true);
    return { id: item.id };
  }

  /** 预览：生成播放内容但不入队（后台预览区用，只在本地播放） */
  preview(effect: EffectDto, viewer?: Partial<Viewer>, kind: TriggerKind = 'enter'): PlayItem {
    const v: Viewer = { uid: 0, name: '测试观众', guard: 3, isMod: false, mystery: false, medal: { name: '星临', level: 21, anchorUid: 0 }, ...viewer };
    return this.playItem(effect, v, kind, true);
  }

  snapshot(): QueueSnapshot {
    const brief = (q: QueueItem<Queued>) => ({ id: q.id, kind: q.kind, effectName: q.payload.item.effect.name, viewerName: q.payload.item.viewer.name, test: Boolean(q.payload.item.test) });
    const c = this.current;
    return {
      playing: c ? { ...brief(c.q), startedAt: c.startedAt, durationMs: c.q.payload.item.effect.durationMs } : null,
      items: this.queue.list().map((q) => ({ ...brief(q), enqueuedAt: q.enqueuedAt })),
    };
  }

  private emitQueue(): void {
    if (!this.listeners.size) return;
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }
}
