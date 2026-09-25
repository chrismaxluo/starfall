// 冷却（需求 F-EN-09）。
// - 按分钟：同一条规则 + 同一个人，在冷却时间内不重复播放。只保存在内存里，服务重启后清空（最坏情况多播一次）。
// - 每场一次：同一场直播里同一个人只播一次；换一场直播（场次编号变化）自动重新计算。

export class Cooldowns {
  private readonly until = new Map<string, number>();

  /** 是否仍在冷却中 */
  active(key: string, now: number): boolean {
    const t = this.until.get(key);
    return t !== undefined && now < t;
  }

  /** 记下一次播放，从 now 起冷却 minutes 分钟；0 分钟表示不冷却 */
  hit(key: string, now: number, minutes: number): void {
    if (minutes <= 0) return;
    this.until.set(key, now + minutes * 60_000);
    if (this.until.size > 20_000) this.prune(now);
  }

  clear(): void {
    this.until.clear();
  }

  private prune(now: number): void {
    for (const [k, t] of this.until) if (now >= t) this.until.delete(k);
  }
}

export class OncePerLive {
  private session: string | null = null;
  private readonly played = new Set<number>();

  /** 切换到新的直播场次时清空记录 */
  setSession(session: string | null): void {
    if (session === this.session) return;
    this.session = session;
    this.played.clear();
  }

  has(uid: number): boolean {
    return this.played.has(uid);
  }

  mark(uid: number): void {
    this.played.add(uid);
  }

  /** 服务重启时，用本场事件记录里已播放的 UID 恢复 */
  restore(session: string, uids: Iterable<number>): void {
    this.setSession(session);
    for (const uid of uids) this.played.add(uid);
  }
}
