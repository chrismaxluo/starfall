// 礼物卡片（晶礼、晶耀）：按价值换颜色（和 B站连击条一样：蓝 → 紫 → 粉 → 金），礼物图后面转着光芒，送出时迸出星光和彩色碎片。
// 晶礼是角落里的一条，晶耀占满画面：礼物落下炸开、光环扩散，下面一条丝带写着谁送的
import type { PlayItem } from '@starfall/shared/overlay';
import './giftcard.css';
import { h } from './dom.ts';
import { count, countSec, giftImg, restWithGift } from './glass.ts';
import { avatar } from './parts.ts';

type Position = PlayItem['effect']['position'];

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

/** 大额礼物的中心位置（画布高度的百分比）：偏上 / 居中 / 偏下 */
const HERO_Y: Record<Position, number> = { top: 36, center: 44, bl: 50, br: 50 };

/** 迸出去的碎片：n 个，方向均匀分布再加一点随机，距离、大小、形状、延迟各不相同 */
function burst(cls: string, n: number, dist: [number, number], delay: number): HTMLElement {
  const box = h('div', { class: cls });
  for (let i = 0; i < n; i++) {
    const a = ((i + Math.random() * 0.6) / n) * Math.PI * 2;
    const r = dist[0] + Math.random() * (dist[1] - dist[0]);
    const shape = ['star', 'dot', 'bit'][i % 3]!;
    box.append(
      h('i', {
        class: `${shape} k${i % (cls === 'gb-burst' ? 5 : 3)}`,
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

/** 晶耀：占满画面 */
export function giftHero(item: PlayItem, stage: { width: number; height: number; fxz?: number }): HTMLElement {
  const landscape = stage.width > stage.height;
  const zoom = (stage.fxz ?? Math.min(1, Math.min(stage.width, stage.height) / 1080)) * (landscape ? 0.8 : 1);
  const n = item.gift?.count ?? 1;
  const img = giftImg(item, 'gb-img');
  const sparkles = h('div', { class: 'gb-twinkle' });
  for (let i = 0; i < 10; i++) {
    sparkles.append(h('i', { style: { '--x': `${Math.round(Math.random() * 760 - 380)}px`, '--y': `${Math.round(Math.random() * 520 - 330)}px`, '--d': `${(0.9 + Math.random() * 2.2).toFixed(2)}s`, '--s': (0.5 + Math.random() * 0.8).toFixed(2) } }));
  }
  const hero = h(
    'div',
    { class: `gb-hero${img ? '' : ' no-img'}`, style: { '--rz': String(zoom) } },
    img ? h('div', { class: 'gb-stage' }, h('div', { class: 'gb-rays' }), h('div', { class: 'gb-ring r1' }), h('div', { class: 'gb-ring r2' }), h('div', { class: 'gb-ring r3' }), h('div', { class: 'gb-glow' }), burst('gb-burst', 30, [200, 420], 0.75), img) : null,
    sparkles,
    h(
      'div',
      { class: 'gb-ribbon' },
      h('div', { class: 'gb-band' }, h('div', { class: 'gb-sheen' })),
      h('div', { class: 'gb-lbl' }, '感谢'),
      h('div', { class: 'gb-who' }, avatar(item.viewer), h('span', { class: 'nm' }, item.viewer.name)),
      h('div', { class: 'gb-say' }, ...restWithGift(item), n > 1 ? h('span', { class: 'gb-num' }, ' ×', count(n, 1.9)) : null),
    ),
  );
  const hy = landscape ? 48 : HERO_Y[item.effect.position];
  return h('div', { class: 'fx gb', style: { ...colors(item), '--hy': `${hy}%` } }, h('div', { class: 'gb-dim' }), hero);
}

/** 晶礼、晶耀的样式名 */
export const GIFT_STYLES: Record<string, (item: PlayItem, stage: { width: number; height: number; fxz?: number }) => HTMLElement> = {
  'glass-gift': giftStrip,
  'glass-big': giftHero,
};
