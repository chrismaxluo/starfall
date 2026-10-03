// 事件的文字说明（实时动态、事件记录）
import { PLAY_STATUS } from '@starfall/shared/labels';
import type { EventDto, PlayStatus } from './types.ts';

export const EV_ICON: Record<EventDto['kind'], { text: string; bg: string }> = {
  enter: { text: '进', bg: 'var(--accent)' },
  danmu: { text: '弹', bg: '#4C6FE0' },
  gift: { text: '礼', bg: 'linear-gradient(135deg,#FFB38A,#E0568F)' },
  guard: { text: '舰', bg: 'var(--cap)' },
  sc: { text: 'SC', bg: 'linear-gradient(135deg,#F0B45A,#E0568F)' },
};

export const GUARD_NAME: Record<number, string> = { 1: '总督', 2: '提督', 3: '舰长' };

export function describe(e: EventDto): string {
  const p = e.payload ?? {};
  switch (e.kind) {
    case 'enter':
      return '进场';
    case 'danmu':
      return `「${p.text ?? ''}」`;
    case 'gift':
      return `送出 ${p.giftName ?? '礼物'} ×${p.count ?? 1}`;
    case 'guard':
      return `${p.op === 'renew' ? '续费' : '开通'}${GUARD_NAME[p.level ?? 3] ?? '大航海'} ${p.months ?? 1} 个月${p.price ? ` · ${Math.round(p.price / 100) / 10} 元` : ''}`;
    case 'sc':
      return `醒目留言 ${p.price ?? 0} 元「${p.text ?? ''}」`;
  }
}

export const statusText = (s: PlayStatus) => PLAY_STATUS[s] ?? s;

/** 状态标签的颜色 */
export function statusCls(s: PlayStatus): 'ok' | 'skip' | 'warn' | 'bad' {
  if (s === 'played' || s === 'queued') return 'ok';
  if (s === 'blacklist') return 'bad';
  if (s === 'paused' || s === 'no_overlay' || s === 'dropped') return 'warn';
  return 'skip';
}

/** 为什么没播：鼠标停在状态上时显示的大白话说明 */
export const STATUS_WHY: Partial<Record<PlayStatus, string>> = {
  no_rule: '没有符合的规则，或者对应的规则关着',
  blacklist: '这位观众在黑名单里，不会触发任何特效',
  paused: '当时点了「暂停所有特效」',
  offline: '当时没开播；想在没开播时也播放，到「设置 → 播放」打开「照常播放（排练用）」',
  cooldown: '同一个人在「多久内只播一次」的时间里又来了，这次没播',
  once: '开着「每场直播只播一次」，这场已经给 TA 播过了',
  no_overlay: '当时直播软件里的特效页没连上，观众看不到特效',
  dropped: '排队的特效太多，超过了上限，这条被挤掉了（可以在总览的「排队设置」里调）',
  cleared: '暂停或清空排队时，这条还没轮到',
  duplicate: 'B站把同一件事发了好几条消息，只算一次',
};

/** 筛选「为什么没播」的选项 */
export const WHY_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'no_rule', label: '未命中规则' },
  { value: 'cooldown,once', label: '冷却中 / 本场已播过' },
  { value: 'no_overlay', label: '特效页不在线' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'offline', label: '未开播' },
  { value: 'paused,cleared', label: '已暂停 / 已清空' },
  { value: 'dropped', label: '队列已满，丢弃' },
];
