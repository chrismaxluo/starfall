// 事件处理管道（方案设计第 5 节）：
// B 站事件 → 进场合并 → 匹配规则 → 判断能不能播 → 入队 → 播放循环 → 推送给所有在线特效页。
// 每个事件都写进事件记录，带上命中的规则和最终的播放状态。
// 四种事件共用同一套判断（黑名单 → 匹配规则 → 暂停 → 开播 → 冷却 → 特效页在线），只有匹配规则、冷却、欢迎语变量、是否插队不同。
import { Cooldowns, EnterMerger, GiftComboMerger, GuardDeduper, OncePerLive, PlayQueue, decide, enterRuleKey, fillText, matchDanmu, matchEnter, matchGift, matchGuard, pickText } from '@starfall/core';
import type { QueueItem, TextVars } from '@starfall/core';
import { BIG_GIFT_GOLD, BILI_GIFT_STYLE, GIFTS_KEEP, GUARD_BADGES, GUARD_FRAMES, GUARD_NAMES, JUMP_GOLD, isOwnMedal } from '@starfall/shared';
import type { ChatItem, DanmuEvent, GiftEvent, GiftListItem, GuardEvent, PlayItem, ScEvent, PlayStatus, StdEvent, SvgaDyn, TriggerKind, Viewer } from '@starfall/shared';
import { HttpError } from '../http.ts';
import type { BlacklistStore } from './blacklist.ts';
import type { EffectDto, EffectStore } from './effects.ts';
import type { DanmuRuleStore, GiftRuleStore, GuardRuleStore } from './event-rules.ts';
import type { EventLog } from './events.ts';
import type { Hub } from './hub.ts';
import type { LiveService } from './live.ts';
import type { GiftEffects, GiftFxHit } from './gift-fx.ts';
import type { GiftCatalog } from './gifts.ts';
import type { HonorMedals } from './honor.ts';
import type { RoomStore } from './room.ts';
import type { EnterRuleStore } from './rules.ts';
import type { SettingsStore } from './settings.ts';
import type { ViewerStore } from './viewers.ts';

/** 会触发特效的事件（醒目留言现在只记录） */
export type TriggerEvent = Exclude<StdEvent, { kind: 'live' | 'sc' }>;
/** 醒目留言编号记多久（同一条可能推送两次） */
const SC_DEDUPE_MS = 10 * 60_000;
/** 欢迎语变量（除观众以外） */
export type Vars = Omit<TextVars, 'viewer'> & {
  /** 礼物编号：查礼物图、动图和 B站全屏动画（不进欢迎语） */
  giftId?: number;
  /** 礼物图（不进欢迎语）：礼物面板里查不到时用这张，一般是送礼消息自带的 */
  giftImg?: string;
};

