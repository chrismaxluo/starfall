// 进场合并（需求 F-EN-10）。B 站对同一次进场可能推送两条消息：
// - ENTRY_EFFECT：带进场特效的进场（大航海、高财富等级等）。实测总是先到，但没有粉丝牌信息。
// - INTERACT_WORD_V2：信息完整。实测比 ENTRY_EFFECT 晚 0 ~ 1.5 秒（中位 1.3 秒）；也有只收到 ENTRY_EFFECT 的情况。
//
// 处理方式：
// - INTERACT_WORD_V2 到达：如果有同一个人等待中的 ENTRY_EFFECT，合并后立即输出；否则直接输出。
// - ENTRY_EFFECT 到达：先等待 holdMs，期间同一个人的 INTERACT_WORD_V2 到了就合并；没到就单独输出。
// - 同一个人在 windowMs 内已经输出过，后来的消息丢弃。
// 这是纯逻辑：调用方需要定期调用 flush(now) 取出等待超时的事件。
import type { EnterEvent, GuardLevel } from '@starfall/shared';

// 实测 INTERACT_WORD_V2 最晚比 ENTRY_EFFECT 晚 1.5 秒，再加上定时取出的间隔（0.2 秒），留足余量
export const ENTER_HOLD_MS = 2000;
export const ENTER_WINDOW_MS = 3000;

/** 大航海等级取较高的一个（1 总督最高，0 表示无） */
function higherGuard(a: GuardLevel, b: GuardLevel): GuardLevel {
  if (a === 0) return b;
  if (b === 0) return a;
  return (Math.min(a, b) as GuardLevel);
}

export function mergeEnter(full: EnterEvent, effect: EnterEvent): EnterEvent {
  return {
    ...full,
    viewer: {
      ...full.viewer,
      name: full.viewer.name || effect.viewer.name,
      ...(full.viewer.face || effect.viewer.face ? { face: full.viewer.face || effect.viewer.face } : {}),
      guard: higherGuard(full.viewer.guard, effect.viewer.guard),
      isMod: full.viewer.isMod || effect.viewer.isMod,
      ...(full.viewer.honor || effect.viewer.honor ? { honor: Math.max(full.viewer.honor ?? 0, effect.viewer.honor ?? 0) } : {}),
    },
  };
}

export class EnterMerger {
  private readonly holdMs: number;
  private readonly windowMs: number;
  private readonly pending = new Map<number, { ev: EnterEvent; at: number }>();
  private readonly emitted = new Map<number, number>();

  constructor(holdMs = ENTER_HOLD_MS, windowMs = ENTER_WINDOW_MS) {
    this.holdMs = holdMs;
    this.windowMs = windowMs;
  }

  /** 放入一条进场消息，返回现在就可以处理的事件（0 或 1 个） */
  push(ev: EnterEvent, now: number): EnterEvent[] {
    const uid = ev.viewer.uid;
    const last = this.emitted.get(uid);
    if (last !== undefined && now - last < this.windowMs) return [];

    if (ev.source === 'entry_effect') {
      if (!this.pending.has(uid)) this.pending.set(uid, { ev, at: now });
      return [];
    }
    const waiting = this.pending.get(uid);
    this.pending.delete(uid);
    return [this.emit(waiting ? mergeEnter(ev, waiting.ev) : ev, now)];
  }

  /** 取出等待超时、需要单独处理的 ENTRY_EFFECT */
  flush(now: number): EnterEvent[] {
    const out: EnterEvent[] = [];
    for (const [uid, p] of this.pending) {
      if (now - p.at >= this.holdMs) {
        this.pending.delete(uid);
        out.push(this.emit(p.ev, now));
      }
    }
    if (this.emitted.size > 5000) for (const [uid, t] of this.emitted) if (now - t >= this.windowMs) this.emitted.delete(uid);
    return out;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private emit(ev: EnterEvent, now: number): EnterEvent {
    this.emitted.set(ev.viewer.uid, now);
    return ev;
  }
}
