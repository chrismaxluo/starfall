// 弹幕列表的小八主题外观：一条弹幕的 DOM（头像、框、小八、身份、内容），以及插进页面后按实际大小画气泡。
// 图形在 chat-theme-art.ts；样式在 chat-theme.css（都写在 .tm 下面，和玻璃外观的 .msg 互不影响）
import './chat-theme.css';
import { CHAT_LOOK_ALPHA, GUARD_BADGES, GUARD_FRAMES } from '@starfall/shared/overlay';
import type { ChatItem, OverlayConfig } from '@starfall/shared/overlay';
import { segments } from './chat-text.ts';
import { h } from './dom.ts';
import { avatar, fallbackColors } from './parts.ts';
import { CREAM_CHARMS, CREAM_GEO, DRAWN_GEO, bubbleSvg, nameIcon, ornaments, pickCat, pixelize, simpleFrame, sparkSvg, svgUrl, themeFrame, tint } from './chat-theme-art.ts';
import type { CreamCharm, ThemeLook, Tier } from './chat-theme-art.ts';

const urls = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.replace(/^.*\/([^/]+)\.webp$/, '$1'), v]));
const CAT_URL = urls(import.meta.glob('./chat-looks/cat/*.webp', { eager: true, query: '?url', import: 'default' }));
const DECO_URL = urls(import.meta.glob('./chat-looks/deco/*.webp', { eager: true, query: '?url', import: 'default' }));
const CREAM_FRAME: Record<Tier, string> = { n: DECO_URL['frame']!, 3: DECO_URL['frame']!, 2: DECO_URL['frame-lv2']!, 1: DECO_URL['frame-lv1']!, anchor: DECO_URL['frame-anchor']! };

export const isTheme = (c: OverlayConfig): c is OverlayConfig & { chatLook: ThemeLook } => c.chatLook !== 'glass';
/** 根元素上的 class：外观、小八放法 */
export const themeClass = (c: OverlayConfig) => (isTheme(c) ? ` theme look-${c.chatLook} cat-${c.chatMascot}` : '');
/** 气泡底色浓淡（0–1） */
export const themeAlpha = (c: OverlayConfig & { chatLook: ThemeLook }) => (c.chatAlpha || CHAT_LOOK_ALPHA[c.chatLook]) / 100;

const tierOf = (v: ChatItem['viewer']): Tier => (v.anchor ? 'anchor' : v.guard ? (v.guard as 1 | 2 | 3) : 'n');
let idle = 0;
let lastCharm: CreamCharm | '' = '';
let seq = 0;

function img(cls: string, src: string, alt = ''): HTMLImageElement {
  const el = h('img', { class: cls });
  el.alt = alt;
  el.referrerPolicy = 'no-referrer';
  el.onerror = () => el.remove();
  el.src = src;
  return el;
}
/** 本地的图（装饰、小八）：不用 no-referrer，加载失败就不显示 */
function pic(cls: string, src: string): HTMLImageElement {
  const el = h('img', { class: cls });
  el.alt = '';
  el.onerror = () => el.remove();
  el.src = src;
  return el;
}
const geoStyle = (g: typeof DRAWN_GEO) => ({ '--fw': String(g.fw), '--fh': String(g.fh), '--fcx': String(g.fcx), '--fcy': String(g.fcy) });
function frameImg(src: string, g: typeof DRAWN_GEO, px: boolean): HTMLImageElement {
  const el = h('img', { class: px ? 'fr px' : 'fr', style: geoStyle(g) });
  el.alt = '';
  el.src = src;
  return el;
}
/** 主题框：奶油贴纸用素材里的格纹框，另外两种是画的 */
function ownFrame(look: ThemeLook, tier: Tier): HTMLImageElement {
  return look === 'cream' ? frameImg(CREAM_FRAME[tier], CREAM_GEO, false) : frameImg(svgUrl(themeFrame(look, tier)), DRAWN_GEO, look === 'pixel');
}
const plainFrame = (look: ThemeLook, tier: Tier) => frameImg(svgUrl(simpleFrame(look, tier)), DRAWN_GEO, look === 'pixel');

