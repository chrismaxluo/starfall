// 进场去重（需求 F-EN-10）：大航海等观众进场时，B 站会同时推送 INTERACT_WORD_V2 和 ENTRY_EFFECT，
// 同一个 UID 在时间窗口内只处理第一条。

export const ENTER_DEDUPE_WINDOW_MS = 3000;

export class EnterDeduper {
  private readonly windowMs: number;
  private readonly seen = new Map<number, number>();

  constructor(windowMs = ENTER_DEDUPE_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** 返回 true 表示这是新的进场，需要处理；false 表示重复，应忽略 */
  accept(uid: number, now: number): boolean {
    const last = this.seen.get(uid);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.set(uid, now);
    if (this.seen.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [uid, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(uid);
  }
}
