// 内置样式：星冕、流星、流光、巡场、霜玻、礼物、气泡、一行字（与设计预览一致）
import type { PlayItem } from '@starfall/shared';
import { h, icon, svgPath } from './dom.ts';
import { avatar, identityLabel, medal, textLine, textWithoutName } from './parts.ts';

export interface StageSize {
  width: number;
  height: number;
}

type Builder = (item: PlayItem, stage: StageSize) => HTMLElement;

const card = (cls: string, ...children: Array<Node | null>) => h('div', { class: `fx ${cls}` }, ...children);

const BUILDERS: Record<string, Builder> = {
  line: (it) => card('fx-line', h('i'), textLine(it.text, it.viewer.name)),

  frost: (it) => card('fx-frost glass', avatar(it.viewer), medal(it.viewer), textLine(it.text, it.viewer.name)),

  patrol: (it) => card('fx-patrol glass', icon('g-mod'), h('div', {}, h('div', { class: 'lbl' }, identityLabel(it.viewer)), textLine(it.text, it.viewer.name))),

  flow: (it) => {
    const m = medal(it.viewer);
    return card('fx-flow glass', h('span', { class: 'badge' }, icon('g-cap')), h('div', {}, h('div', { class: 'lbl' }, identityLabel(it.viewer)), textLine(it.text, it.viewer.name), m && h('div', { style: { 'margin-top': '8px' } }, m)));
  },

  gift: (it) => {
    const m = medal(it.viewer);
    return card('fx-flow fx-gift glass', h('span', { class: 'badge' }, icon('g-gift')), h('div', {}, h('div', { class: 'lbl' }, 'Thanks · 感谢'), textLine(it.text, it.viewer.name), m && h('div', { style: { 'margin-top': '8px' } }, m)));
  },

  meteor: (it) => {
    const el = card('fx-meteor glass');
    for (const [x, y, s, d] of [[-18, -26, 30, 0], [520, -34, 22, 0.5], [640, 40, 34, 0.9], [-30, 110, 20, 1.3], [300, -40, 16, 0.3]] as const) {
      el.append(h('span', { class: 'twk', style: { left: `${x}px`, top: `${y}px`, width: `${s}px`, height: `${s}px`, 'animation-delay': `${d}s` } }, icon('spark')));
    }
    const m = medal(it.viewer);
    el.append(h('span', { class: 'badge' }, h('span', {}, icon('g-adm'))), h('div', {}, h('div', { class: 'lbl' }, identityLabel(it.viewer)), textLine(it.text, it.viewer.name), m && h('div', { style: { 'margin-top': '10px' } }, m)));
    return el;
  },

  star: (it, stage) => {
    const el = h('div', { class: 'fx fx-star' }, h('div', { class: 'vig' }), h('div', { class: 'halo' }));
    for (let i = 0; i < 34; i++) {
      const x = stage.width / 2 - 400 + Math.random() * 800;
      const y = stage.height * 0.55 + Math.random() * 300;
      const s = 2 + Math.random() * 3.5;
      el.append(h('span', { class: 'dust', style: { left: `${x.toFixed(0)}px`, top: `${y.toFixed(0)}px`, width: `${s.toFixed(1)}px`, height: `${s.toFixed(1)}px`, 'animation-duration': `${(3 + Math.random() * 2.5).toFixed(2)}s`, 'animation-delay': `${(0.6 + Math.random() * 3.2).toFixed(2)}s` } }));
    }
    const hasName = Boolean(it.viewer.name) && it.text.includes(it.viewer.name);
    const say = hasName ? textWithoutName(it.text, it.viewer.name) : it.text;
    el.append(
      h(
        'div',
        { class: 'core' },
        svgPath('0 0 24 18', 'M2 16.5h20M3 14L2 3l6 4.5L12 1l4 6.5L22 3l-1 11z', 'crown'),
        h('div', { class: 'lbl' }, identityLabel(it.viewer)),
        hasName ? h('div', { class: 'name' }, it.viewer.name) : null,
        h('div', { class: 'rule' }),
        say ? h('div', { class: 'say' }, say) : null,
      ),
    );
    return el;
  },

  bubble: (it) => card('fx-bubble glass', avatar(it.viewer), textLine(it.text, it.viewer.name)),
};

/** 这个样式是否占满整个画面（不按位置摆放） */
export const isFullStage = (style: string) => style === 'star';

export function buildBuiltin(item: PlayItem, style: string, stage: StageSize): HTMLElement {
  return (BUILDERS[style] ?? BUILDERS.line!)(item, stage);
}
