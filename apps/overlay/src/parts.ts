// 各个特效共用的部件：头像、粉丝牌、身份标签、欢迎语
import type { PlayItem } from '@starfall/shared';
import { GUARD_FRAMES } from '@starfall/shared/overlay';
import { h } from './dom.ts';

type PlayViewer = PlayItem['viewer'];

const AV_GRADS = [
  'linear-gradient(135deg,#E0689B,#9B3D74)',
  'linear-gradient(135deg,#6E6BF2,#3C39B8)',
  'linear-gradient(135deg,#3FB4F6,#2B5FB0)',
  'linear-gradient(135deg,#4FD1BC,#23806F)',
  'linear-gradient(135deg,#F0B45A,#B26A24)',
];

/** 头像：有头像地址用图片（加载失败时换成首字），否则用昵称首字 */
export function avatar(v: PlayViewer, size?: number): HTMLElement {
  const initial = [...(v.name || '?')][0] ?? '?';
  const grad = AV_GRADS[[...v.name].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_GRADS.length]!;
  const el = h('span', { class: 'av', style: { background: grad, ...(size ? { width: `${size}px`, height: `${size}px`, 'font-size': `${Math.round(size * 0.42)}px` } : {}) } }, initial);
  if (v.face) {
    const img = h('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.onload = () => el.replaceChildren(img);
    img.src = thumb(v.face, size ?? 96);
  }
  return el;
}

/** 大航海观众的头像套上 B 站的头像框（框在头像外面一圈，加载失败就只显示头像） */
export function withGuardFrame(av: HTMLElement, guard: number): HTMLElement {
  const url = GUARD_FRAMES[guard as 1 | 2 | 3];
  if (!url) return av;
  const img = h('img', { class: 'av-frame' });
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => img.remove();
  img.src = url;
  return h('span', { class: 'av-framed' }, av, img);
}

/** B 站头像用缩略图（原图可能有上千像素，下载和解码都浪费）；按 2 倍像素取，其他地址原样返回 */
export function thumb(url: string, px: number): string {
  if (!/^https?:\/\/i\d\.hdslb\.com\//.test(url) || url.includes('@')) return url;
  const n = Math.min(512, Math.ceil((px * 2) / 32) * 32);
  return `${url}@${n}w_${n}h.webp`;
}

/** 粉丝牌颜色表（B 站没有下发颜色时使用，与设计预览一致） */
export function fallbackColors(level: number, guard: boolean) {
  const t = level <= 10 ? ['#5762A7', null] : level <= 20 ? ['#C770A4', null] : level <= 30 ? ['#3FB4F6', '#5FC7F4'] : level <= 40 ? ['#4C7DFF', '#58A1F8'] : level <= 50 ? ['#A773F1', '#D47AFF'] : ['#EC4F6E', '#F18087'];
  return { bg: `${t[0]}99`, level: `${t[0]}E6`, border: guard && t[1] ? t[1] : `${t[0]}99`, text: '#FFFFFF' };
}

export function medal(v: PlayViewer): HTMLElement | null {
  const m = v.medal;
  if (!m || m.level <= 0) return null;
  const c = m.colors ?? fallbackColors(m.level, v.guard !== 0);
  return h('span', { class: 'medal', style: { '--mc': c.bg, '--ml': c.level, '--mb': c.border, '--mt': c.text } }, h('span', {}, m.name), h('b', {}, String(m.level)));
}

/**
 * 名字前面放上荣耀等级勋章（和 B 站弹幕里一样放在名字前）：找到特效里的昵称（.name、.nm、宫廷的 .rx-nm），插在它前面。
 * 没有勋章图（不知道等级、B 站的图读不到）就不放；图加载失败时去掉
 */
export function addHonor(root: HTMLElement, v: PlayViewer): void {
  const url = v.honor?.url;
  const nm = url ? root.querySelector<HTMLElement>('.name, .nm, .rx-nm') : null;
  if (!url || !nm) return;
  const img = h('img', { class: 'honor' });
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => img.remove();
  img.src = url;
  // 宫廷的昵称是写出来的动画：勋章跟着昵称一起出现
  if (nm.classList.contains('rx-nm')) {
    img.classList.add('rx-f');
    img.style.setProperty('--d', nm.style.getPropertyValue('--nd') || '0s');
  }
  // 勋章和昵称包在一起：昵称单独占一行的样式（晶礼）里勋章也在同一行
  const pair = h('span', { class: 'honor-nm' });
  nm.replaceWith(pair);
  pair.append(img, nm);
}

/** 把欢迎语按昵称切开：昵称加粗放大，其余部分用小字 */
export function textLine(text: string, name: string): HTMLElement {
  const line = h('span', { class: 'line' });
  const i = name ? text.indexOf(name) : -1;
  if (i < 0) {
    line.append(h('span', { class: 'say' }, text));
    return line;
  }
  const before = text.slice(0, i).trim();
  const after = text.slice(i + name.length).trim();
  if (before) line.append(h('span', { class: 'say' }, before));
  line.append(h('span', { class: 'name' }, name));
  if (after) line.append(h('span', { class: 'say' }, after));
  return line;
}

/** 去掉昵称后剩下的文字（宫廷、玻璃特效把昵称单独放大显示） */
export function textWithoutName(text: string, name: string): string {
  return (name ? text.replace(name, ' ') : text).replace(/\s+/g, ' ').trim();
}
