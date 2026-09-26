// 事件处理管道（方案设计第 5 节）：
// B 站事件 → 进场合并 → 匹配规则 → 判断能不能播 → 入队 → 播放循环 → 推送给所有在线特效页。
// 每个事件都写进事件记录，带上命中的规则和最终的播放状态。
// 四种事件共用同一套判断（黑名单 → 匹配规则 → 暂停 → 开播 → 冷却 → 特效页在线），只有匹配规则、冷却、欢迎语变量、是否插队不同。
import { Cooldowns, EnterMerger, GiftComboMerger, GuardDeduper, OncePerLive, PlayQueue, decide, enterRuleKey, fillText, matchDanmu, matchEnter, matchGift, matchGuard, pickText } from '@starfall/core';
import type { QueueItem, TextVars } from '@starfall/core';
import { JUMP_GOLD } from '@starfall/shared';
import type { PlayItem, PlayStatus, StdEvent, TriggerKind, Viewer } from '@starfall/shared';
import { HttpError } from '../http.ts';
import type { BlacklistStore } from './blacklist.ts';
import type { EffectDto, EffectStore } from './effects.ts';
import type { DanmuRuleStore, GiftRuleStore, GuardRuleStore } from './event-rules.ts';
import type { EventLog } from './events.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { RoomStore } from './room.ts';
import type { EnterRuleStore } from './rules.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

export type TriggerEvent = Exclude<StdEvent, { kind: 'live' }>;
/** 欢迎语变量（除观众以外） */
export type Vars = Omit<TextVars, 'viewer'>;

/** 预览时各事件的示例内容 */
const SAMPLE_VARS: Record<TriggerKind, Vars> = {
  enter: {},
  danmu: { text: '主播晚上好！' },
  gift: { gift: '小花花', count: 10, valueGold: 1000 },
  guard: { months: 1, guardLevel: 3 },
};

interface Judgement {
  hit: { label: string; effectId: number } | null;
  effect: EffectDto | null;
  status: PlayStatus;
  /** 真正入队时更新冷却等状态（模拟时不调用） */
  commit: () => void;
  vars: Vars;
  jump: boolean;
}

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
  /** 只按规则判断（黑名单、规则、冷却、每场一次）；开播、暂停、特效页在线这些现场情况放在 notes 里 */
  status: PlayStatus;
  /** 现场情况的提醒，例如"现在没开播" */
  notes: string[];
}

