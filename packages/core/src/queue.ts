// 播放队列（需求 F-PL-01 ~ 04）：全局一个队列，按优先级、先来后到依次播放。
import type { TriggerKind } from '@starfall/shared';

/** 优先级：上舰 > 礼物 > 进场 > 弹幕 */
export const PRIORITY: Record<TriggerKind, number> = { guard: 3, gift: 2, enter: 1, danmu: 0 };

export interface QueueItem<T = unknown> {
  id: string;
  kind: TriggerKind;
  enqueuedAt: number;
  /** 插队项直接排到队首（高价值事件） */
  jump?: boolean;
  payload: T;
}

export interface EnqueueResult<T> {
  /** 因为队列已满被丢弃的项（可能就是刚加入的这一项） */
  dropped: QueueItem<T> | null;
}

export class PlayQueue<T = unknown> {
  private items: Array<QueueItem<T>> = [];
  max: number;

  constructor(max = 10) {
    this.max = max;
  }

  get size(): number {
    return this.items.length;
  }

  list(): ReadonlyArray<QueueItem<T>> {
    return this.items;
  }

  enqueue(item: QueueItem<T>): EnqueueResult<T> {
    this.items.push(item);
    this.items.sort(compare);
    let dropped: QueueItem<T> | null = null;
    if (this.items.length > this.max) {
      // 丢弃优先级最低中最早进入的一项；插队项不会被丢弃
      let victim = -1;
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i]!;
        if (it.jump) continue;
        const v = victim === -1 ? undefined : this.items[victim]!;
        if (!v || PRIORITY[it.kind] < PRIORITY[v.kind] || (PRIORITY[it.kind] === PRIORITY[v.kind] && it.enqueuedAt < v.enqueuedAt)) victim = i;
      }
      if (victim !== -1) dropped = this.items.splice(victim, 1)[0]!;
    }
    return { dropped };
  }

  next(): QueueItem<T> | undefined {
    return this.items.shift();
  }

  /** 清空队列，返回被清掉的项（用于记录） */
  clear(): Array<QueueItem<T>> {
    const all = this.items;
    this.items = [];
    return all;
  }
}

function compare(a: QueueItem, b: QueueItem): number {
  if (!!a.jump !== !!b.jump) return a.jump ? -1 : 1;
  const p = PRIORITY[b.kind] - PRIORITY[a.kind];
  if (p !== 0) return p;
  return a.enqueuedAt - b.enqueuedAt;
}