interface ThemedRow extends HTMLElement {
  _tier?: Tier;
  _charm?: CreamCharm;
  _uid?: string;
  _size?: string;
}

/** 一条弹幕（主题外观）。medal：这条要不要显示粉丝牌 */
export function buildThemed(item: ChatItem, c: OverlayConfig & { chatLook: ThemeLook }, medal: boolean): HTMLElement {
  const v = item.viewer, look = c.chatLook, tier = tierOf(v), guard = v.guard !== 0;
  const bili = c.chatGuardFrame === 'bili';
  const el = h('div', { class: `tm${guard ? ` lv-${v.guard}` : ''}${v.anchor ? ' anchor' : ''}` }) as ThemedRow;
  el._tier = tier;
  el._uid = `sfb${++seq}`;
  if (look === 'cream') {
    const opts = CREAM_CHARMS.filter((x) => x !== lastCharm);
    lastCharm = el._charm = opts[Math.floor(Math.random() * opts.length)]!;
  }

  // 头像：加载不出来时铺这套外观的颜色、写昵称第一个字
  const av = avatar({ name: v.name, guard: v.guard, isMod: v.isMod, ...(v.face ? { face: v.face } : {}) }, 92);
  av.style.background = tint(look, tier).main;
  av.style.width = av.style.height = av.style.fontSize = '';
  const avw = h('div', { class: guard && bili ? 'avw bili' : 'avw' }, av);
  if (guard && bili) {
    // B 站的大航海框；加载失败换成简单圆框
    const fr = h('img', { class: 'fr bili' });
    fr.alt = '';
    fr.referrerPolicy = 'no-referrer';
    fr.onerror = () => fr.replaceWith(plainFrame(look, tier));
    fr.src = GUARD_FRAMES[v.guard as 1 | 2 | 3];
    avw.append(fr);
  } else avw.append(bili ? plainFrame(look, tier) : ownFrame(look, tier));
  // 身份装饰（星星、皇冠）只配主题框：B 站的框本身分了身份
  if (!bili) for (const [cls, src, px] of ornaments(look, v.guard)) avw.append(pic(px ? `orn ${cls} px` : `orn ${cls}`, src));
  if (look === 'night' && !bili) avw.append(pic('twk t1', svgUrl(sparkSvg('#FFD27A'))), pic('twk t2', svgUrl(sparkSvg('#9EC0FF'))));

  // 小八：按弹幕内容挑表情
  let cat: HTMLImageElement | null = null;
  if (c.chatMascot !== 'off') {
    const pick = pickCat(item.text, !!item.sticker, idle);
    if (pick.fallback) idle++;
    cat = pic(look === 'pixel' ? 'cat px' : 'cat', CAT_URL[pick.id] ?? CAT_URL['happy']!);
    if (look === 'pixel') pixelArt(cat);
    if (c.chatMascot !== 'end') avw.append(cat);
  }

  // 身份：主播 / 船锚 / 房 / 粉丝牌 / 荣耀勋章，然后是昵称（和 B 站一样的顺序）；没有船锚、不是主播的人前面放一个小图标
  const who = h('div', { class: 'who' });
  if (!guard && !v.anchor) {
    const [src, px] = nameIcon(look);
    who.append(pic(px ? 'ic px' : 'ic', src));
  }
  if (v.anchor) who.append(h('span', { class: 'zb' }, '主播'));
  if (guard) who.append(img('badge', GUARD_BADGES[v.guard as 1 | 2 | 3]));
  if (v.isMod) who.append(h('i', { class: 'fang' }, '房'));
  const m = v.medal;
  if (m && medal) {
    const col = m.colors ?? fallbackColors(m.level, guard);
    who.append(h('span', { class: 'medal', style: { '--mc': col.bg, '--ml': col.level, '--mt': col.text } }, h('span', { class: 'mn' }, m.name), h('b', { class: 'ml' }, String(m.level))));
  }
  if (v.honor?.url) who.append(img('honor', v.honor.url));
  who.append(h('span', { class: 'nm' }, v.name));
  // 船锚、勋章加载完会占地方：再看一次粉丝牌放不放得下
  for (const i of who.querySelectorAll('img')) i.addEventListener('load', () => fitWho(el));

  const body = item.sticker
    ? img('sticker', item.sticker.url, item.text)
    : h('div', { class: 'tx' }, ...segments(item.text, item.emots).map((s) => ('img' in s ? img('em', s.img, s.alt) : s.text)));
  const g = h('div', { class: 'g' }, who, body);
  const gw = h('div', { class: 'gw' });
  if (look === 'cream') gw.append(pic('tape', DECO_URL['pink-tape']!));
  if (cat && c.chatMascot === 'end') gw.append(cat);
  gw.append(g);
  el.append(avw, gw);
  return el;
}

