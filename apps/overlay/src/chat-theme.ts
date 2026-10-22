// 弹幕列表的小八主题外观（果冻玻璃、青花瓷、奶油贴纸、星月夜空、像素小屋）：一条弹幕的 DOM，以及插进页面后按实际大小画气泡。
// 一条（.tm）= 头像框（.fw：自己的头像 + 小八脑袋框 + 身份装饰 + 右下角的小八）+ 气泡（.bw）。
// 气泡是按这一条的实际大小现画的一张图（每条一张，SVG 里的 id 互不影响）；字、身份、粉丝牌是普通网页元素，叠在上面。
// 图形在 chat-theme-art.ts，进场动画在 chat-theme-fx.ts，样式在 chat-theme.css（都写在 .tm 下面，和玻璃外观的 .msg 互不影响）
import './chat-theme.css';
import { CHAT_LOOK_ALPHA, GUARD_BADGES, GUARD_FRAMES } from '@starfall/shared/overlay';
import type { ChatItem, OverlayConfig } from '@starfall/shared/overlay';
import { segments } from './chat-text.ts';
import { h } from './dom.ts';
import { avatar, fallbackColors, img } from './parts.ts';
import {
  BUB_PAD, PIX_CHARM_COUNT, PIX_ET, bubbleR, bubbleSvg, charmSprite, frostMaskSvg, geo, glowScale, jellyCapSvg, laceFrameName, nameIcon,
  ornament, pawSprite, pickCat, pixCells, pixCharm, pixelize, svgUrl, tailSprite, themeFrame, twinkles, wavesSvg,
} from './chat-theme-art.ts';
import type { CatPick, Geo, InPath, Sprite, ThemeLook, Tier } from './chat-theme-art.ts';

const urls = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/^.*\/([^/]+)\.webp$/, '$1'), v]));
const CAT_URL = urls(import.meta.glob('./chat-looks/cat/*.webp', { eager: true, query: '?url', import: 'default' }));
const DECO_URL = urls(import.meta.glob('./chat-looks/deco/*.webp', { eager: true, query: '?url', import: 'default' }));

export type ThemeConfig = OverlayConfig & { chatLook: ThemeLook };
export const isTheme = (c: OverlayConfig): c is ThemeConfig => c.chatLook !== 'glass';
/** 根元素上的 class：外观 */
export const themeClass = (c: OverlayConfig) => (isTheme(c) ? ` theme lk-${c.chatLook}` : '');
/** 气泡底色浓淡（0–1）：0 为跟随外观 */
export const themeAlpha = (c: ThemeConfig) => (c.chatAlpha || CHAT_LOOK_ALPHA[c.chatLook]) / 100;
const kOf = (c: OverlayConfig) => (c.chatSize === 'large' ? 1.2 : 1);
const lace = (c: ThemeConfig) => c.chatLook === 'cream' && c.chatCreamFrame === 'lace';
export const geoOf = (c: ThemeConfig): Geo => geo(kOf(c), lace(c), c.chatSide === 'right');

// 矢量路径 → 判断某个点在不在里面（像素外观拿它把矢量形状变成格子）
const PCTX = document.createElement('canvas').getContext('2d');
const inPath: InPath = (d) => { const p = new Path2D(d); return (x, y) => !!PCTX?.isPointInPath(p, x, y); };

/** 同一张 SVG 只转一次地址 */
const URLS = new Map<string, string>();
const spriteUrl = (s: Sprite | string) => { const svg = typeof s === 'string' ? s : s.svg; let u = URLS.get(svg); if (!u) { u = svgUrl(svg); URLS.set(svg, u); } return u; };

const tierOf = (v: ChatItem['viewer']): Tier => (v.anchor ? 'anchor' : v.guard ? (v.guard as 1 | 2 | 3) : 'n');
let idle = 0;
let lastCharm = -1;

export interface ThemedRow extends HTMLElement {
  _tier: Tier;
  _look: ThemeLook;
  _cat: CatPick | null;
  _key: string;
  _parts: { fw: HTMLElement; win: HTMLElement; bw: HTMLElement; bx: HTMLElement; tail: HTMLElement; paw: HTMLElement | null; deco: HTMLElement | null; cat: HTMLElement | null };
}

