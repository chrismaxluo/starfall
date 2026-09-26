// 礼物连击合并（需求 F-GF-04）与上舰消息去重。都是纯逻辑，调用方定期调用 flush(now)。
import type { GiftEvent, GuardEvent } from '@starfall/shared';

/** 连击最长合并多久（防止一直连击时迟迟不播） */
const MAX_HOLD_MS = 30_000;

/**
 * 同一人在 windowMs 内连续送同一种礼物，合并成一次：数量相加，时间和编号取第一次。
 * 每来一次都会把等待时间往后推，直到 windowMs 内没有新的连击（或累计超过 30 秒）才输出。
 */
export class GiftComboMerger {
  windowMs: number;
  enabled: boolean;
  private readonly pending = new Map<string, { ev: GiftEvent; first: number; last: number }>();

  constructor(windowMs = 3000, enabled = true) {
    this.windowMs = windowMs;
    this.enabled = enabled;
  }

  push(ev: GiftEvent, now: number): GiftEvent[] {
    if (!this.enabled) return [ev];
    const key = `${ev.viewer.uid}:${ev.giftId}`;
    const p = this.pending.get(key);
    if (p) {
      p.ev = { ...p.ev, count: p.ev.count + ev.count, viewer: { ...p.ev.viewer, ...ev.viewer } };
      p.last = now;
      if (now - p.first >= MAX_HOLD_MS) {
        this.pending.delete(key);
        return [p.ev];
      }
      return [];
    }
    this.pending.set(key, { ev: { ...ev }, first: now, last: now });
    return [];
  }

  flush(now: number): GiftEvent[] {
    const out: GiftEvent[] = [];
    for (const [key, p] of this.pending) {
      if (now - p.last >= this.windowMs || now - p.first >= MAX_HOLD_MS) {
        this.pending.delete(key);
        out.push(p.ev);
      }
    }
    return out;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

/**
 * 一次上舰 B 站会推送 USER_TOAST_MSG_V2、USER_TOAST_MSG、GUARD_BUY 三条：
 * - 两条 toast 带同一个支付流水号，按流水号去重；
 * - GUARD_BUY 没有流水号、也分不出开通 / 续费：先等 holdMs，期间同一人同等级的 toast 到了就丢弃它；没到才单独输出。
 */
export class GuardDeduper {
  private readonly holdMs: number;
  private readonly windowMs: number;
  private readonly seenKeys = new Map<string, number>();
  private readonly seenBuyer = new Map<string, number>();
  private readonly pending = new Map<string, { ev: GuardEvent; at: number }>();
  /** GUARD_BUY 等不到 toast、已经单独输出的购买：之后晚到的 toast 是同一次购买，丢弃 */
  private readonly buyEmitted = new Map<string, number>();

  constructor(holdMs = 3000, windowMs = 60_000) {
    this.holdMs = holdMs;
    this.windowMs = windowMs;
  }

  push(ev: GuardEvent, now: number): GuardEvent[] {
    const buyer = `${ev.viewer.uid}:${ev.level}`;
    if (ev.source === 'toast') {
      if (ev.dedupeKey && this.seenKeys.has(ev.dedupeKey)) return [];
      const byBuy = this.buyEmitted.get(buyer);
      if (byBuy !== undefined && now - byBuy < this.windowMs) {
        this.buyEmitted.delete(buyer);
        if (ev.dedupeKey) this.seenKeys.set(ev.dedupeKey, now);
        return [];
      }
      const recent = this.seenBuyer.get(buyer);
      if (!ev.dedupeKey && recent !== undefined && now - recent < this.windowMs) return [];
      if (ev.dedupeKey) this.seenKeys.set(ev.dedupeKey, now);
      this.seenBuyer.set(buyer, now);
      this.pending.delete(buyer);
      return [ev];
    }
    const recent = this.seenBuyer.get(buyer);
    if (recent !== undefined && now - recent < this.windowMs) return [];
    if (!this.pending.has(buyer)) this.pending.set(buyer, { ev, at: now });
    return [];
  }

  flush(now: number): GuardEvent[] {
    const out: GuardEvent[] = [];
    for (const [buyer, p] of this.pending) {
      if (now - p.at >= this.holdMs) {
        this.pending.delete(buyer);
        this.seenBuyer.set(buyer, now);
        this.buyEmitted.set(buyer, now);
        out.push(p.ev);
      }
    }
    for (const m of [this.seenKeys, this.seenBuyer, this.buyEmitted]) for (const [k, t] of m) if (now - t >= this.windowMs) m.delete(k);
    return out;
  }
}
