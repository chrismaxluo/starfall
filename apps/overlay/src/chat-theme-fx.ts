// 弹幕列表主题外观的进场动画。每种外观一套：
// 果冻玻璃像果冻掉下来（压扁、弹起、晃两下）；青花瓷头像框像小盘子转着落下来、浪纹晕开、印章盖下去；奶油贴纸像贴纸「啪」地拍上去；
// 星月夜空一颗光点绕框一圈把框点亮、星星聚过来；像素小屋所有动作一跳一跳（约 15 帧/秒）。
// 小八：进场第一秒放大挡在框中间做个小动作，再跳到头像右下角（「一直在右下角」时从头像后面探出来）。
// 大航海、主播的专属效果同一个人 3 分钟内只放一次。动画只改位移、缩放、旋转、透明度，直播姬旧内核也跑得动
import type { ChatItem, OverlayConfig } from '@starfall/shared/overlay';
import { ACT_FX, actKeyframes, fxSprites, geo, glowScale, meteorSvg, nightLight, nightMain, plusSprite, porcelainTrim, svgUrl, traceSvg, JT } from './chat-theme-art.ts';
import type { FxKind, Geo, Sprite, ThemeLook, Tier } from './chat-theme-art.ts';
import type { ThemedRow } from './chat-theme.ts';
import { h } from './dom.ts';

const OUT = 'cubic-bezier(.2,.9,.3,1)';
const px = (n: number) => `${+n.toFixed(2)}px`;
const f = (n: number) => +n.toFixed(2);
let pixelLook = false;
/** 像素小屋：所有动作都按大约 15 帧/秒一跳一跳地走（像老游戏机），不走平滑曲线 */
export const stepEasing = (look: ThemeLook | 'glass', dur: number, easing: string) => (look === 'pixel' ? `steps(${Math.max(2, Math.round(dur / 66))}, end)` : easing);
function anim(el: Element, kf: Keyframe[], o: KeyframeAnimationOptions): Animation {
  const dur = typeof o.duration === 'number' ? o.duration : 300;
  return el.animate(kf, { fill: 'backwards', ...o, easing: pixelLook ? stepEasing('pixel', dur, '') : (o.easing ?? 'linear') });
}
function box<T extends HTMLElement>(el: T, x: number, y: number, w: number, hh = w): T {
  el.style.left = px(x); el.style.top = px(y); el.style.width = px(w); el.style.height = px(hh);
  return el;
}
function fxImg(s: Sprite): HTMLImageElement {
  const im = h('img', { class: s.px ? 'fx px' : 'fx' });
  im.alt = '';
  im.src = svgUrl(s.svg);
  return im;
}

interface Ctx { el: ThemedRow; look: ThemeLook; k: number; right: boolean; G: Geo; tier: Tier }

