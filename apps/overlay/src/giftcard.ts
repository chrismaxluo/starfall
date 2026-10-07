// 礼物卡片（晶礼、晶耀）：按价值换颜色（和 B站连击条一样：蓝 → 紫 → 粉 → 金）。晶礼的礼物图后面转着光芒，送出时迸出星光碎片。
// 晶礼是角落里的一条（热闹）；晶耀是一块简洁的横向卡片（深色底、细金线、礼物大图），不挡主播
import type { PlayItem } from '@starfall/shared/overlay';
import './giftcard.css';
import { h } from './dom.ts';
import { count, countSec, giftImg, restWithGift } from './glass.ts';
import { avatar } from './parts.ts';


/** 价值分档的颜色（金瓜子）：B站连击条的四种颜色 */
const TIERS: Array<{ from: number; c1: string; c2: string; c3: string }> = [
  { from: 100_000, c1: '#FF9D00', c2: '#FFD400', c3: '#FFF1B8' },
  { from: 50_000, c1: '#FF49A1', c2: '#FF7AB6', c3: '#FFD3E8' },
  { from: 10_000, c1: '#9F66FF', c2: '#6FACFE', c3: '#E2D4FF' },
  { from: 0, c1: '#3D8BFF', c2: '#62C6FF', c3: '#D3ECFF' },
];
const tier = (value: number) => TIERS.find((t) => value >= t.from)!;
const colors = (item: PlayItem) => {
  const t = tier(item.gift?.value ?? 0);
  return { '--c1': t.c1, '--c2': t.c2, '--c3': t.c3, '--dur': `${item.effect.durationMs}ms` };
};

/** 迸出去的碎片：n 个，方向均匀分布再加一点随机，距离、大小、形状、延迟各不相同 */
function burst(cls: string, n: number, dist: [number, number], delay: number): HTMLElement {
  const box = h('div', { class: cls });
  for (let i = 0; i < n; i++) {
    const a = ((i + Math.random() * 0.6) / n) * Math.PI * 2;
    const r = dist[0] + Math.random() * (dist[1] - dist[0]);
    const shape = ['star', 'dot', 'bit'][i % 3]!;
    box.append(
      h('i', {
        class: `${shape} k${i % 3}`,
        style: {
          '--dx': `${Math.round(Math.cos(a) * r)}px`,
          '--dy': `${Math.round(Math.sin(a) * r)}px`,
          '--rot': `${Math.round(Math.random() * 540 - 270)}deg`,
          '--s': (0.6 + Math.random() * 0.8).toFixed(2),
          '--d': `${(delay + Math.random() * 0.12).toFixed(2)}s`,
        },
      }),
    );
  }
  return box;
}

/** 晶礼：角落里的一条 */
export function giftStrip(item: PlayItem): HTMLElement {
  const n = item.gift?.count ?? 1;
  const img = giftImg(item, 'gc-img');
  return h(
    'div',
    { class: `fx gc${img ? '' : ' no-img'}`, style: colors(item) },
    h('div', { class: 'gc-bar' }, h('div', { class: 'gc-sheen' }), avatar(item.viewer), h('div', { class: 'gc-tx' }, h('span', { class: 'nm' }, item.viewer.name), h('span', { class: 'say' }, ...restWithGift(item)))),
    img ? h('div', { class: 'gc-gift' }, h('div', { class: 'gc-rays' }), h('div', { class: 'gc-glow' }), img, burst('gc-burst', 14, [70, 150], 0.45)) : null,
    item.gift ? h('div', { class: 'gc-num', style: { '--pd': `${0.75 + countSec(n)}s` } }, h('small', {}, '×'), count(n, 0.75)) : null,
  );
}

/** 晶耀：一块横向的扁卡片，像节目下方的字幕条（深色底、上下细金线、礼物大图在左），不挡主播 */
export function giftHero(item: PlayItem, stage: { width: number; height: number; fxz?: number }): HTMLElement {
  const landscape = stage.width > stage.height;
  const zoom = (stage.fxz ?? Math.min(1, Math.min(stage.width, stage.height) / 1080)) * (landscape ? 0.8 : 1);
  const n = item.gift?.count ?? 1;
  const img = giftImg(item, 'gb-img');
  const card = h(
    'div',
    { class: `gb-card${img ? '' : ' no-img'}` },
    h('i', { class: 'gb-line top' }),
    h('i', { class: 'gb-line bot' }),
    h('div', { class: 'gb-sheen' }),
    img ? h('div', { class: 'gb-gift' }, h('div', { class: 'gb-glow' }), img) : null,
    h(
      'div',
      { class: 'gb-tx' },
      h('div', { class: 'gb-lbl' }, 'THANK YOU'),
      h('div', { class: 'gb-who' }, avatar(item.viewer), h('span', { class: 'nm' }, item.viewer.name)),
      h('div', { class: 'gb-say' }, ...restWithGift(item), n > 1 ? h('span', { class: 'gb-num' }, ' ×', count(n, 1.4)) : null),
    ),
  );
  const pos = landscape ? 'center' : item.effect.position;
  return h('div', { class: `fx gb at-${pos}`, style: { ...colors(item), '--rz': String(zoom) } }, card);
}

/** 晶礼、晶耀的样式名 */
export const GIFT_STYLES: Record<string, (item: PlayItem, stage: { width: number; height: number; fxz?: number }) => HTMLElement> = {
  'glass-gift': giftStrip,
  'glass-big': giftHero,
};