const px = (n: number) => `${+n.toFixed(2)}px`;
function box<T extends HTMLElement>(el: T, x: number, y: number, w: number, hh = w): T {
  el.style.left = px(x); el.style.top = px(y); el.style.width = px(w); el.style.height = px(hh);
  return el;
}
/** 本地的图（装饰、小八）：不用 no-referrer，加载失败就不显示 */
function pic(cls: string, src: string): HTMLImageElement {
  const el = h('img', { class: cls });
  el.alt = '';
  el.onerror = () => el.remove();
  if (src) el.src = src;
  return el;
}
const spriteImg = (cls: string, s: Sprite) => pic(s.px ? `${cls} px` : cls, spriteUrl(s));

/** 一条弹幕（主题外观）。medal：这条要不要显示粉丝牌 */
export function buildThemed(item: ChatItem, c: ThemeConfig, medal: boolean): ThemedRow {
  const v = item.viewer, look = c.chatLook, tier = tierOf(v), guard = v.guard !== 0, k = kOf(c), G = geoOf(c);
  const biliFrame = guard && c.chatGuardFrame === 'bili';
  const el = h('div', { class: `tm${guard ? ` lv-${v.guard}` : ''}${v.anchor ? ' anchor' : ''}` }) as unknown as ThemedRow;
  el._tier = tier;
  el._look = look;
  el._key = '';

  // 头像框：窗口（圆形，里面是自己的头像）→ 框 → 身份装饰 → 小八
  const fw = h('div', { class: 'fw', style: { width: px(G.F), height: px(G.FH) } });
  const win = box(h('div', { class: 'win' }), G.hx - G.wr, G.hy - G.wr, G.wr * 2);
  const av = avatar({ name: v.name, guard: v.guard, isMod: v.isMod, ...(v.face ? { face: v.face } : {}) }, Math.round(G.wr * 2));
  av.style.width = av.style.height = '';
  win.append(av);
  fw.append(win);
  const themeFr = () => {
    const fr = lace(c) ? pic('frm', DECO_URL[laceFrameName(tier)]!) : pic(look === 'pixel' ? 'frm px' : 'frm', spriteUrl(themeFrame(look, tier, inPath)));
    return box(fr, 0, 0, G.F, G.FH);
  };
  if (biliFrame) {
    // B 站的大航海框（版权归 B 站，运行时加载）：加载失败换回这套外观的框
    const s = G.hr * 2 * 1.4, fr = box(h('img', { class: 'frm bili' }), G.hx - s / 2, G.hy - s / 2, s);
    fr.alt = '';
    fr.referrerPolicy = 'no-referrer';
    fr.onerror = () => fr.replaceWith(themeFr());
    fr.src = GUARD_FRAMES[v.guard as 1 | 2 | 3];
    fw.append(fr);
  } else fw.append(themeFr());
  // 身份装饰：舰长一颗星、提督两颗、总督皇冠、主播爱心（B 站的框本身分了身份，不加）
  if (!biliFrame) {
    const ob = glowScale(look);
    const orn = (cls: string, kind: 'star' | 'crown' | 'heart', x: number, y: number, w: number, hh = w) => fw.append(box(spriteImg(`orn ${cls}`, ornament(look, kind)), x, y, w, hh));
    const grow = (x: number, w: number) => x - (w * (ob - 1)) / 2;
    if (v.guard === 3 || v.guard === 2) orn('s1', 'star', grow(G.F * 0.74, 30 * k), grow(G.FH * 0.02, 30 * k), 30 * k * ob);
    if (v.guard === 2) orn('s2', 'star', grow(G.F * 0.9, 20 * k), grow(G.FH * 0.24, 20 * k), 20 * k * ob);
    if (v.guard === 1) {
      const pixel = look === 'pixel', cw = 52 * k * (pixel ? 1 : ob), ch = (pixel ? 32 : 42) * k * (pixel ? 1 : ob);
      orn('crown', 'crown', G.hx - cw / 2, (pixel ? -14 : -24) * k - (ch - 42 * k) / 2, cw, ch);
    }
    if (v.anchor) orn('s1', 'heart', G.F * 0.76, G.FH * 0.02, 28 * k * ob, 28 * k * ob * (look === 'pixel' ? 1 : 0.9));
    for (const [cls, s, cx, cy, size] of twinkles(look, v.guard === 3 || v.guard === 2 || v.anchor)) fw.append(box(spriteImg(`twk ${cls}`, s), G.F * cx - (size * k) / 2, G.FH * cy - (size * k) / 2, size * k));
  }
  // 小八：坐在头像右下角，表情和小动作跟着弹幕内容变
  let cat: HTMLElement | null = null;
  el._cat = null;
  if (c.chatMascot !== 'off') {
    const pick = pickCat(item.text, !!item.sticker, idle);
    if (pick.fallback) idle++;
    el._cat = pick;
    cat = box(h('div', { class: 'catw' }), G.ccx - G.sts / 2, G.ccy - G.sts / 2, G.sts);
    const ci = pic(look === 'pixel' ? 'px' : '', CAT_URL[pick.id] ?? CAT_URL['happy']!);
    if (look === 'pixel') pixelArt(ci);
    cat.append(h('div', { class: 'br' }, ci));
    fw.append(cat);
  }

  // 气泡：左端藏在框下面
  const bw = h('div', { class: 'bw' });
  const right = c.chatSide === 'right', padIn = G.lap + 18 * k, padOut = (look === 'cream' ? 50 : 62) * k;
  bw.style.margin = right ? `0 ${px(-G.lap)} 0 0` : `0 0 0 ${px(-G.lap)}`;
  const bx = h('div', { class: 'bx', style: { padding: right ? `${px(13 * k)} ${px(padIn)} ${px(15 * k)} ${px(padOut)}` : `${px(13 * k)} ${px(padOut)} ${px(15 * k)} ${px(padIn)}`, 'min-height': px(98 * k), 'min-width': px(padIn + padOut + 210 * k) } });

  // 身份：主播 / 船锚 / 房 / 粉丝牌 / 荣耀勋章，然后是昵称（和 B 站一样的顺序）；普通观众前面放一个小图标
  const who = h('div', { class: 'who' });
  const icon = !guard && !v.anchor ? nameIcon(look) : null;
  if (icon) who.append(spriteImg('ic', icon));
  if (v.anchor) who.append(h('span', { class: 'zb' }, '主播'));
  if (guard) who.append(img('badge', GUARD_BADGES[v.guard as 1 | 2 | 3]));
  if (v.isMod) who.append(h('i', { class: 'fang' }, '房'));
  const m = v.medal;
  if (m && medal) {
    const col = m.colors ?? fallbackColors(m.level, guard);
    who.append(h('span', { class: 'medal', style: { '--mc': col.bg, '--ml': col.level, '--mt': col.text } }, h('span', { class: 'mn' }, m.name), h('b', { class: 'ml' }, String(m.level))));
  }
  if (v.honor?.url) who.append(img('honor', v.honor.url));
  who.append(h('span', { class: 'nm' }, h('span', { class: 't' }, v.name)));
  // 船锚、勋章加载完会占地方：重新排一次
  for (const i of who.querySelectorAll('img')) i.addEventListener('load', () => { el._key = ''; draw(el); });
  const body = item.sticker
    ? img('sticker', item.sticker.url, item.text)
    : h('div', { class: 'tx' }, ...segments(item.text, item.emots).map((s) => ('img' in s ? img('em', s.img, s.alt) : s.text)));
  bx.append(who, body);

  // 尾巴（气泡后面）、猫爪（右下角）、第三样：奶油是左上的胶带，夜空是月亮吊坠，像素是轮流换的小吊坠，青花瓷是中国结
  const tailS = tailSprite(look, tier);
  const tail = h('div', { class: tailS.px ? 'tail px' : 'tail' }, h('div', { class: 'sw' }, pic('', spriteUrl(tailS))));
  let paw: HTMLElement | null = null;
  if (look === 'cream') paw = h('div', { class: 'paw' }, pic('', DECO_URL['paw']!));
  else { const p = pawSprite(look, tier); if (p) paw = h('div', { class: p.px ? 'paw px' : 'paw' }, pic('', spriteUrl(p))); }
  let deco: HTMLElement | null = null;
  if (look === 'cream') deco = h('div', { class: 'tape' }, pic('', DECO_URL['pink-tape']!));
  else if (look === 'pixel') {
    let i = Math.floor(Math.random() * PIX_CHARM_COUNT);
    if (i === lastCharm) i = (i + 1) % PIX_CHARM_COUNT;
    lastCharm = i;
    const [svg, rows] = pixCharm(i);
    deco = h('div', { class: 'charm px' }, h('div', { class: 'sw' }, pic('', spriteUrl(svg))));
    deco.dataset.rows = String(rows);
  } else { const s = charmSprite(look, tier); if (s) deco = h('div', { class: 'charm' }, h('div', { class: 'sw' }, pic('', spriteUrl(s)))); }
  bw.append(tail, bx);
  if (paw) bw.append(paw);
  if (deco) bw.append(deco);
  if (look === 'porcelain') bx.prepend(pic('waves', ''));
  if (look === 'jelly') { bx.prepend(pic('jcap', '')); bx.append(h('div', { class: 'jglint' }, h('i'))); }

  el.append(fw, bw);
  el._parts = { fw, win, bw, bx, tail, paw, deco, cat };
  return el;
}