/** 撒一把小东西：从 (x, y) 往外飞，转着淡出（像素图不转，不然就不是像素了） */
function burst(c: Ctx, kind: FxKind, x: number, y: number, n: number, spread: [number, number], dist: [number, number], delay: number): void {
  const srcs = fxSprites(c.look, kind), pxl = c.look === 'pixel';
  for (let i = 0; i < n; i++) {
    const s = (kind === 'bang' ? 24 : 15 + Math.random() * 13) * c.k * (kind !== 'bang' ? glowScale(c.look) : 1);
    const im = fxImg(srcs[i % srcs.length]!);
    const a = ((spread[0] + (spread[1] - spread[0]) * (n > 1 ? i / (n - 1) : 0.5) + (Math.random() - 0.5) * 16) * Math.PI) / 180;
    const d = (dist[0] + Math.random() * (dist[1] - dist[0])) * c.k, dx = Math.cos(a) * d * (c.right ? -1 : 1), dy = Math.sin(a) * d;
    box(im, (c.right ? c.el.offsetWidth - x : x) - s / 2, y - s / 2, s, kind === 'bang' ? s * (pxl ? 2.5 : 2) : s);
    c.el.append(im);
    const rot = pxl ? 0 : (Math.random() - 0.5) * 120;
    anim(im, [
      { opacity: 0, transform: 'translate(0,0) scale(.2) rotate(0deg)' },
      { opacity: 1, transform: `translate(${f(dx * 0.6)}px,${f(dy * 0.6)}px) scale(1.1) rotate(${f(rot * 0.6)}deg)`, offset: 0.35 },
      { opacity: 1, transform: `translate(${f(dx * 0.9)}px,${f(dy * 0.9)}px) scale(1) rotate(${f(rot * 0.9)}deg)`, offset: 0.7 },
      { opacity: 0, transform: `translate(${f(dx)}px,${f(dy + 10 * c.k)}px) scale(.7) rotate(${f(rot)}deg)` },
    ], { duration: 900 + Math.random() * 300, delay: delay + i * 25, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' }).finished.then(() => im.remove(), () => im.remove());
  }
}
/** 框后面荡开一圈光环（glow：柔光的） */
function ring(c: Ctx, color: string, delay: number, glow = false): void {
  const s = c.G.hr * 2.9, x = c.G.hx, y = (c.el.offsetHeight - c.G.FH) / 2 + c.G.hy;
  const o = box(h('div', { class: 'fx ring' }), (c.right ? c.el.offsetWidth - x : x) - s / 2, y - s / 2, s);
  o.style.boxShadow = glow ? `0 0 ${px(14 * c.k)} ${px(3 * c.k)} ${color}, inset 0 0 ${px(10 * c.k)} ${px(2 * c.k)} ${color}, inset 0 0 0 ${px(1.5 * c.k)} rgba(255,255,255,.85)` : `0 0 0 ${px(3 * c.k)} ${color}, inset 0 0 0 ${px(2 * c.k)} rgba(255,255,255,.9)`;
  c.el.prepend(o);
  anim(o, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(.8)', offset: 0.2 }, { opacity: 0, transform: 'scale(1.45)' }], { duration: 700, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }).finished.then(() => o.remove(), () => o.remove());
}
/** 一道光从气泡上扫过去 */
function sheen(c: Ctx, color: string, delay: number): void {
  const { bx } = c.el._parts, s = h('div', { class: 'sheen' }, h('i'));
  box(s, 0, 0, bx.offsetWidth, bx.offsetHeight);
  s.style.setProperty('--sh', color);
  bx.append(s);
  const i = s.firstElementChild!;
  const from = c.right ? 'translateX(330%) skewX(18deg)' : 'translateX(-140%) skewX(-18deg)', to = c.right ? 'translateX(-140%) skewX(18deg)' : 'translateX(330%) skewX(-18deg)';
  anim(i, [{ transform: from }, { transform: to }], { duration: 950, delay, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'both' }).finished.then(() => s.remove(), () => s.remove());
}
/** 星月夜空：一颗亮点拖着光尾沿头像框转一圈 */
function trace(c: Ctx, color: string, delay: number): void {
  const s = (c.G.hr + 8 * c.k) * 2, o = fxImg({ svg: traceSvg(color), px: false });
  box(o, c.G.hx - s / 2, c.G.hy - s / 2, s);
  c.el._parts.fw.append(o);
  anim(o, [{ opacity: 0, transform: 'rotate(0deg)' }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.82 }, { opacity: 0, transform: `rotate(${c.right ? -380 : 380}deg)` }], { duration: 760, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' }).finished.then(() => o.remove(), () => o.remove());
}
/** 星月夜空：几颗星星从四周飞过来，聚到框边上亮一下再消失 */
function converge(c: Ctx, n: number, delay: number, kind: FxKind): void {
  const srcs = fxSprites(c.look, kind), G = c.G;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, r0 = G.hr * (2.3 + Math.random() * 0.8), r1 = G.hr * (1.16 + Math.random() * 0.14);
    const s = (16 + Math.random() * 12) * c.k, x1 = G.hx + Math.cos(a) * r1, y1 = G.hy + Math.sin(a) * r1, dx = Math.cos(a) * (r0 - r1), dy = Math.sin(a) * (r0 - r1);
    const o = box(fxImg(srcs[i % srcs.length]!), x1 - s / 2, y1 - s / 2, s);
    c.el._parts.fw.append(o);
    anim(o, [{ opacity: 0, transform: `translate(${f(dx)}px,${f(dy)}px) scale(.4) rotate(-120deg)` }, { opacity: 1, transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 0.62 }, { opacity: 1, transform: 'scale(1.55)', offset: 0.78 }, { opacity: 0, transform: 'scale(0)' }], { duration: 860, delay: delay + i * 45, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' }).finished.then(() => o.remove(), () => o.remove());
  }
}
/** 星月夜空大航海：一颗流星从框上方斜着划过气泡 */
function meteor(c: Ctx, color: string, delay: number): void {
  const W = c.el.offsetWidth, len = 170 * c.k, sx = c.G.F * 0.7, sy = -26 * c.k, ex = Math.min(W - 40 * c.k, sx + 420 * c.k), ey = c.el.offsetHeight * 0.55;
  const x0 = c.right ? W - sx : sx, x1 = c.right ? W - ex : ex, ang = (Math.atan2(ey - sy, x1 - x0) * 180) / Math.PI;
  const o = box(fxImg({ svg: meteorSvg(color), px: false }), x0 - len, sy - 8 * c.k, len, 16 * c.k);
  o.style.transformOrigin = '100% 50%';
  o.style.zIndex = '7';
  c.el.append(o);
  anim(o, [{ opacity: 0, transform: `translate(0,0) rotate(${f(ang)}deg) scaleX(.3)` }, { opacity: 1, transform: `translate(${f((x1 - x0) * 0.25)}px,${f((ey - sy) * 0.25)}px) rotate(${f(ang)}deg) scaleX(1)`, offset: 0.25 }, { opacity: 0, transform: `translate(${f(x1 - x0)}px,${f(ey - sy)}px) rotate(${f(ang)}deg) scaleX(.6)` }], { duration: 820, delay, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'both' }).finished.then(() => o.remove(), () => o.remove());
}
/** 像素：框四周的十字星「叮」地亮一下 */
function blinkStars(c: Ctx, n: number, delay: number): void {
  const cs = ['#FFE7A8', '#FFFFFF', '#A9C8FF', '#FFB3D1'], G = c.G;
  for (let i = 0; i < n; i++) {
    const a = -150 + (i * 300) / Math.max(1, n - 1) + (Math.random() - 0.5) * 20, rr = G.hr * (1.45 + (i % 2) * 0.2);
    const s = (i % 2 ? 12 : 17) * c.k, x = G.hx + Math.cos((a * Math.PI) / 180) * rr, y = G.hy + Math.sin((a * Math.PI) / 180) * rr;
    const o = box(fxImg(plusSprite(cs[i % 4]!)), x - s / 2, y - s / 2, s);
    c.el._parts.fw.append(o);
    anim(o, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.3)', offset: 0.3 }, { opacity: 1, transform: 'scale(.7)', offset: 0.55 }, { opacity: 1, transform: 'scale(1)', offset: 0.75 }, { opacity: 0, transform: 'scale(.3)' }], { duration: 660, delay: delay + i * 90, fill: 'both' }).finished.then(() => o.remove(), () => o.remove());
  }
}
/** 字一行一行浮上来 */
function textIn(c: Ctx, d: number, dur = 300, kf: Keyframe[] = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }]): void {
  for (const part of c.el._parts.bx.querySelectorAll(':scope > .who, :scope > .tx, :scope > .sticker')) { anim(part, kf, { duration: dur, delay: d, easing: OUT }); d += 70; }
}
/**
 * 小八：hop＝进场第一秒放大挡在框中间、冒出来做个小动作，然后跳到头像右下角坐好，头像同时亮出来；
 * corner＝一直坐在右下角，从头像后面探出来做个小动作
 */
function catIn(c: Ctx, mode: string, d0: number): void {
  const { cat: cw, win } = c.el._parts, pick = c.el._cat, G = c.G;
  if (!cw || !pick) return;
  const [kf, dur] = actKeyframes(pick.act), fx = ACT_FX[pick.act];
  if (mode === 'corner') {
    const m = c.right ? 1 : -1;
    anim(cw, [{ opacity: 0, transform: `translate(${m * 18}%, 22%) scale(.35) rotate(${m * 20}deg)` }, { opacity: 1, transform: 'translate(0, -6%) scale(1.12)', offset: 0.55 }, { transform: 'scale(.96, 1.04)', offset: 0.78 }, { opacity: 1, transform: 'none' }], { duration: 520, delay: d0, easing: 'ease-out' });
    anim(cw.firstElementChild!, kf, { duration: dur, delay: d0 + 540, easing: 'ease-in-out', fill: 'none' });
    if (fx === 'bang') burst(c, 'bang', G.ccx + G.sts * 0.3, G.ccy - G.sts * 0.6, 1, [-60, -60], [16, 16], d0 + 500);
    else if (fx) burst(c, fx, G.ccx, G.ccy - G.sts * 0.3, fx === 'heart' ? 5 : 6, [-125, 5], [40, 84], d0 + 480);
    return;
  }
  const HOLD = 1150, T = 1700, P = (ms: number) => ms / T, k = c.k;
  const s = G.big / G.sts, dx = G.bcx - G.ccx, dy = G.bcy - G.ccy, bigT = `translate(${f(dx)}px,${f(dy)}px) scale(${f(s)})`;
  anim(cw, [
    { offset: 0, opacity: 0, transform: `${bigT} translateY(30%) scale(.6)` },
    { offset: P(300), opacity: 1, transform: `${bigT} translateY(-5%) scale(1.03)` },
    { offset: P(460), opacity: 1, transform: bigT },
    { offset: P(HOLD), opacity: 1, transform: bigT },
    { offset: P(1420), opacity: 1, transform: `translate(${f(dx * 0.35)}px,${f(dy * 0.35 - 34 * k)}px) scale(${f(1 + (s - 1) * 0.3)})` },
    { offset: P(1590), opacity: 1, transform: 'translateY(3%) scale(1.08, .92)' },
    { offset: 1, opacity: 1, transform: 'none' },
  ], { duration: T, delay: d0, easing: 'ease-in-out' });
  const face = win.firstElementChild;
  if (face) anim(face, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 0, transform: 'scale(.7)', offset: P(HOLD + 60) }, { opacity: 1, transform: 'scale(1.06)', offset: P(1480) }, { opacity: 1, transform: 'none' }], { duration: T, delay: d0, easing: 'ease-out' });
  anim(cw.firstElementChild!, kf, { duration: Math.min(dur, HOLD - 480), delay: d0 + 470, easing: 'ease-in-out', fill: 'none' });
  if (fx === 'bang') burst(c, 'bang', G.F * 0.88, G.FH * 0.12, 1, [-60, -60], [16, 16], d0 + 460);
  else if (fx) burst(c, fx, G.F * 0.78, G.FH * 0.18, fx === 'heart' ? 5 : 6, [-125, 5], [40, 84], d0 + 420);
}
const guardKind = (tier: Tier): FxKind => (tier === 1 ? 'gold' : tier === 2 ? 'purple' : 'blue');
function crownDrop(c: Ctx, delay: number): void {
  const crown = c.el._parts.fw.querySelector('.crown');
  if (crown) anim(crown, [{ opacity: 0, transform: 'translateY(-70px) rotate(-30deg) scale(1.3)' }, { opacity: 1, transform: 'translateY(4px) rotate(6deg) scale(1)', offset: 0.55 }, { transform: 'translateY(-6px) rotate(-3deg)', offset: 0.75 }, { opacity: 1, transform: 'none' }], { duration: 760, delay, easing: 'ease-in' });
}
function ornPop(c: Ctx, delay: number): void {
  for (const s of c.el._parts.fw.querySelectorAll('.orn')) {
    if (s.classList.contains('crown')) continue;
    anim(s, [{ opacity: 0, transform: 'scale(0) rotate(-120deg)' }, { opacity: 1, transform: 'scale(1.4) rotate(20deg)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 520, delay: delay + (s.classList.contains('s2') ? 120 : 0), easing: 'ease-out' });
  }
}

// ---------- 每种外观的进场 ----------
function cream(c: Ctx, special: boolean, guard: boolean): void {
  const { fw, bw, tail, paw, deco } = c.el._parts, m = c.right ? -1 : 1, flip = c.right ? 'scaleX(-1) ' : '';
  // 头像框：普通观众像贴纸「啪」地拍上去；大航海转着进来
  fw.style.transformOrigin = '50% 55%';
  if (guard) anim(fw, [{ opacity: 0, transform: `rotate(${-140 * m}deg) scale(.3)` }, { opacity: 1, transform: `rotate(${10 * m}deg) scale(1.08)`, offset: 0.6 }, { transform: `rotate(${-3 * m}deg) scale(.98)`, offset: 0.82 }, { opacity: 1, transform: 'none' }], { duration: 640, easing: 'ease-out' });
  else anim(fw, [{ opacity: 0, transform: `translateY(-10px) scale(1.4) rotate(${-14 * m}deg)` }, { opacity: 1, transform: `scale(.9) rotate(${3 * m}deg)`, offset: 0.42 }, { transform: `scale(1.05) rotate(${-1 * m}deg)`, offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'ease-out' });
  // 气泡从框后面「展开」，字晚一点浮上来；胶带拍下来、尾巴甩一下、爪子弹出来
  bw.style.transformOrigin = c.right ? '100% 60%' : '0 60%';
  anim(bw, [{ opacity: 0, transform: `translateX(${-26 * m}px) scale(.55, .8)` }, { opacity: 1, transform: `translateX(${2 * m}px) scale(1.025, 1.01)`, offset: 0.62 }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 90, easing: OUT });
  textIn(c, 230);
  if (deco) anim(deco, [{ opacity: 0, transform: `${flip}translate(-6px,-16px) rotate(-34deg) scale(1.6)` }, { opacity: 1, transform: `${flip}rotate(-5deg) scale(.94)`, offset: 0.6 }, { opacity: 1, transform: `${flip}rotate(-9deg)` }], { duration: 360, delay: 330, easing: 'ease-out' });
  anim(tail.firstElementChild!, [{ transform: 'rotate(-50deg) scale(.6)' }, { transform: 'rotate(16deg) scale(1.05)', offset: 0.45 }, { transform: 'rotate(-8deg)', offset: 0.75 }, { transform: 'rotate(-4deg)' }], { duration: 760, delay: 300, easing: 'ease-out' });
  anim(tail, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: 300 });
  if (paw) anim(paw, [{ opacity: 0, transform: `${flip}scale(0) rotate(-30deg)` }, { opacity: 1, transform: `${flip}scale(1.25) rotate(8deg)`, offset: 0.6 }, { opacity: 1, transform: `${flip}none` }], { duration: 420, delay: 420, easing: 'ease-out' });
  if (guard) {
    burst(c, guardKind(c.tier), c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.3, c.tier === 1 ? 14 : 10, [-140, 15], [70, 130], 420);
    ring(c, c.tier === 1 ? 'rgba(255,200,80,.9)' : c.tier === 2 ? 'rgba(180,150,255,.9)' : 'rgba(120,170,255,.9)', 380);
    sheen(c, c.tier === 1 ? 'rgba(255,240,190,.9)' : 'rgba(255,255,255,.85)', 520);
    crownDrop(c, 560);
    ornPop(c, 620);
  } else if (special) {
    burst(c, 'heart', c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.4, 8, [-140, 10], [56, 104], 420);
    ring(c, 'rgba(255,150,190,.9)', 380);
    sheen(c, 'rgba(255,220,235,.85)', 520);
    ornPop(c, 600);
  }
}
function night(c: Ctx, special: boolean, guard: boolean): void {
  const { fw, bw, tail, paw, deco } = c.el._parts, m = c.right ? -1 : 1, flip = c.right ? 'scaleX(-1) ' : '';
  // 框先暗着浮现，光点转一圈，转过的地方亮起来；星星聚过来
  fw.style.transformOrigin = '50% 55%';
  anim(fw, [{ opacity: 0, transform: 'scale(.84)' }, { opacity: 1, transform: 'scale(1.02)', offset: 0.55 }, { opacity: 1, transform: 'none' }], { duration: 620, easing: OUT });
  const frm = fw.querySelector('.frm');
  if (frm) anim(frm, [{ opacity: 0.12 }, { opacity: 0.12, offset: 0.15 }, { opacity: 1 }], { duration: 760, easing: 'ease-in' });
  trace(c, nightLight(c.tier), 60);
  converge(c, guard ? 9 : 6, 200, guard ? guardKind(c.tier) : special ? 'heart' : 'spark');
  // 气泡从框后面慢慢亮出来，字浮上来；月亮吊坠落下来晃两下，尾巴扫一下，爪子亮出来
  bw.style.transformOrigin = c.right ? '100% 60%' : '0 60%';
  anim(bw, [{ opacity: 0, transform: `translateX(${-22 * m}px) scaleX(.82)` }, { opacity: 1, transform: `translateX(${1 * m}px) scaleX(1.01)`, offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 180, easing: OUT });
  textIn(c, 360, 420);
  if (deco) anim(deco, [{ opacity: 0, transform: `translateY(-28px) rotate(${-26 * m}deg)` }, { opacity: 1, transform: `translateY(2px) rotate(${16 * m}deg)`, offset: 0.45 }, { transform: `rotate(${-8 * m}deg)`, offset: 0.72 }, { opacity: 1, transform: 'none' }], { duration: 1000, delay: 480, easing: 'ease-out' });
  anim(tail.firstElementChild!, [{ transform: 'rotate(-46deg) scale(.7)' }, { transform: 'rotate(12deg) scale(1.04)', offset: 0.5 }, { transform: 'rotate(-4deg)' }], { duration: 820, delay: 420, easing: 'ease-out' });
  anim(tail, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 420 });
  if (paw) anim(paw, [{ opacity: 0, transform: `${flip}scale(.4)` }, { opacity: 1, transform: `${flip}scale(1.12)`, offset: 0.6 }, { opacity: 1, transform: `${flip}none` }], { duration: 520, delay: 560, easing: 'ease-out' });
  if (guard || special) {
    meteor(c, guard ? nightLight(c.tier) : '#FFC9DE', 380);
    ring(c, nightMain(c.tier), 560, true);
    sheen(c, guard ? 'rgba(210,225,255,.55)' : 'rgba(255,215,235,.5)', 700);
    if (guard) { burst(c, guardKind(c.tier), c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.3, c.tier === 1 ? 12 : 8, [-140, 15], [70, 130], 640); crownDrop(c, 640); }
    ornPop(c, 720);
  }
}
function pixel(c: Ctx, special: boolean, guard: boolean): void {
  const { fw, bw, tail, paw, deco } = c.el._parts, flip = c.right ? 'scaleX(-1) ' : '';
  // 框像游戏里的道具一样蹦出来；气泡一截一截横着拉出来；字闪两下再亮
  fw.style.transformOrigin = '50% 55%';
  anim(fw, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.2)', offset: 0.5 }, { transform: 'scale(.92)', offset: 0.75 }, { opacity: 1, transform: 'none' }], { duration: 460 });
  bw.style.transformOrigin = c.right ? '100% 50%' : '0 50%';
  anim(bw, [{ opacity: 0, transform: 'scale(.06, .4)' }, { opacity: 1, transform: 'scale(.18, 1)', offset: 0.2 }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 140 });
  textIn(c, 520, 330, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0.15, offset: 0.55 }, { opacity: 1 }]);
  // 吊坠掉下来弹一下、尾巴甩、爪子蹦出来；十字星叮一下
  if (deco) anim(deco, [{ opacity: 0, transform: 'translateY(-26px)' }, { opacity: 1, transform: 'translateY(4px)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 540 });
  anim(tail.firstElementChild!, [{ transform: 'rotate(-40deg)' }, { transform: 'rotate(12deg)', offset: 0.5 }, { transform: 'rotate(0deg)' }], { duration: 520, delay: 480 });
  anim(tail, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 480 });
  if (paw) anim(paw, [{ opacity: 0, transform: `${flip}scale(0)` }, { opacity: 1, transform: `${flip}scale(1.3)`, offset: 0.6 }, { opacity: 1, transform: `${flip}none` }], { duration: 330, delay: 600 });
  blinkStars(c, guard ? 6 : 3, 480);
  if (guard) {
    burst(c, guardKind(c.tier), c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.3, c.tier === 1 ? 12 : 8, [-140, 15], [70, 130], 420);
    sheen(c, 'rgba(255,255,255,.55)', 560);
    crownDrop(c, 560);
    ornPop(c, 640);
  } else if (special) {
    burst(c, 'heart', c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.4, 8, [-140, 10], [56, 104], 420);
    sheen(c, 'rgba(255,220,235,.6)', 560);
    ornPop(c, 620);
  }
}
function porcelain(c: Ctx, special: boolean, guard: boolean): void {
  const { fw, bw, bx, tail, paw, deco } = c.el._parts, m = c.right ? -1 : 1, rot = c.right ? 6 : -6;
  // 头像框像一只小青花盘转着落下来；气泡浮出，浪纹慢慢晕开；印章举高盖下去，中国结落下来晃一晃
  fw.style.transformOrigin = '50% 53%';
  anim(fw, [{ opacity: 0, transform: `rotate(${-150 * m}deg) scale(.55)` }, { opacity: 1, transform: `rotate(${12 * m}deg) scale(1.04)`, offset: 0.62 }, { transform: `rotate(${-4 * m}deg) scale(.99)`, offset: 0.84 }, { opacity: 1, transform: 'none' }], { duration: 820, easing: 'cubic-bezier(.25,.8,.3,1)' });
  bw.style.transformOrigin = c.right ? '100% 60%' : '0 60%';
  anim(bw, [{ opacity: 0, transform: `translate(${-18 * m}px, 10px) scale(.92)` }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: OUT });
  textIn(c, 320, 380);
  const wv = bx.querySelector('.waves');
  if (wv) anim(wv, [{ opacity: 0 }, { opacity: 0.2, offset: 0.3 }, { opacity: 1 }], { duration: 1100, delay: 420, easing: 'ease-out' });
  if (paw) anim(paw, [{ opacity: 0, transform: `translateY(-30px) rotate(${rot - 18}deg) scale(1.9)` }, { opacity: 1, transform: `rotate(${rot}deg) scale(.86, .8)`, offset: 0.55 }, { transform: `rotate(${rot}deg) scale(1.06)`, offset: 0.78 }, { opacity: 1, transform: `rotate(${rot}deg)` }], { duration: 440, delay: 780, easing: 'cubic-bezier(.5,0,.6,1)' });
  if (deco) anim(deco, [{ opacity: 0, transform: `translateY(-30px) rotate(${-22 * m}deg)` }, { opacity: 1, transform: `translateY(2px) rotate(${14 * m}deg)`, offset: 0.45 }, { transform: `rotate(${-6 * m}deg)`, offset: 0.72 }, { opacity: 1, transform: 'none' }], { duration: 1000, delay: 520, easing: 'ease-out' });
  anim(tail.firstElementChild!, [{ transform: 'rotate(-46deg) scale(.7)' }, { transform: 'rotate(12deg) scale(1.04)', offset: 0.5 }, { transform: 'rotate(-4deg)' }], { duration: 820, delay: 460, easing: 'ease-out' });
  anim(tail, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 460 });
  if (guard) {
    burst(c, 'gold', c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.3, c.tier === 1 ? 14 : 10, [-150, 20], [70, 140], 520);
    ring(c, porcelainTrim(c.tier) ?? 'rgba(90,130,220,.85)', 460);
    sheen(c, 'rgba(255,226,150,.75)', 640);
    crownDrop(c, 640);
    ornPop(c, 720);
  } else if (special) {
    burst(c, 'heart', c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.4, 8, [-140, 10], [56, 104], 520);
    ring(c, 'rgba(230,120,160,.85)', 460);
    sheen(c, 'rgba(255,220,235,.7)', 640);
    ornPop(c, 700);
  }
}
const JELLY = (dy: number): Keyframe[] => [{ opacity: 0, transform: `translateY(${dy}px) scale(.82, .82)` }, { opacity: 1, transform: 'translateY(0) scale(1.1, .86)', offset: 0.38 }, { transform: 'scale(.95, 1.06)', offset: 0.6 }, { transform: 'scale(1.025, .975)', offset: 0.8 }, { opacity: 1, transform: 'none' }];
function jelly(c: Ctx, special: boolean, guard: boolean): void {
  const { fw, bw, bx, tail } = c.el._parts, rim = JT[c.tier];
  // 像果冻一样掉下来：压扁、弹起、晃两下停住；小八果冻耳朵跟着抖
  fw.style.transformOrigin = '50% 90%';
  anim(fw, JELLY(-28), { duration: 640, easing: 'cubic-bezier(.3,.7,.4,1)' });
  bw.style.transformOrigin = c.right ? '100% 90%' : '0 90%';
  anim(bw, JELLY(-20), { duration: 680, delay: 90, easing: 'cubic-bezier(.3,.7,.4,1)' });
  textIn(c, 300, 360);
  const jc = bx.querySelector('.jcap');
  if (jc) anim(jc, [{ transform: 'scale(1, .4)' }, { transform: 'scale(.94, 1.18)', offset: 0.35 }, { transform: 'scale(1.04, .9)', offset: 0.58 }, { transform: 'scale(.99, 1.04)', offset: 0.8 }, { transform: 'none' }], { duration: 760, delay: 260, easing: 'ease-out' });
  anim(tail.firstElementChild!, [{ transform: 'rotate(-40deg) scale(.7)' }, { transform: 'rotate(12deg) scale(1.05)', offset: 0.5 }, { transform: 'rotate(-4deg)' }], { duration: 760, delay: 380, easing: 'ease-out' });
  anim(tail, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 380 });
  if (guard || special) {
    sheen(c, `${rim}CC`, 520);
    ring(c, rim, 460, true);
    if (guard) { burst(c, guardKind(c.tier), c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.3, c.tier === 1 ? 12 : 9, [-150, 20], [70, 140], 520); crownDrop(c, 600); }
    else burst(c, 'heart', c.G.hx + c.G.hr * 0.4, c.G.hy - c.G.hr * 0.4, 8, [-140, 10], [56, 104], 520);
    ornPop(c, 680);
  }
}
const ENTER: Record<ThemeLook, (c: Ctx, special: boolean, guard: boolean) => void> = { cream, night, pixel, porcelain, jelly };

/** 大航海、主播的专属进场：同一个人 3 分钟内只放一次（常说话的舰长、欢迎机器人不会一直刷特效） */
const SPECIAL_GAP = 3 * 60 * 1000;
const lastSpecial = new Map<number | string, number>();
export function enterThemed(el: ThemedRow, item: ChatItem, c: OverlayConfig & { chatLook: ThemeLook }): void {
  const v = item.viewer, tier = el._tier, now = Date.now(), who = v.uid || v.name;
  const special = tier !== 'n' && now - (lastSpecial.get(who) ?? -Infinity) > SPECIAL_GAP;
  if (special) lastSpecial.set(who, now);
  if (lastSpecial.size > 500) for (const [kk, t] of lastSpecial) if (now - t > SPECIAL_GAP) lastSpecial.delete(kk);
  const k = c.chatSize === 'large' ? 1.2 : 1, right = c.chatSide === 'right';
  const ctx: Ctx = { el, look: el._look, k, right, tier, G: geo(k, el._look === 'cream' && c.chatCreamFrame === 'lace', right) };
  pixelLook = el._look === 'pixel';
  try {
    ENTER[el._look](ctx, special && tier === 'anchor', special && tier !== 'anchor');
    catIn(ctx, c.chatMascot, el._look === 'cream' ? 220 : el._look === 'pixel' ? 260 : 300);
  } finally {
    pixelLook = false;
  }
}