/** 预览时各事件的示例内容 */
const SAMPLE_VARS: Record<TriggerKind, Vars> = {
  enter: {},
  danmu: { text: '主播晚上好！' },
  gift: { gift: '小花花', giftId: 31036, count: 10, valueGold: 1000, giftImg: 'https://s1.hdslb.com/bfs/live/5126973892625f3a43a8290be6b625b5e54261a5.png' },
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

/** 测试播放、预览用的观众 */
/** 没给的用示例补上；换了礼物却没有礼物图时，不能沿用示例（小花花）的图 */
function withSample(kind: TriggerKind, vars?: Vars): Vars {
  const v = { ...SAMPLE_VARS[kind], ...vars };
  if (kind === 'gift' && vars?.gift !== undefined && vars.gift !== SAMPLE_VARS.gift.gift) {
    if (!vars.giftImg) delete v.giftImg;
    if (!vars.giftId) delete v.giftId;
  }
  return v;
}

const SAMPLE_VIEWER: Viewer = { uid: 0, name: '测试观众', guard: 3, isMod: false, mystery: false, medal: { name: '星临', level: 21, anchorUid: 0 }, honor: 28 };

const honorOf = (level: number, url: string | undefined) => ({ level, ...(url ? { url } : {}) });

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
  /** 大航海等级（0 不是），后台给头像套头像框 */
  viewerGuard: number;
  detail: string;
  /** 礼物图（礼物特效才有） */
  giftImg: string | null;
  durationMs: number;
  test: boolean;
  /** 素材快捷播放 */
  quick: boolean;
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
  live: Pick<LiveService, 'onEvent' | 'status'> & Partial<Pick<LiveService, 'lastSession'>>;
  /** 查礼物图；测试里可以不传 */
  gifts?: Pick<GiftCatalog, 'find'>;
  /** 查 B站礼物全屏动画；测试里可以不传 */
  giftFx?: Pick<GiftEffects, 'forGift'>;
  /** 查荣耀等级勋章图；测试里可以不传 */
  honor?: Pick<HonorMedals, 'urlFor'>;
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
  /** 送礼名单现在装的是哪一场（没开播时是上一场；新开一场时清空） */
  private giftsSession: number | null = null;
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
    this.guard('恢复送礼名单', () => this.restoreGifts());
    this.unsubscribe = this.d.live.onEvent((ev, raw) => this.handle(ev, raw));
    // 换了直播间：还在合并中（等待中的进场、连击中的礼物、等待确认的上舰）属于上一个直播间，丢掉，不要记到新直播间名下
    this.unsubscribeRoom = this.d.room.onChange(() => {
      this.merger = new EnterMerger();
      this.combo = new GiftComboMerger();
      this.guards = new GuardDeduper();
      this.d.hub.clearChat();
      this.giftsSession = null;
      this.d.hub.resetGifts();
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
        // 弹幕列表显示所有人的弹幕（不看规则、黑名单、暂停）
        this.guard('推送弹幕列表', () => this.d.hub.toChat(this.chatItem(ev)));
        this.process(ev);
        break;
      case 'sc': {
        // 只记录（算进礼物榜、显示在实时动态），不触发特效
        for (const [id, at] of this.scSeen) if (now - at > SC_DEDUPE_MS) this.scSeen.delete(id);
        if (this.scSeen.has(ev.scId)) {
          this.raws.delete(ev.id);
          break;
        }
        this.scSeen.set(ev.scId, now);
        this.record(ev, null, 'no_rule');
        this.pushGift(ev);
        break;
      }
    }
  }
  private readonly scSeen = new Map<string, number>();

  /** 取出等待超时的进场、连击结束的礼物、单独到达的 GUARD_BUY（定时调用） */
  flush(): void {
    const now = this.now();
    for (const e of this.merger.flush(now)) this.process(e);
    for (const e of this.combo.flush(now)) this.process(e);
    for (const e of this.guards.flush(now)) this.process(e);
    this.syncGiftsSession();
    for (const [id, r] of this.raws) if (now - r.at > RAW_TTL_MS) this.raws.delete(id);
  }

  /** 弹幕列表里的一条：标出主播本人、是不是本直播间的粉丝牌；消息里没带头像时用记下的 */
  // ---------- 送礼名单 ----------

  /** 送礼名单的一条：付费礼物（连击合成后的）、上舰、醒目留言；免费礼物不算 */
  giftListItem(ev: GiftEvent | GuardEvent | ScEvent): GiftListItem | null {
    const v = ev.viewer;
    const face = v.face || this.d.viewers.cached(v.uid)?.face || '';
    const base = { id: ev.id, ts: ev.ts, viewer: { name: v.name, ...(face ? { face } : {}), guard: v.guard } };
    if (ev.kind === 'gift') {
      const value = ev.unitPrice * ev.count;
      if (!ev.paid || value <= 0) return null;
      const g = this.giftOf({ giftId: ev.giftId, ...(ev.icon ? { giftImg: ev.icon } : {}) });
      return { ...base, kind: 'gift', value, gift: { id: ev.giftId, name: ev.giftName, count: ev.count, ...(g.img ? { img: g.img } : {}) } };
    }
    if (ev.kind === 'guard') return { ...base, kind: 'guard', value: ev.priceGold ?? 0, guard: { level: ev.level, months: ev.months, op: ev.op } };
    return { ...base, kind: 'sc', value: Math.round(ev.priceYuan * 1000), sc: { text: ev.text, price: ev.priceYuan } };
  }

  private pushGift(ev: GiftEvent | GuardEvent | ScEvent): void {
    this.guard('推送送礼名单', () => {
      this.syncGiftsSession();
      const item = this.giftListItem(ev);
      if (item) this.d.hub.toGifts(item);
    });
  }

  /** 新开了一场直播：清空送礼名单（没开播时保留上一场的） */
  private syncGiftsSession(): void {
    const sid = this.d.live.status().sessionId;
    if (sid === null || sid === this.giftsSession) return;
    this.giftsSession = sid;
    this.d.hub.resetGifts();
  }

  /** 服务启动时：从事件记录恢复本场（没开播时是上一场）的送礼名单 */
  private restoreGifts(): void {
    const room = this.d.room.get();
    const sid = this.d.live.status().sessionId ?? (room ? (this.d.live.lastSession?.(room.roomId)?.id ?? null) : null);
    this.giftsSession = sid;
    if (sid === null) return this.d.hub.resetGifts();
    const items: GiftListItem[] = [];
    for (const r of this.d.log.giftListEvents(sid, GIFTS_KEEP)) {
      const ev = eventFromLog(r);
      const item = ev ? this.giftListItem(ev) : null;
      if (item) items.push(item);
    }
    this.d.hub.resetGifts(items);
  }

  chatItem(ev: DanmuEvent): ChatItem {
    const v = ev.viewer;
    const anchorUid = this.d.room.get()?.anchorUid ?? 0;
    const face = v.face || this.d.viewers.cached(v.uid)?.face || '';
    return {
      id: ev.id,
      ts: ev.ts,
      viewer: {
        uid: v.uid,
        name: v.name,
        ...(face ? { face } : {}),
        guard: v.guard,
        isMod: v.isMod,
        anchor: anchorUid > 0 && v.uid === anchorUid,
        ...(v.medal && v.medal.level > 0 ? { medal: { name: v.medal.name, level: v.medal.level, own: isOwnMedal(v, anchorUid), ...(v.medal.colors ? { colors: v.medal.colors } : {}) } } : {}),
        ...(v.honor ? { honor: honorOf(v.honor, this.d.honor?.urlFor(v.honor)) } : {}),
      },
      text: ev.text,
      ...(ev.emots ? { emots: ev.emots } : {}),
      ...(ev.sticker ? { sticker: ev.sticker } : {}),
    };
  }

  private remember(v: Viewer): void {
    const roomId = this.d.room.get()?.roomId;
    // 昵称、大航海等级、荣耀等级都没变就不用再写
    const key = `${v.name}|${v.guard}|${roomId}|${v.honor ?? 0}`;
    if (v.uid <= 0 || !v.name || v.mystery || this.remembered.get(v.uid) === key) return;
    this.remembered.set(v.uid, key);
    if (this.remembered.size > 50_000) this.remembered.clear();
    this.d.viewers.remember({ uid: v.uid, name: v.name, face: v.face ?? '', ...(v.honor ? { honor: v.honor } : {}) }, roomId ? { level: v.guard, roomId } : undefined);
  }

  private record(ev: TriggerEvent | Extract<StdEvent, { kind: 'sc' }>, hit: Judgement['hit'], status: PlayStatus): number {
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
    const blockedBy = this.d.blacklist.reason(uid);
    /** 弹幕规则点了 TA 的名：主播本人、登录的账号也照样触发（手动拉黑的不算） */
    let named = false;
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
        const auto = blockedBy === 'anchor' || blockedBy === 'account';
        const m = matchDanmu(ev.text, ev.viewer, this.d.danmuRules.list(), anchorUid, auto);
        vars = { text: ev.text };
        named = auto && m !== null;
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
        // 礼物图按编号查礼物面板（可以用动图）；送礼消息自带的图（已经用面板补过）兜底
        vars = { gift: ev.giftName, giftId: ev.giftId, count: ev.count, valueGold: ev.unitPrice * ev.count, ...(ev.icon ? { giftImg: ev.icon } : {}) };
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
      blocked: blockedBy !== null && !named,
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
      const icon = this.d.gifts?.find(ev.giftId)?.icon;
      if (icon) ev = { ...ev, icon };
    }
    const j = this.judge(ev);
    const eventId = this.record(ev, j.hit, j.status);
    if (ev.kind === 'gift' || ev.kind === 'guard') this.pushGift(ev);
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

  /** 上下羽化宽度：跟随全局时只对没有透明通道的素材生效 */
  private featherOf(e: EffectDto): number {
    if (e.visual.type !== 'asset' || !e.asset || e.feather === 'off') return 0;
    if (e.feather === 'custom') return e.featherPct;
    return !e.asset.hasAlpha && this.d.settings.get('featherOn') ? this.d.settings.get('featherPct') : 0;
  }

  /** SVGA 图层替换成这位观众的头像、头像框、身份图标、荣耀勋章、昵称、欢迎语；不是大航海时头像框、图标那一层藏起来，没有荣耀等级时勋章那一层藏起来 */
  private svgaDyn(effect: EffectDto, viewer: Viewer, text: string): SvgaDyn[] | undefined {
    const a = effect.asset;
    if (!a || a.ext !== 'svga' || !a.slots?.length) return undefined;
    const g = viewer.guard;
    const out: SvgaDyn[] = [];
    for (const s of a.slots) {
      const role = effect.svgaMap[s.key];
      if (!role) continue;
      const base = { key: s.key, role, w: s.w, h: s.h };
      // 头像带上昵称：加载不到头像时用昵称的第一个字画一个
      if (role === 'avatar' || role === 'avatarSquare') out.push({ ...base, url: viewer.face ?? '', text: viewer.name });
      else if (role === 'frame') out.push({ ...base, url: g ? GUARD_FRAMES[g] : '' });
      else if (role === 'badge') out.push({ ...base, url: g ? GUARD_BADGES[g] : '' });
      else if (role === 'honor') out.push({ ...base, url: this.d.honor?.urlFor(viewer.honor) ?? '' });
      else if (role === 'name') out.push({ ...base, text: viewer.name });
      else out.push({ ...base, text });
    }
    return out.length ? out : undefined;
  }

  /** 礼物图（设置里选了动图并且有动图时用动图）和 B站全屏动画 */
  private giftOf(vars: Vars): { img?: string; fx?: GiftFxHit } {
    const g = vars.giftId ? this.d.gifts?.find(vars.giftId) : undefined;
    const anim = this.d.settings.get('giftAnimImg') ? g?.webp || g?.gif : undefined;
    const img = anim || g?.icon || vars.giftImg;
    const fx = this.d.giftFx?.forGift(g);
    return { ...(img ? { img } : {}), ...(fx ? { fx } : {}) };
  }

  private playItem(effect: EffectDto, viewer: Viewer, kind: TriggerKind, vars: Vars = {}, test = false): PlayItem {
    const a = effect.asset;
    const text = fillText(pickText(effect.texts, kind, this.rng), { viewer, ...vars });
    const dyn = this.svgaDyn(effect, viewer, text);
    const gift = kind === 'gift' && vars.gift ? this.giftOf(vars) : undefined;
    // 「B站动画」：有官方全屏动画时按动画的长度播；没有时按价值换成晶耀或晶礼的样子
    let style = effect.visual.type === 'builtin_style' ? effect.visual.style : 'line';
    let durationMs = effect.durationMs;
    if (style === BILI_GIFT_STYLE) {
      if (gift?.fx) durationMs = gift.fx.durationMs;
      else style = (vars.valueGold ?? 0) >= BIG_GIFT_GOLD ? 'glass-big' : 'glass-gift';
    }
    return {
      id: `p${this.now()}-${++this.seq}`,
      kind,
      effect: {
        id: effect.id,
        name: effect.name,
        visual:
          effect.visual.type === 'asset' && a
            ? { type: 'asset', url: a.url, ext: a.ext, kind: a.kind === 'audio' ? 'video' : a.kind, width: a.width, height: a.height, hasAlpha: a.hasAlpha, ...(dyn ? { dyn } : {}) }
            : { type: 'builtin_style', style },
        showText: effect.showText,
        position: effect.position,
        durationMs,
        fadeIn: effect.fadeIn,
        fadeOut: effect.fadeOut,
        fadeInMs: effect.fadeInMs,
        fadeOutMs: effect.fadeOutMs,
        offsetX: effect.offsetX,
        offsetY: effect.offsetY,
        sizePct: effect.sizePct,
        featherPct: this.featherOf(effect),
        guardFrame: effect.guardFrame,
        honorBadge: effect.honorBadge,
        sound: effect.sound ? { url: effect.sound.url } : null,
        volume: effect.volume,
      },
      text,
      viewer: {
        name: viewer.name,
        ...(viewer.face ? { face: viewer.face } : {}),
        guard: viewer.guard,
        isMod: viewer.isMod,
        ...(viewer.medal ? { medal: { name: viewer.medal.name, level: viewer.medal.level, ...(viewer.medal.colors ? { colors: viewer.medal.colors } : {}) } } : {}),
        ...(viewer.honor ? { honor: honorOf(viewer.honor, this.d.honor?.urlFor(viewer.honor)) } : {}),
      },
      ...(kind === 'guard' && vars.op ? { guardOp: vars.op } : {}),
      ...(gift ? { gift: { name: vars.gift!, count: vars.count ?? 1, ...(gift.img ? { img: gift.img } : {}), ...(vars.valueGold !== undefined ? { value: vars.valueGold } : {}), ...(gift.fx && style === BILI_GIFT_STYLE ? { fx: gift.fx.fx } : {}) } } : {}),
      ...(test ? { test: true } : {}),
    };
  }

  private enqueue(item: PlayItem, eventId: number | null, jump: boolean, detail: string, undo?: () => void): void {
    // B站动画：排队时就让特效页先下载，轮到时不用现下
    if (item.gift?.fx) this.d.hub.toOverlays({ type: 'preload', preload: [item.gift.fx.src] });
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
      // 排队期间特效页全部掉线：不积压（F-OU-12）
      if (this.d.hub.overlayCount() === 0) {
        this.unplayed(q, 'no_overlay');
        continue;
      }
      this.play(q);
    }
  }

  /** 推给特效页开始播；播放节奏由服务端控制：时长 + 间隔后播下一个，多个特效页始终同步 */
  private play(q: QueueItem<Queued>): void {
    const { item, eventId } = q.payload;
    this.d.hub.toOverlays({ type: 'play', item });
    if (eventId) this.d.log.setStatus(eventId, 'played');
    const timer = setTimeout(() => {
      this.current = null;
      this.guard('播放下一个', () => {
        this.pump();
        this.emitQueue();
      });
    }, item.effect.durationMs + PLAY_GAP_MS);
    this.current = { q, startedAt: this.now(), timer };
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
  /** 发到直播画面测试：effect 可以是还没保存的样子（素材设置里改了一半也能测）；kind / vars 和预览一样 */
  test(effect: number | EffectDto, viewer?: Partial<Viewer>, kind: TriggerKind = 'enter', vars?: Vars): { id: string } {
    if (this.d.settings.get('paused')) throw new HttpError(409, 'paused', '已暂停，恢复后才能测试');
    if (this.d.hub.overlayCount() === 0) throw new HttpError(409, 'no_overlay', '特效页不在线：请先把特效页地址加到直播软件的浏览器源里');
    const e = typeof effect === 'number' ? this.d.effects.get(effect) : effect;
    const v: Viewer = { ...SAMPLE_VIEWER, ...viewer };
    const item = this.playItem(e, v, kind, kind === 'enter' && !vars ? {} : withSample(kind, vars), true);
    // 正在播的也是测试：直接换成新的，不用等它播完（真实观众的特效不打断）
    if (this.current?.q.payload.item.test) this.stopCurrent();
    this.enqueue(item, null, true, '测试播放');
    return { id: item.id };
  }

  /**
   * 素材快捷播放：马上播，打断正在播的。被打断的观众特效放回最前面，播完接着从头播；
   * 被打断的是快捷播放或测试播放时直接换掉。不显示欢迎语，不算进观众统计
   */
  quick(effectId: number): { id: string } {
    if (this.d.settings.get('paused')) throw new HttpError(409, 'paused', '已暂停所有特效，恢复播放后才能用快捷播放');
    if (this.d.hub.overlayCount() === 0) throw new HttpError(409, 'no_overlay', '特效页不在线：请先把特效页地址加到直播软件的浏览器源里');
    const e = this.d.effects.get(effectId, { uses: false });
    const room = this.d.room.get();
    const face = room ? this.d.viewers.cached(room.anchorUid)?.face : undefined;
    const anchor: Viewer = { uid: room?.anchorUid ?? 0, name: room?.anchorName || '主播', guard: 0, isMod: false, mystery: false, ...(face ? { face } : {}) };
    const item: PlayItem = { ...this.playItem({ ...e, showText: false, guardFrame: false, honorBadge: false }, anchor, 'enter'), quick: true };
    const cur = this.current;
    if (cur) {
      this.stopCurrent();
      const it = cur.q.payload.item;
      if (!it.test && !it.quick) this.queue.front(cur.q);
    }
    this.play({ id: item.id, kind: item.kind, enqueuedAt: this.now(), payload: { item, eventId: null, detail: '素材快捷播放' } });
    this.emitQueue();
    return { id: item.id };
  }

  /** 预览：生成播放内容但不入队（后台预览区用，只在本地播放） */
  preview(effect: EffectDto, viewer?: Partial<Viewer>, kind: TriggerKind = 'enter', vars?: Vars): PlayItem {
    const v: Viewer = { ...SAMPLE_VIEWER, ...viewer };
    return this.playItem(effect, v, kind, withSample(kind, vars), true);
  }

  snapshot(): QueueSnapshot {
    const brief = (q: QueueItem<Queued>): QueueBrief => {
      const it = q.payload.item;
      return { id: q.id, kind: q.kind, effectName: it.effect.name, viewerName: it.viewer.name, viewerFace: it.viewer.face ?? null, viewerGuard: it.viewer.guard, detail: q.payload.detail, giftImg: it.gift?.img ?? null, durationMs: it.effect.durationMs, test: Boolean(it.test), quick: Boolean(it.quick) };
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

/** 事件记录里的一行变回礼物、上舰、醒目留言事件（恢复送礼名单用）；格式不对的跳过 */
export function eventFromLog(r: { id: number; ts: number; kind: string; viewer: unknown; payload: unknown }): GiftEvent | GuardEvent | ScEvent | null {
  const viewer = r.viewer as Viewer | null;
  const p = (r.payload ?? {}) as Record<string, unknown>;
  if (!viewer?.name) return null;
  const base = { id: `log-${r.id}`, ts: r.ts, viewer };
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);
  if (r.kind === 'gift') return { ...base, kind: 'gift', giftId: num('giftId'), giftName: String(p.giftName ?? ''), unitPrice: num('unitPrice'), count: num('count') || 1, paid: p.paid !== false, ...(typeof p.icon === 'string' ? { icon: p.icon } : {}) };
  if (r.kind === 'guard') {
    const level = num('level');
    if (level !== 1 && level !== 2 && level !== 3) return null;
    return { ...base, kind: 'guard', level, months: num('months') || 1, op: p.op === 'renew' ? 'renew' : 'open', source: 'toast', ...(num('price') ? { priceGold: num('price') } : {}) };
  }
  if (r.kind === 'sc') return { ...base, kind: 'sc', text: String(p.text ?? ''), priceYuan: num('price'), scId: String(p.scId ?? '') };
  return null;
}
