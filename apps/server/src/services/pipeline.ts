// 事件处理管道（方案设计第 5 节）：
// B 站事件 → 进场合并 → 匹配规则 → 判断能不能播 → 入队 → 播放循环 → 推送给所有在线特效页。
// 每个事件都写进事件记录，带上命中的规则和最终的播放状态。
// 四种事件共用同一套判断（黑名单 → 匹配规则 → 暂停 → 开播 → 冷却 → 特效页在线），只有匹配规则、冷却、欢迎语变量、是否插队不同。
import { Cooldowns, EnterMerger, GiftComboMerger, GuardDeduper, OncePerLive, PlayQueue, decide, enterRuleKey, fillText, matchDanmu, matchEnter, matchGift, matchGuard, pickText } from '@starfall/core';
import type { QueueItem, TextVars } from '@starfall/core';
import { GUARD_NAMES, JUMP_GOLD } from '@starfall/shared';
import type { PlayItem, PlayStatus, StdEvent, TriggerKind, Viewer } from '@starfall/shared';
import { HttpError } from '../http.ts';
import type { BlacklistStore } from './blacklist.ts';
import type { EffectDto, EffectStore } from './effects.ts';
import type { DanmuRuleStore, GiftRuleStore, GuardRuleStore } from './event-rules.ts';
import type { EventLog } from './events.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { GiftCatalog } from './gifts.ts';
import type { RoomStore } from './room.ts';
import type { EnterRuleStore } from './rules.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

export type TriggerEvent = Exclude<StdEvent, { kind: 'live' }>;
/** 欢迎语变量（除观众以外） */
export type Vars = Omit<TextVars, 'viewer'> & {
  /** 礼物图（不进欢迎语，放进播放内容给礼物特效用） */
  giftImg?: string;
};

/** 预览时各事件的示例内容 */
const SAMPLE_VARS: Record<TriggerKind, Vars> = {
  enter: {},
  danmu: { text: '主播晚上好！' },
  gift: { gift: '小花花', count: 10, valueGold: 1000, giftImg: 'https://s1.hdslb.com/bfs/live/5126973892625f3a43a8290be6b625b5e54261a5.png' },
  guard: { months: 1, guardLevel: 3, op: 'open' },
};

interface Judgement {
  hit: { label: string; effectId: number } | null;
  effect: EffectDto | null;
  status: PlayStatus;
  /** 真正入队时更新冷却等状态（模拟时不调用）；返回撤销函数：排队后没播出来（被挤掉、清空、暂停、特效页掉线）时撤销 */
  commit: () => () => void;
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
  /** 队列里显示的一句话，例如「舰长进场」「告白花束 ×1」「开通 提督」 */
  detail: string;
  /** 没播出来时撤销冷却 / 每场一次的记录 */
  undo?: () => void;
}

interface QueueBrief {
  id: string;
  kind: TriggerKind;
  effectName: string;
  viewerName: string;
  viewerFace: string | null;
  detail: string;
  /** 礼物图（礼物特效才有） */
  giftImg: string | null;
  durationMs: number;
  test: boolean;
}

export interface QueueSnapshot {
  playing: (QueueBrief & { startedAt: number }) | null;
  items: Array<QueueBrief & { enqueuedAt: number }>;
}

