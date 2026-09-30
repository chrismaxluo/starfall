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