/**
 * 第一行放不下时一步步让位置，昵称至少留 4 个字：先把粉丝牌的名字收起来（只留等级），还放不下再收起荣耀勋章。
 * 粉丝牌名字被挤得只剩半个字时也整个收起来，不显示半截字
 */
function fitWho(el: HTMLElement): void {
  const who = el.querySelector<HTMLElement>('.who');
  if (!who) return;
  const mn = who.querySelector<HTMLElement>('.medal .mn'), honor = who.querySelector<HTMLElement>('.honor');
  for (const x of [mn, honor]) if (x) x.style.display = '';
  const over = () => who.scrollWidth > who.clientWidth + 1;
  if (mn && (over() || mn.scrollWidth > mn.clientWidth + 1)) mn.style.display = 'none';
  if (honor && over()) honor.style.display = 'none';
}

const ro = new ResizeObserver((es) => {
  for (const e of es) {
    // 被顶走、清空的那条也会触发一次（大小变成 0）：不再盯着它
    if (!e.target.isConnected) { ro.unobserve(e.target); continue; }
    const row = e.target.closest('.tm') as ThemedRow | null;
    if (row) draw(row);
  }
});

/** 插进页面以后调用：量好大小画气泡；之后大小变了（表情图加载完、字体换好）自动重画 */
export function mountThemed(el: HTMLElement, c: OverlayConfig & { chatLook: ThemeLook }): void {
  (el as ThemedRow)._size = '';
  draw(el as ThemedRow, c);
  const g = el.querySelector('.g');
  if (g) ro.observe(g);
}

let current: (OverlayConfig & { chatLook: ThemeLook }) | null = null;
function draw(el: ThemedRow, c?: OverlayConfig & { chatLook: ThemeLook }): void {
  if (c) current = c;
  const cfg = current;
  const g = el.querySelector<HTMLElement>(':scope > .gw > .g');
  if (!cfg || !g) return;
  const w = g.offsetWidth, hh = g.offsetHeight, size = `${w}x${hh}`;
  if (!w || el._size === size) return;
  el._size = size;
  fitWho(el);
  g.querySelector(':scope > .bub')?.remove();
  const k = cfg.chatSize === 'large' ? 1.2 : 1, P = 14 * k, TOP = 34 * k, SIDE = 60 * k;
  const right = cfg.chatSide === 'right';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bub');
  svg.setAttribute('width', String(w + SIDE + P));
  svg.setAttribute('height', String(hh + TOP + P));
  svg.style.left = right ? `${-SIDE}px` : '0px';
  svg.style.top = `${-TOP}px`;
  const tr = right ? `translate(${w + SIDE} ${TOP}) scale(-1 1)` : `translate(0 ${TOP})`;
  const art = { img: (n: string) => DECO_URL[n]!, catAtEnd: cfg.chatMascot === 'end', charm: el._charm ?? 'heart-charm', uid: el._uid ?? 'sfb' };
  svg.innerHTML = `<g transform="${tr}">${bubbleSvg(cfg.chatLook, el._tier ?? 'n', w, hh, k, art)}</g>`;
  g.prepend(svg);
}

/** 像素外观：小八缩成 42 格、收进调色板、描一格深色边（同一张图只算一次） */
const pixCache = new Map<string, Promise<string>>();
function pixelArt(el: HTMLImageElement): void {
  const src = el.src;
  let p = pixCache.get(src);
  if (!p) {
    p = new Promise<string>((res) => {
      const im = new Image();
      im.onload = () => {
        const w = 42, hh = Math.round((42 * im.naturalHeight) / im.naturalWidth), W = w + 2, H = hh + 2;
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