/**
 * 第一行放不下时：先收起粉丝牌的名字（只留等级），再收起荣耀勋章，让昵称留在第一行；
 * 还是放不下就全部照常显示、昵称换到下一行。昵称和弹幕本身从不截断
 */
function fitWho(el: ThemedRow): void {
  const who = el._parts.bx.querySelector<HTMLElement>('.who');
  if (!who) return;
  const mn = who.querySelector<HTMLElement>('.medal .mn'), hon = who.querySelector<HTMLElement>('.honor'), nm = who.querySelector<HTMLElement>('.nm');
  const reset = () => { if (mn) { mn.style.display = ''; mn.parentElement?.classList.remove('lv-only'); } if (hon) hon.style.display = ''; };
  reset();
  const first = who.firstElementChild as HTMLElement | null;
  const wrapped = () => !!nm && !!first && nm.offsetTop > first.offsetTop + 4;
  if (!wrapped()) return;
  if (mn) { mn.style.display = 'none'; mn.parentElement?.classList.add('lv-only'); }
  if (hon && wrapped()) hon.style.display = 'none';
  if (wrapped()) reset();
}

const ro = new ResizeObserver((es) => {
  for (const e of es) {
    // 被顶走、清空的那条也会触发一次（大小变成 0）：不再盯着它
    if (!e.target.isConnected) { ro.unobserve(e.target); continue; }
    const row = e.target.closest('.tm') as ThemedRow | null;
    if (row) draw(row);
  }
});

