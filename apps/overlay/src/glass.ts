// 玻璃质感：房管进场、弹幕回应（礼物卡片在 giftcard.ts）；giftImg、count 等也给礼物卡片用。与 design/preview/fx-glass.html 一致。
// 动画都加在玻璃本身上：外层元素做透明度动画时，浏览器会让里面的毛玻璃失效（只剩半透明）。
import type { PlayItem } from '@starfall/shared/overlay';
import './glass.css';
import { h } from './dom.ts';
import { avatar, textWithoutName } from './parts.ts';


/** 各样式的点缀色：只用在描边末端、左侧柔光、头像外圈 */
const ACC = { mod: '#3DD6C1', dm: '#7CC7FF' } as const;

const SHIELD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>';

/** 一块玻璃：点缀色 + 裁在里面的柔光和反光层 */
function glass(cls: string, acc: string, dur: number, ...children: Array<Node | null>): HTMLElement {
  return h('div', { class: `fx g ${cls}`, style: { '--acc': acc, '--dur': `${dur}ms` } }, h('div', { class: 'gl' }), ...children);
}

export function giftImg(item: PlayItem, cls: string): HTMLElement | null {
  const src = item.gift?.img;
  if (!src) return null;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.src = src;
  return h('div', { class: cls }, img);
}

/** 从 1 数到 n 用多久（秒） */
export const countSec = (n: number) => (n > 1 ? Math.min(1.2, 0.4 + n / 400) : 0.01);

/** 数量从 1 数到实际数量（不支持 @property 的内核直接显示最终数字） */
export function count(n: number, delaySec: number): HTMLElement {
  const el = h('span', { class: 'cnt', style: { '--to': String(n), '--d': `${delaySec}s`, '--t': `${countSec(n)}s` } });
  el.dataset.n = String(n);
  return el;
}

/** 欢迎语去掉昵称后剩下的部分，例如"送出 小花花"、"前来巡场" */
const rest = (item: PlayItem) => textWithoutName(item.text, item.viewer.name);

/** 同上，礼物名加粗 */
export function restWithGift(item: PlayItem): Array<string | HTMLElement> {
  const r = rest(item);
  const g = item.gift?.name;
  const i = g ? r.indexOf(g) : -1;
  return i < 0 ? [r] : [r.slice(0, i), h('b', {}, g!), r.slice(i + g!.length)];
}

function mod(item: PlayItem): HTMLElement {
  const chip = h('span', { class: 'chip', style: { '--acc': ACC.mod } });
  chip.innerHTML = `${SHIELD}房管`;
  return glass(
    'gx-card life',
    ACC.mod,
    item.effect.durationMs,
    avatar(item.viewer),
    h('div', { class: 'tx' }, h('div', { class: 'l1' }, chip), h('div', { class: 'l1' }, h('span', { class: 'nm' }, item.viewer.name), h('span', { class: 'say' }, rest(item)))),
  );
}

function danmu(item: PlayItem): HTMLElement {
  const name = item.viewer.name;
  const i = name ? item.text.indexOf(name) : -1;
  // 模板一般是"{name}：{text}"：昵称单独上色，后面的冒号和内容作为正文
  const after = i < 0 ? item.text : item.text.slice(i + name.length).replace(/^\s*[：:]\s*/, '');
  return glass(
    'gx-dm life',
    ACC.dm,
    item.effect.durationMs,
    avatar(item.viewer),
    i < 0 ? null : h('span', { class: 'nm' }, `${name}：`),
    h('span', { class: 'say' }, after),
  );
}

type Builder = (item: PlayItem, stage: { width: number; height: number; fxz?: number }) => HTMLElement;

export const GLASS_STYLES: Record<string, Builder> = {
  'glass-mod': mod,
  'glass-dm': danmu,
};

/** 占满整个画布、自己决定位置的样式 */
export const GLASS_FULL = new Set(['glass-big']);
