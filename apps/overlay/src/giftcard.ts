// 礼物卡片（晶礼、晶耀）：按价值换颜色（和 B站连击条一样：蓝 → 紫 → 粉 → 金）。晶礼的礼物图后面转着光芒，送出时迸出星光碎片。
// 晶礼、晶耀都是角落里的一条，晶耀碎片多一些
import type { PlayItem } from '@starfall/shared/overlay';
import './giftcard.css';
import { h } from './dom.ts';
import { count, countSec, giftImg, restWithGift } from './glass.ts';
import { avatar, withGuardFrame } from './parts.ts';
import { guardTier, tierOf, tierVars } from './tiers.ts';


/** 大航海成员送的按身份配色（舰长蓝、提督紫、总督红金），其他人按价值 */
const colors = (item: PlayItem) => ({ ...tierVars(item.viewer.guard ? guardTier(item.viewer.guard) : tierOf(item.gift?.value ?? 0)), '--dur': `${item.effect.durationMs}ms` });

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

/** 晶礼：角落里的一条；big 是晶耀（碎片多一些） */
export function giftStrip(item: PlayItem, big = false): HTMLElement {
  const n = item.gift?.count ?? 1;
  const img = giftImg(item, 'gc-img');
  return h(
    'div',
    { class: `fx gc${img ? '' : ' no-img'}${big ? ' big' : ''}`, style: colors(item) },
    // 大航海送的礼物：头像套上 B站的头像框
    h('div', { class: 'gc-bar' }, h('div', { class: 'gc-sheen' }), withGuardFrame(avatar(item.viewer), item.viewer.guard), h('div', { class: 'gc-tx' }, h('span', { class: 'nm' }, item.viewer.name), h('span', { class: 'say' }, ...restWithGift(item)))),
    img ? h('div', { class: 'gc-gift' }, h('div', { class: 'gc-rays' }), h('div', { class: 'gc-glow' }), img, burst('gc-burst', big ? 22 : 14, big ? [90, 200] : [70, 150], 0.45)) : null,
    item.gift ? h('div', { class: 'gc-num', style: { '--pd': `${0.75 + countSec(n)}s` } }, h('small', {}, '×'), count(n, 0.75)) : null,
  );
}

/** 晶耀：和晶礼同一个样子、一样大，碎片多一些（100 元以上本来就是金色那一档） */
export function giftHero(item: PlayItem): HTMLElement {
  return giftStrip(item, true);
}

/** 晶礼、晶耀的样式名 */
export const GIFT_STYLES: Record<string, (item: PlayItem) => HTMLElement> = {
  'glass-gift': giftStrip,
  'glass-big': giftHero,
};