let current: ThemeConfig | null = null;
/** 插进页面以后调用：量好大小画气泡；之后大小变了（表情图加载完、字体换好）自动重画 */
export function mountThemed(el: ThemedRow, c: ThemeConfig): void {
  current = c;
  el._key = '';
  draw(el);
  ro.observe(el._parts.bx);
}
/** 换了浓淡这类只影响气泡的设置：全部重画气泡（不重建） */
export function redrawThemed(rows: Iterable<Element>, c: ThemeConfig): void {
  current = c;
  for (const r of rows) { const t = r as ThemedRow; if (t._parts) { t._key = ''; draw(t); } }
}

/** 量好气泡大小再画；位置都按「放在左边」算，放右边时左右对调 */
function draw(el: ThemedRow): void {
  const c = current;
  if (!c || !el._parts) return;
  const { bx, tail, paw, deco } = el._parts, look = el._look, k = kOf(c), right = c.chatSide === 'right', a = themeAlpha(c);
  fitWho(el);
  const w = bx.offsetWidth, hh = bx.offsetHeight;
  if (!w || !hh) return;
  const key = `${w}x${hh}x${a}`;
  if (el._key === key) return;
  el._key = key;
  const [M, ET] = BUB_PAD[look].map((v) => v * k) as [number, number];
  let bub = bx.querySelector<HTMLImageElement>(':scope > .bub');
  if (!bub) { bub = pic(look === 'pixel' ? 'bub px' : 'bub', ''); bx.prepend(bub); }
  bub.src = svgUrl(bubbleSvg(look, w, hh, k, el._tier, a, lace(c), inPath));
  if (look === 'pixel') { const u = 3 * k, [cols, rows] = pixCells(w, hh, k); box(bub, 0, -PIX_ET * u, (cols + 1) * u, (rows + 1 + PIX_ET) * u); }
  else box(bub, -M, -(ET + M), w + 2 * M, hh + ET + 2 * M);
  // 气泡后面的背景模糊（形状和气泡一样；精简模式、不支持模糊的直播姬不显示）
  if (look !== 'pixel') {
    let fr = bx.querySelector<HTMLElement>(':scope > .frost');
    if (!fr) { fr = h('div', { class: 'frost' }); bx.prepend(fr); }
    box(fr, -M, -(ET + M), w + 2 * M, hh + ET + 2 * M);
    const mk = `url("${svgUrl(frostMaskSvg(look, w, hh, k, lace(c)))}")`;
    fr.style.setProperty('-webkit-mask-image', mk);
    fr.style.setProperty('mask-image', mk);
  }
  const put = (node: HTMLElement, x: number, y: number, ww: number, h2: number) => box(node, right ? w - x - ww : x, y, ww, h2);
  const R = bubbleR(hh, k), sw = tail.querySelector<HTMLElement>('.sw');
  const s = (58 * k) / 64, u = 3 * k;
  const origin = (l: string, r: string) => { if (sw) sw.style.transformOrigin = right ? r : l; };
  if (look === 'cream' || look === 'porcelain') { put(tail, w - 20 * k, hh - 82 * k, 58 * k, (58 * k * 76) / 64); origin('12% 82%', '88% 82%'); }
  else if (look === 'night') { put(tail, w - 20 * k - 10 * s, hh - 82 * k - 10 * s, 84 * s, 96 * s); origin('21% 75%', '79% 75%'); }
  else if (look === 'jelly') { put(tail, w - 20 * k - 6 * s, hh - 82 * k - 6 * s, 76 * s, 88 * s); origin('18% 77%', '82% 77%'); }
  else { put(tail, w - 7 * u, hh - 19 * u, 14 * u * 1.5, 14 * u * 1.5); origin('7% 86%', '93% 86%'); }
  if (look === 'cream') {
    if (paw) put(paw, w - 52 * k, hh - 31 * k, 44 * k, (44 * k * 177) / 220);
    if (deco) { put(deco, geoOf(c).lap + 2 * k, -15 * k, 70 * k, (70 * k * 108) / 220); deco.style.transform = `${right ? 'scaleX(-1) ' : ''}rotate(-9deg)`; }
  } else if (look === 'night') {
    if (paw) put(paw, w - 56 * k, hh - 36 * k, 54 * k, (54 * k * 60) / 64);
    if (deco) put(deco, w - 44 * k, -1 * k, 40 * k, (40 * k * 52) / 42);
  } else if (look === 'porcelain') {
    if (paw) { put(paw, w - 50 * k, hh - 34 * k, 36 * k, 36 * k); paw.style.transform = `rotate(${right ? 6 : -6}deg)`; }
    if (deco) put(deco, w - 40 * k, -2 * k, 24 * k, (24 * k * 66) / 26);
    const wv = bx.querySelector<HTMLImageElement>(':scope > .waves');
    if (wv) { wv.src = svgUrl(wavesSvg(w, hh, k, el._tier)); box(wv, -M, -(ET + M), w + 2 * M, hh + ET + 2 * M); }
  } else if (look === 'jelly') {
    const jc = bx.querySelector<HTMLImageElement>(':scope > .jcap');
    if (jc) { jc.src = svgUrl(jellyCapSvg(w, hh, k, right)); box(jc, -M, -(ET + M), w + 2 * M, hh + ET + 2 * M); jc.style.transformOrigin = `${px(right ? M + R + 50 * k : M + w - R - 50 * k)} ${px(ET + M)}`; }
    const gl = bx.querySelector<HTMLElement>(':scope > .jglint'), gw = Math.max(40 * k, w * 0.6);
    if (gl) box(gl, right ? w - 26 * k - gw : 26 * k, 2.5 * k, gw, 5 * k);
  } else {
    if (paw) put(paw, w - 18 * u, hh - 9 * u, 13 * u * 1.05, 11 * u * 1.05);
    if (deco) put(deco, w - 16 * u, 2 * u, 9 * u, Number(deco.dataset.rows) * u);
  }
}

/** 像素外观：小八缩成 36 格、收进调色板、描一格深色边（同一张图只算一次） */
const pixCache = new Map<string, Promise<string>>();
function pixelArt(el: HTMLImageElement): void {
  const src = el.src;
  el.removeAttribute('src');
  let p = pixCache.get(src);
  if (!p) {
    p = new Promise<string>((res) => {
      const im = new Image();
      im.onload = () => {
        const w = 36, hh = Math.round((36 * im.naturalHeight) / im.naturalWidth), W = w + 2, H = hh + 2;
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const g = cv.getContext('2d');
        if (!g) return res(src);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 1, 1, w, hh);
        const d = g.getImageData(0, 0, W, H);
        pixelize(d.data, W, H);
        g.putImageData(d, 0, 0);
        res(cv.toDataURL());
      };
      im.onerror = () => res(src);
      im.src = src;
    });
    pixCache.set(src, p);
  }
  void p.then((u) => (el.src = u));
}