export interface PipelineDeps {
  live: Pick<LiveService, 'onEvent' | 'status'>;
  room: RoomStore;
  settings: SettingsStore;
  enterRules: EnterRuleStore;
  danmuRules: DanmuRuleStore;
  giftRules: GiftRuleStore;
  guardRules: GuardRuleStore;
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
  private readonly combo = new GiftComboMerger();
  private readonly guards = new GuardDeduper();
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
    switch (ev.kind) {
      case 'enter':
        for (const e of this.merger.push(ev, now)) this.process(e);
        break;
      case 'gift': {
        const g = this.d.giftRules.get();
        this.combo.windowMs = g.comboSec * 1000;
        this.combo.enabled = g.comboEnabled;
        for (const e of this.combo.push(ev, now)) this.process(e);
        break;
      }
      case 'guard':
        for (const e of this.guards.push(ev, now)) this.process(e);
        break;
      case 'danmu':
        this.process(ev);
        break;
    }
  }

  /** 取出等待超时的进场、连击结束的礼物、单独到达的 GUARD_BUY（定时调用） */
  flush(): void {
    const now = this.now();
    for (const e of this.merger.flush(now)) this.process(e);
    for (const e of this.combo.flush(now)) this.process(e);
    for (const e of this.guards.flush(now)) this.process(e);
    for (const [id, r] of this.raws) if (now - r.at > RAW_TTL_MS) this.raws.delete(id);
  }

  private remember(v: Viewer): void {
    if (v.uid <= 0 || !v.name || v.mystery || this.remembered.get(v.uid) === v.name) return;
    this.remembered.set(v.uid, v.name);
    if (this.remembered.size > 50_000) this.remembered.clear();
    this.d.viewers.remember({ uid: v.uid, name: v.name, face: v.face ?? '' });
  }

  private record(ev: TriggerEvent, hit: Judgement['hit'], status: PlayStatus): number {
    const raw = this.raws.get(ev.id)?.raw;
    this.raws.delete(ev.id);
    return this.d.log.record(ev, { sessionId: this.d.live.status().sessionId, rule: hit?.label ?? null, effectId: hit?.effectId ?? null, status, raw }).id;
  }

  // ---------- 判断 ----------

  /** 判断一个事件能不能播（不改变任何状态；入队时再调用 commit） */
  /** whatIf：模拟用，假设已开播、没暂停、特效页在线 */
  private judge(ev: TriggerEvent, whatIf = false): Judgement {
    const now = this.now();
    const live = this.d.live.status();
    const anchorUid = this.d.room.get()?.anchorUid ?? 0;
    const uid = ev.viewer.uid;
    let hit: Judgement['hit'] = null;
    let inCooldown = false;
    let playedThisLive = false;
    let commit = () => undefined as void;
    let vars: Vars = {};
    let jump = false;
    const queueJump = this.d.settings.get('queueJump');

    switch (ev.kind) {
      case 'enter': {
        const rules = this.d.enterRules.full();
        const m = matchEnter(ev.viewer, { rules, anchorUid, today: this.today() });
        const once = rules.cooldownMode === 'oncePerLive';
        this.syncOnceSession(live.sessionId);
        if (m) {
          const key = `${enterRuleKey(m.rule)}:${uid}`;
          hit = m;
          inCooldown = !once && this.cooldowns.active(key, now);
          playedThisLive = once && this.once.has(uid);
          commit = () => (once ? this.once.mark(uid) : this.cooldowns.hit(key, now, m.cooldownMin));
        }
        break;
      }
      case 'danmu': {
        const m = matchDanmu(ev.text, ev.viewer, this.d.danmuRules.list(), anchorUid);
        vars = { text: ev.text };
        if (m) {
          const g = `danmu:${m.ruleId}`;
          const u = `danmu:${m.ruleId}:${uid}`;
          hit = m;
          inCooldown = this.cooldowns.active(g, now) || this.cooldowns.active(u, now);
          commit = () => {
            this.cooldowns.hit(g, now, m.globalCdSec / 60);
            this.cooldowns.hit(u, now, m.userCdMin);
          };
        }
        break;
      }
      case 'gift': {
        const m = matchGift(ev, this.d.giftRules.get());
        vars = { gift: ev.giftName, count: ev.count, valueGold: ev.unitPrice * ev.count };
        hit = m;
        jump = queueJump && ev.unitPrice * ev.count >= JUMP_GOLD;
        break;
      }
      case 'guard': {
        hit = matchGuard(ev, this.d.guardRules.get());
        vars = { months: ev.months, guardLevel: ev.level };
        jump = queueJump;
        break;
      }
    }

    let effect: EffectDto | null = null;
    if (hit) {
      try {
        effect = this.d.effects.get(hit.effectId);
      } catch {
        effect = null;
      }
    }
    const result = decide({
      blocked: this.d.blacklist.reason(uid) !== null,
      matched: Boolean(hit && effect),
      paused: !whatIf && this.d.settings.get('paused'),
      live: whatIf || live.live,
      playWhenOffline: this.d.settings.get('offlinePolicy') === 'play',
      inCooldown,
      playedThisLive,
      overlayOnline: whatIf || this.d.hub.overlayCount() > 0,
    });
    return { hit, effect, status: result.play ? 'queued' : result.status, commit, vars, jump };
  }

  /** 换了一场直播："每场一次"重新计算；服务重启后从事件记录恢复本场已播放的人 */
  private syncOnceSession(sessionId: number | null): void {
    if (sessionId === this.onceSession) return;
    this.onceSession = sessionId;
    if (sessionId === null) this.once.setSession(null);
    else this.once.restore(String(sessionId), this.d.log.playedEnterUids(sessionId));
  }

  private process(ev: TriggerEvent): void {
    const j = this.judge(ev);
    const eventId = this.record(ev, j.hit, j.status);
    if (j.status !== 'queued' || !j.hit || !j.effect) return;
    j.commit();
    this.enqueue(this.playItem(j.effect, ev.viewer, ev.kind, j.vars), eventId, j.jump);
  }

  /** 模拟一次事件：只判断，不入队、不记录、不影响冷却（F-RU-05） */
  // 没开播时也能模拟：只按规则判断，现场情况作为提醒返回
  simulate(ev: TriggerEvent): SimulateResult {
    const j = this.judge(ev, true);
    const notes: string[] = [];
    if (j.status === 'queued') {
      if (this.d.settings.get('paused')) notes.push('现在是暂停状态，恢复播放后才会真的播放');
      else if (!this.d.live.status().live && this.d.settings.get('offlinePolicy') !== 'play') notes.push('现在没开播，开播后才会真的播放');
      if (this.d.hub.overlayCount() === 0) notes.push('特效页现在不在线，直播画面里看不到');
    }
    return { rule: j.hit?.label ?? null, effect: j.effect ? { id: j.effect.id, name: j.effect.name } : null, status: j.status === 'queued' ? 'played' : j.status, notes };
  }

  // ---------- 播放 ----------

  private playItem(effect: EffectDto, viewer: Viewer, kind: TriggerKind, vars: Vars = {}, test = false): PlayItem {
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
      text: fillText(pickText(effect.texts, kind, this.rng), { viewer, ...vars }),
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
    const item = this.playItem(effect, v, 'enter', {}, true);
    // 正在播的也是测试：直接换成新的，不用等它播完（真实观众的特效不打断）
    if (this.current?.q.payload.item.test) this.stopCurrent();
    this.enqueue(item, null, true);
    return { id: item.id };
  }

  /** 预览：生成播放内容但不入队（后台预览区用，只在本地播放） */
  preview(effect: EffectDto, viewer?: Partial<Viewer>, kind: TriggerKind = 'enter', vars?: Vars): PlayItem {
    const v: Viewer = { uid: 0, name: '测试观众', guard: 3, isMod: false, mystery: false, medal: { name: '星临', level: 21, anchorUid: 0 }, ...viewer };
    return this.playItem(effect, v, kind, vars ?? SAMPLE_VARS[kind], true);
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
