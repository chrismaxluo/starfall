// 判断一个事件能不能播（需求 F-RU-06、方案设计 5.5）。按固定顺序检查，第一个不通过的就是记录下来的原因。
import type { PlayStatus } from '@starfall/shared';

export interface DecideInput {
  blocked: boolean;
  matched: boolean;
  paused: boolean;
  live: boolean;
  /** 未开播时是否照常播放（排练模式） */
  playWhenOffline: boolean;
  /** 按分钟的冷却是否还在进行中 */
  inCooldown: boolean;
  /** 每场一次模式下，本场是否已经播过 */
  playedThisLive: boolean;
  overlayOnline: boolean;
}

export type Decision = { play: true } | { play: false; status: Exclude<PlayStatus, 'played' | 'queued' | 'dropped' | 'duplicate'> };

export function decide(i: DecideInput): Decision {
  if (i.blocked) return { play: false, status: 'blacklist' };
  if (!i.matched) return { play: false, status: 'no_rule' };
  if (i.paused) return { play: false, status: 'paused' };
  if (!i.live && !i.playWhenOffline) return { play: false, status: 'offline' };
  if (i.playedThisLive) return { play: false, status: 'once' };
  if (i.inCooldown) return { play: false, status: 'cooldown' };
  if (!i.overlayOnline) return { play: false, status: 'no_overlay' };
  return { play: true };
}