/** 队列里显示的一句话 */
export function queueDetail(ev: TriggerEvent, rule: string | null): string {
  switch (ev.kind) {
    case 'enter':
      return `${(rule ?? '').replace(/^进场 · /, '') || '观众'}进场`;
    case 'gift':
      return `${ev.giftName} ×${ev.count}`;
    case 'guard':
      return `${ev.op === 'renew' ? '续费' : '开通'} ${GUARD_NAMES[ev.level]}`;
    case 'danmu':
      return `弹幕「${[...ev.text].slice(0, 16).join('')}」`;
  }
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
  /** 查礼物图；测试里可以不传 */
  gifts?: Pick<GiftCatalog, 'iconFor'>;
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
  private merger = new EnterMerger();
  private combo = new GiftComboMerger();
  private guards = new GuardDeduper();
  private unsubscribeRoom: (() => void) | null = null;
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
    this.d.log.clearStaleQueued();
    this.unsubscribe = this.d.live.onEvent((ev, raw) => this.handle(ev, raw));
    // 换了直播间：还在合并中（等待中的进场、连击中的礼物、等待确认的上舰）属于上一个直播间，丢掉，不要记到新直播间名下
    this.unsubscribeRoom = this.d.room.onChange(() => {
      this.merger = new EnterMerger();
      this.combo = new GiftComboMerger();
      this.guards = new GuardDeduper();
    });
    this.flushTimer = setInterval(() => this.guard('取出合并中的事件', () => this.flush()), FLUSH_MS);
  }

  /** 定时器里出错时写日志、不让进程退出（例如磁盘满导致写记录失败），下一次还会继续 */
  private guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.error(`[播放调度] ${what}出错：`, e);
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.current) clearTimeout(this.current.timer);
    this.current = null;
    // 还在排队的没有播出来：写明原因（服务重启后不会被当作本场已播）
    for (const q of this.queue.clear()) this.unplayed(q, 'cleared');
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
    return this.d.log.record(ev, { roomId: this.d.room.get()?.roomId ?? null, sessionId: this.d.live.status().sessionId, rule: hit?.label ?? null, effectId: hit?.effectId ?? null, status, raw }).id;
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
    let commit = (): (() => void) => () => undefined;
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
            const undoG = this.cooldowns.hit(g, now, m.globalCdSec / 60);
            const undoU = this.cooldowns.hit(u, now, m.userCdMin);
            return () => {
              undoG();
              undoU();
            };
          };
        }
        break;
      }
      case 'gift': {
        const m = matchGift(ev, this.d.giftRules.get());
        vars = { gift: ev.giftName, count: ev.count, valueGold: ev.unitPrice * ev.count };
        {
          // 优先用送礼消息里自带的官方图标，没有时再查礼物面板
          const img = ev.icon || this.d.gifts?.iconFor(ev.giftId);
          if (img) vars.giftImg = img;
        }
        hit = m;
        jump = queueJump && ev.unitPrice * ev.count >= JUMP_GOLD;
        break;
      }
      case 'guard': {
        hit = matchGuard(ev, this.d.guardRules.get());
        vars = { months: ev.months, guardLevel: ev.level, op: ev.op };
        jump = queueJump;
        break;
      }
    }

    let effect: EffectDto | null = null;
    if (hit) {
      try {
        effect = this.d.effects.get(hit.effectId, { uses: false });
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
    // 消息没带礼物图时用礼物面板里的图补上（事件记录里也显示）
    if (ev.kind === 'gift' && !ev.icon) {
      const icon = this.d.gifts?.iconFor(ev.giftId);
      if (icon) ev = { ...ev, icon };
    }
    const j = this.judge(ev);
    const eventId = this.record(ev, j.hit, j.status);
    if (j.status !== 'queued' || !j.hit || !j.effect) return;
    const undo = j.commit();
    this.enqueue(this.playItem(j.effect, ev.viewer, ev.kind, j.vars), eventId, j.jump, queueDetail(ev, j.hit.label), undo);
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
        fadeIn: effect.fadeIn,
        fadeOut: effect.fadeOut,
        fadeInMs: effect.fadeInMs,
        fadeOutMs: effect.fadeOutMs,
        offsetX: effect.offsetX,
        offsetY: effect.offsetY,
        sizePct: effect.sizePct,
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
      ...(kind === 'guard' && vars.op ? { guardOp: vars.op } : {}),
      ...(kind === 'gift' && vars.gift ? { gift: { name: vars.gift, count: vars.count ?? 1, ...(vars.giftImg ? { img: vars.giftImg } : {}) } } : {}),
      ...(test ? { test: true } : {}),
    };
  }

  private enqueue(item: PlayItem, eventId: number | null, jump: boolean, detail: string, undo?: () => void): void {
    this.queue.max = this.d.settings.get('queueMax');
    const { dropped } = this.queue.enqueue({ id: item.id, kind: item.kind, enqueuedAt: this.now(), jump, payload: { item, eventId, detail, ...(undo ? { undo } : {}) } });
    if (dropped) this.unplayed(dropped, 'dropped');
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
        this.unplayed(q, 'no_overlay');
        continue;
      }
      this.d.hub.toOverlays({ type: 'play', item });
      if (eventId) this.d.log.setStatus(eventId, 'played');
      // 播放节奏由服务端控制：时长 + 间隔后播下一个，多个特效页始终同步
      const timer = setTimeout(() => {
        this.current = null;
        this.guard('播放下一个', () => {
          this.pump();
          this.emitQueue();
        });
      }, item.effect.durationMs + PLAY_GAP_MS);
      this.current = { q, startedAt: this.now(), timer };
    }
  }

  /** 排队的特效没播出来：写明原因，并撤销冷却 / 每场一次的记录（下次还能播） */
  private unplayed(q: QueueItem<Queued>, status: PlayStatus): void {
    q.payload.undo?.();
    if (q.payload.eventId) this.d.log.setStatus(q.payload.eventId, status);
  }

  /** 紧急暂停：立即停止画面、清空队列；暂停期间的事件照常记录（F-PL-05） */
  pause(): void {
    this.d.settings.set('paused', true);
    this.stopCurrent();
    for (const q of this.queue.clear()) this.unplayed(q, 'paused');
    this.emitQueue();
  }

  resume(): void {
    this.d.settings.set('paused', false);
    this.emitQueue();
  }

  /** 跳过正在播的特效，马上播下一个 */
  skip(): boolean {
    if (!this.current) return false;
    this.stopCurrent();
    this.pump();
    this.emitQueue();
    return true;
  }

  /** 把排队中的一项移出队列（这次不播） */
  remove(id: string): boolean {
    const q = this.queue.remove(id);
    if (!q) return false;
    this.unplayed(q, 'cleared');
    this.emitQueue();
    return true;
  }

  /** 清空待播放的特效（正在播的播完）（F-PL-06） */
  clear(): number {
    const items = this.queue.clear();
    for (const q of items) this.unplayed(q, 'cleared');
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
    this.enqueue(item, null, true, '测试播放');
    return { id: item.id };
  }

  /** 预览：生成播放内容但不入队（后台预览区用，只在本地播放） */
  preview(effect: EffectDto, viewer?: Partial<Viewer>, kind: TriggerKind = 'enter', vars?: Vars): PlayItem {
    const v: Viewer = { uid: 0, name: '测试观众', guard: 3, isMod: false, mystery: false, medal: { name: '星临', level: 21, anchorUid: 0 }, ...viewer };
    return this.playItem(effect, v, kind, { ...SAMPLE_VARS[kind], ...vars }, true);
  }

  snapshot(): QueueSnapshot {
    const brief = (q: QueueItem<Queued>): QueueBrief => {
      const it = q.payload.item;
      return { id: q.id, kind: q.kind, effectName: it.effect.name, viewerName: it.viewer.name, viewerFace: it.viewer.face ?? null, detail: q.payload.detail, giftImg: it.gift?.img ?? null, durationMs: it.effect.durationMs, test: Boolean(it.test) };
    };
    const c = this.current;
    return {
      playing: c ? { ...brief(c.q), startedAt: c.startedAt } : null,
      items: this.queue.list().map((q) => ({ ...brief(q), enqueuedAt: q.enqueuedAt })),
    };
  }

  private emitQueue(): void {
    if (!this.listeners.size) return;
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }
}
