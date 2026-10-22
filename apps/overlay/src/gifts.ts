// 送礼名单：后台选的那段时间（本场、今天、本周、本月、从某个时间起）收到的礼物、上舰、醒目留言，每次一条，
// 或者按人合计（感谢榜：每人一条，按总价值排，前三名金银铜）。
// 七种外观（晶彩、流光、手帐、灵动岛、电竞、弥散、像素）用同一套结构，样子都在 gifts.css；
// 四种滚法：片尾字幕（一直往上走）、逐条上移（停一下挪一条）、翻页（一屏停几秒整屏换）、横向跑马灯（排成一行从右往左走）。
// 名单由服务端算好（合并、按人合计、按金额排要用到全部记录），这里只管画：新的一行插到该在的位置，已有的一行变了就换掉、挪过去。
// 设成「只显示挂上的记录」时只显示后台挂上的那几条；打开「置顶」时挂上的记录固定在最上面，下面接着自动名单。上面可以有一行标题。
// 地址形如 /overlay/?output=1&key=...&gifts=1，在直播软件里单独加一个浏览器源（建议 640 宽，跑马灯 1080 × 150），拖到画面一侧
import './gifts.css';
import '@fontsource/noto-sans-sc/900.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/fusion-pixel-12px-proportional-sc/400.css';
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';
import { GUARD_BADGES, GIFTS_MARQUEE_PX, GIFTS_PAGE_HOLD, GIFTS_SPEED_PX, GIFTS_STEP_HOLD, giftRowCompare, giftRowsSorted, giftRowsTrim, giftsView } from '@starfall/shared/overlay';
import type { GiftListItem, GiftRankRow, GiftRow, GiftsLook, OverlayConfig, ServerToOverlay } from '@starfall/shared/overlay';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
import { avatar, withGuardFrame } from './parts.ts';
import { DEFAULT_CONFIG } from './stage.ts';
import { guardTier, tierOf, tierVars } from './tiers.ts';
import type { Tier } from './tiers.ts';
import { autoUpdate, pageBuild } from './update.ts';

const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' } as const;
const q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1';
const env = detect();

let config: OverlayConfig = { ...DEFAULT_CONFIG };
/** 服务端算好的名单：行号 → 一行（改设置时按它重新画） */
const rows = new Map<string, GiftRow>();
/** 后台挂上的记录（按顺序） */
let pins: GiftListItem[] = [];
/** 画出来的行：行号 → 元素 */
const els = new Map<string, HTMLElement>();

document.getElementById('stage')?.remove();
const root = h('div', { class: 'gl-root' });
/** 上面不滚动的部分：标题、置顶的记录（跑马灯时在左边） */
const head = h('div', { class: 'gl-head' });
/** 滚动的窗口（两头淡出） */
const view = h('div', { class: 'gl-view' });
const list = h('div', { class: 'gl' });
/** 翻页时：第几页的小点 */
const dots = h('div', { class: 'gl-dots' });
view.append(list);
root.append(head, view, dots);
document.body.append(root);
document.documentElement.classList.add('gl-page');
if (q.get('view') === '1' && !preview) document.documentElement.classList.add('gl-view-page');

function img(cls: string, src: string): HTMLElement {
  const el = h('img', { class: cls });
  el.alt = '';
  el.referrerPolicy = 'no-referrer';
  el.onerror = () => el.remove();
  el.src = src;
  return el;
}

/** 礼物名加粗 */
const say = (pre: string, b: string) => h('span', { class: 'say' }, pre, h('b', {}, b));
/** 右边的数量：× 号、数字、单位（礼物的「个」只有部分外观显示） */
const count = (x: string, n: string, unit: string) => h('span', { class: 'gl-num' }, x ? h('small', { class: 'x' }, x) : null, h('b', {}, n), unit ? h('small', { class: 'unit' }, unit) : null);

const f = () => config.giftsFilter;
const pinnedOnly = () => f().mode === 'pinned';
const horiz = () => config.giftsMotion === 'marquee';
const still = () => config.giftsSpeed === 'off';
/** 置顶的记录（最多占一屏少一条，下面至少留一条给自动名单）；跑马灯只有一行，不分置顶 */
const headPins = () => (!pinnedOnly() && f().pinTop && !horiz() ? pins.slice(0, Math.max(0, config.giftsMax - 1)) : []);
/** 按金额排、按人合计：多的在上，放不下时去掉下面的 */
const byValue = () => giftsView(f()) === 'viewer' || f().sort === 'value';

// ---------- 一行 ----------
// 每种外观都是同一套结构：.gl-row > .gl-bar > [.gl-fx 装饰层] [.gl-rank 名次] .gl-avw 头像 .gl-tx 名字和内容 [.gl-pic 礼物图] [.gl-num 数量]

function build(it: GiftRow): HTMLElement {
  const el = it.kind === 'viewer' ? buildRank(it) : buildItem(it);
  el.dataset.id = it.id;
  return el;
}

/** 每条固定的小变化（手帐纸条的角度、胶带的位置，弥散光晕的位置），跟着这一条走，滚动时不变 */
function vary(id: string): Record<string, string> {
  const s = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { '--rot': `${((s % 15) - 7) / 10}deg`, '--arot': `${(s % 11) - 5}deg`, '--tape': `${24 + (s % 5) * 70}px`, '--trot': `${((s % 7) - 3) * 2}deg`, '--dx': `${((s % 5) - 2) * 12}px`, '--dd': `${-(s % 12)}s` };
}

function row(cls: string, tier: Tier, id: string, rank: HTMLElement | null, v: GiftListItem['viewer'], line: HTMLElement, pic: HTMLElement | null, num: HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: `gl-row ${cls}${pic ? '' : ' no-pic'}${num ? '' : ' no-num'}`, style: { ...tierVars(tier), ...vary(id) } },
    h('div', { class: 'gl-bar' }, h('i', { class: 'gl-fx' }), rank, h('span', { class: 'gl-avw' }, withGuardFrame(avatar({ ...v, isMod: false }), v.guard)), h('div', { class: 'gl-tx' }, h('span', { class: 'nm' }, v.name), line), pic ? h('div', { class: 'gl-pic' }, pic) : null, num),
  );
}

function buildItem(it: GiftListItem): HTMLElement {
  const v = it.viewer;
  // 大航海成员送的按身份配色（舰长蓝、提督紫、总督红金），其他人按价值
  let tier = v.guard ? guardTier(v.guard) : tierOf(it.value);
  let line: HTMLElement;
  let pic: HTMLElement | null = null;
  let num: HTMLElement;
  if (it.kind === 'guard' && it.guard) {
    const g = it.guard;
    tier = guardTier(g.level);
    line = say(g.op === 'renew' ? '续费 ' : '开通 ', GUARD_NAMES[g.level]);
    pic = img('gl-badge', GUARD_BADGES[g.level]);
    num = count('×', String(g.months), '个月');
  } else if (it.kind === 'sc' && it.sc) {
    line = h('span', { class: 'say sc' }, it.sc.text || '醒目留言');
    pic = h('span', { class: 'gl-sc' }, 'SC');
    num = count('', String(Math.round(it.sc.price)), '元');
  } else {
    const g = it.gift!;
    line = say('送出 ', g.name);
    if (it.times && it.times > 1) line.append(h('span', { class: 'times' }, ` · ${it.times} 次`));
    if (g.img) pic = img('gl-img', g.img);
    num = count('×', String(g.count), '个');
  }
  return row(`kind-${it.kind}`, tier, it.id, null, v, line, pic, num);
}

/** 电池数（1 电池 = 100 金瓜子）：上万写成「1.2万」 */
function battery(gold: number): string {
  const n = Math.round(gold / 100);
  return n >= 10_000 ? `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}万` : n.toLocaleString('en-US');
}

/** 按人合计的一行：名次、头像、名字、送了些什么，右边是最贵的礼物（上过舰时是船锚）和总数 */
function buildRank(r: GiftRankRow): HTMLElement {
  const v = r.viewer;
  const tier = v.guard ? guardTier(v.guard) : tierOf(r.value);
  const parts = [r.guard ? GUARD_NAMES[r.guard] : '', r.times ? `送礼 ${r.times} 次` : '', r.scs ? `醒目留言 ${r.scs} 条` : ''].filter(Boolean);
  const pic = r.guard ? img('gl-badge', GUARD_BADGES[r.guard]) : r.top?.img ? img('gl-img', r.top.img) : r.scs ? h('span', { class: 'gl-sc' }, 'SC') : null;
  const num = f().amount !== false ? count('', battery(r.value), '电池') : null;
  return row('kind-viewer', tier, r.id, h('span', { class: 'gl-rank' }), v, h('span', { class: 'say' }, parts.join(' · ')), pic, num);
}

/** 按人合计：写上名次（前三名金银铜；电竞写成 01、02） */
function renumber(): void {
  if (giftsView(f()) !== 'viewer') return;
  const two = config.giftsLook === 'esports';
  shown().forEach((r, i) => {
    const el = els.get(r.id)?.querySelector('.gl-rank');
    if (!el) return;
    el.textContent = two ? String(i + 1).padStart(2, '0') : String(i + 1);
    el.className = `gl-rank${i < 3 ? ` r${i + 1}` : ''}${i >= 99 ? ' small' : ''}`;
  });
}

// ---------- 进场、加数（每种外观不一样） ----------
// 只用 transform、opacity、filter、clip-path（直播软件的旧内核不认单独的 translate / scale / rotate 属性）

const $ = (el: HTMLElement, s: string) => el.querySelector<HTMLElement>(s);

const ENTER: Record<GiftsLook, (el: HTMLElement) => void> = {
  // 晶彩：从下面浮上来，礼物图弹一下，数字从大缩回来，一道光扫过
  jingcai(el) {
    el.animate([{ opacity: 0, transform: 'translateY(40px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
    $(el, '.gl-pic')?.animate([{ opacity: 0, transform: 'scale(.3) rotate(-16deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' });
    $(el, '.gl-num')?.animate([{ opacity: 0, transform: 'translateY(-50%) scale(2.2)' }, { opacity: 1, transform: 'translateY(-50%) scale(.92)', offset: 0.7 }, { opacity: 1, transform: 'translateY(-50%)' }], { duration: 480, delay: 360, easing: 'ease-out', fill: 'backwards' });
    sheen(el, 420);
  },
  // 流光：从模糊里浮出来，背后的光亮一下再暗回去
  glass(el) {
    el.animate([{ opacity: 0, filter: 'blur(14px)', transform: 'translateY(12px) scale(.97)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $(el, '.gl-fx')?.animate([{ opacity: 1, filter: 'blur(2px)' }, { opacity: 0.72, filter: 'blur(8px)' }], { duration: 1600, delay: 300, easing: 'ease-out', fill: 'backwards' });
  },
  // 手帐：像贴纸条一样从上面落下贴好，胶带再贴上去，数字圈出来
  journal(el) {
    el.animate([{ opacity: 0, transform: 'translate(-12px,-36px) rotate(-7deg) scale(1.08)' }, { opacity: 1, transform: 'translate(0,2px) rotate(.8deg) scale(.99)', offset: 0.72 }, { opacity: 1, transform: 'none' }], { duration: 640, easing: 'cubic-bezier(.25,.8,.3,1)' });
    const tape = $(el, '.gl-fx');
    if (tape) {
      const t = getComputedStyle(tape).transform;
      const base = t && t !== 'none' ? t : '';
      tape.animate([{ opacity: 0, transform: `${base} scaleX(0)` }, { opacity: 0.88, transform: base || 'none' }], { duration: 300, delay: 460, easing: 'ease-out', fill: 'backwards' });
    }
    $(el, '.gl-num')?.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 640, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' });
  },
  // 灵动岛：从一颗小胶囊展开，里面的字再淡入
  island(el) {
    const small = config.giftsSide === 'left' ? 'inset(12% calc(100% - 64px) 12% 0 round 999px)' : 'inset(12% 0 12% calc(100% - 64px) round 999px)';
    $(el, '.gl-bar')?.animate([{ clipPath: small }, { clipPath: 'inset(0 0 0 0 round 32px)' }], { duration: 680, easing: 'cubic-bezier(.3,1.3,.4,1)' });
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
    for (const e of el.querySelectorAll<HTMLElement>('.gl-tx, .gl-pic, .gl-num, .gl-rank')) e.animate([{ opacity: 0, filter: 'blur(5px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 380, delay: 280, fill: 'backwards' });
  },
  // 电竞：面板冲进来带一下闪光，比分框砸一下，数字往上跳
  esports(el) {
    el.animate([{ opacity: 0, transform: 'translateX(150px) skewX(-8deg)' }, { opacity: 1, transform: 'translateX(-6px)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 440, easing: 'cubic-bezier(.15,.85,.2,1)' });
    $(el, '.gl-fx')?.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 520, delay: 140, fill: 'backwards' });
    $(el, '.gl-num')?.animate([{ opacity: 0, transform: 'scale(1.45)' }, { opacity: 1, transform: 'scale(.94)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 240, easing: 'ease-out', fill: 'backwards' });
    countUp($(el, '.gl-num b'), 650, 300);
  },
  // 弥散：从模糊里浮出来，里面的柔光慢慢晕开
  diffuse(el) {
    el.animate([{ opacity: 0, filter: 'blur(10px)', transform: 'translateY(14px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $(el, '.gl-fx')?.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 0.9, transform: 'none' }], { duration: 1600, easing: 'cubic-bezier(.2,.8,.2,1)' });
  },
  // 像素：对话框一格一格弹出来，字一个一个打出来，最新一条有闪烁的小箭头
  pixel(el) {
    for (const x of list.querySelectorAll('.gl-row.cur')) x.classList.remove('cur');
    el.classList.add('cur');
    el.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'steps(4)' });
    let d = 220;
    for (const e of el.querySelectorAll<HTMLElement>('.nm, .say')) {
      const n = Math.max(1, [...(e.textContent ?? '')].length);
      e.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: n * 55, delay: d, easing: `steps(${n})`, fill: 'backwards' });
      d += n * 55;
    }
    $(el, '.gl-num')?.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 160, delay: d, easing: 'steps(2)', fill: 'backwards' });
  },
};

/** 新来的一行 */
function enter(el: HTMLElement): void {
  (ENTER[config.giftsLook] ?? ENTER.jingcai)(el);
}

/** 已有的一行变了（又送了一次）：整条跳一下，数字弹一下 */
function bump(el: HTMLElement): void {
  el.animate([{ transform: 'none' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
  const num = $(el, '.gl-num');
  const k = config.giftsLook === 'jingcai' ? 'translateY(-50%) ' : '';
  num?.animate([{ transform: `${k}scale(1.7)`, opacity: 0.5 }, { transform: k || 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  if (config.giftsLook === 'jingcai') sheen(el, 120);
  if (config.giftsLook === 'glass') $(el, '.gl-fx')?.animate([{ opacity: 1 }, { opacity: 0.72 }], { duration: 1200 });
  if (config.giftsLook === 'esports') $(el, '.gl-fx')?.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 500 });
}

function sheen(el: HTMLElement, delay: number): void {
  $(el, '.gl-fx')?.animate([{ left: '-30%', opacity: 0 }, { opacity: 1, offset: 0.15 }, { left: '120%', opacity: 0 }], { duration: 1000, delay, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'backwards', pseudoElement: '::after' });
}

/** 数字从 0 跳到最终值（「1.2万」「3,200」这类也行） */
function countUp(b: HTMLElement | null, ms: number, delay: number): void {
  if (!b) return;
  const target = b.textContent ?? '';
  const n = parseFloat(target.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 2) return;
  const suffix = target.replace(/^[\d.,]+/, '');
  const t0 = performance.now() + delay;
  b.textContent = `0${suffix}`;
  const step = (t: number): void => {
    const p = Math.min(1, Math.max(0, (t - t0) / ms));
    b.textContent = p >= 1 ? target : `${Math.round(n * (1 - Math.pow(1 - p, 3)))}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 名单里显示哪些 ----------

/** 名单里显示的行（排好顺序）；置顶的记录不在下面重复显示 */
function shown(): GiftRow[] {
  if (pinnedOnly()) return pins;
  const all = giftRowsSorted(rows.values(), f());
  const top = new Set(headPins().map((p) => p.ref));
  return top.size ? all.filter((r) => !top.has(r.id)) : all;
}

function make(r: GiftRow): HTMLElement {
  const el = build(r);
  els.set(r.id, el);
  return el;
}

/** 上面不滚动的部分：标题、置顶的记录 */
function drawHead(): void {
  const title = config.giftsTitle?.trim();
  const top = headPins();
  head.replaceChildren();
  if (title) head.append(h('div', { class: 'gl-title' }, h('span', {}, title)));
  if (top.length) head.append(h('div', { class: 'gl-pins' }, ...top.map(build)));
  head.hidden = !title && !top.length;
}

// ---------- 滚动 ----------
// 片尾字幕、逐条上移、跑马灯：所有的行排成一串往上（往左）走，滚出去的一行挪到最后面接着滚，首尾直接接上；
// 翻页：按一屏放得下几条分页，只显示这一页。一屏放得下时都不动。
// 设成不滚动时固定挂着，放不下时按时间排的去掉最旧的，按金额排的去掉最少的。
// 位置都按排版尺寸算（字号大时整体放大过，不受动画影响）；跑马灯按横向算

/** 滚过去多少（竖着是往上，跑马灯是往左） */
let offset = 0;
let scrolling = false;
let lastT = 0;
/** 逐条上移、翻页：已经停了多久；逐条上移：正在挪的这一下过了多久（-1 为没在挪） */
let holdT = 0;
let moveT = -1;
/** 翻页：第几页、每页第一条在画出来的行里排第几、是不是正在换页 */
let page = 0;
let pages: number[] = [];
let turning = false;
/** 相邻两条的间距（每种外观不一样，按 CSS 里 .gl 的 gap 量） */
let gap = 10;

const zoomK = () => (config.giftsSize === 'large' ? 1.25 : 1);
const pos = (e: HTMLElement) => (horiz() ? e.offsetLeft : e.offsetTop);
const len = (e: HTMLElement) => (horiz() ? e.offsetWidth : e.offsetHeight) + gap;
/** 一条（含间距）多高（放大前）：按画出来的第一条量，还没画时按标准尺寸算 */
const rowH = () => ((list.firstElementChild as HTMLElement | null)?.offsetHeight ?? 86) + gap;
const drawn = () => [...list.children] as HTMLElement[];
const setOffset = () => (list.style.transform = offset ? (horiz() ? `translateX(${-offset}px)` : `translateY(${-offset}px)`) : '');

/**
 * 滚动窗口能显示的高度（放大前）：浏览器源去掉上面标题、置顶的高度，和「一屏几条」（减去置顶的条数）取小的那个。
 * 浏览器源比设置的条数高时，把窗口缩到那么高（上下淡出也跟着走），多出来的部分空着
 */
function viewH(): number {
  const k = zoomK();
  const headH = head.hidden ? 0 : head.getBoundingClientRect().height / k;
  const want = Math.max(1, config.giftsMax - headPins().length) * rowH();
  const avail = Math.max(rowH(), innerHeight / k - headH);
  const fits = want + 40 < avail;
  view.style.height = `${Math.ceil((fits ? want + 40 : avail) * k)}px`;
  return (fits ? want + 40 : avail) - 40;
}
/** 一屏能放多长：竖着是高，跑马灯是宽（左边标题以外的整行） */
function viewLen(): number {
  if (!horiz()) return viewH();
  view.style.height = '';
  return view.getBoundingClientRect().width / zoomK() - 40;
}

/** 不滚动时：放不下就去掉一些（按时间排的从最上面最旧的开始，按金额排的从最下面最少的开始） */
function trimStatic(): void {
  const fromEnd = byValue();
  let content = drawn().reduce((sum, r) => sum + len(r), 0);
  const limit = viewLen();
  for (let el = (fromEnd ? list.lastElementChild : list.firstElementChild) as HTMLElement | null; el && content > limit; el = (fromEnd ? list.lastElementChild : list.firstElementChild) as HTMLElement | null) {
    content -= len(el);
    el.remove();
  }
}

/** 内容比一屏多时开始滚，放得下时停下、回到开头；设成不滚动时只留放得下的；翻页时重新分页 */
function updateScrolling(): void {
  if (still()) return trimStatic();
  if (config.giftsMotion === 'page') return paginate();
  const content = drawn().reduce((sum, r) => sum + len(r), 0);
  const need = content > viewLen();
  if (need === scrolling) return;
  scrolling = need;
  if (!need) {
    // 停下：按顺序重新排好，回到开头
    offset = 0;
    setOffset();
    redraw();
  }
}

/** 翻页：按一屏放得下几条分页（每页第一条的序号），只显示这一页 */
function paginate(): void {
  const all = drawn();
  for (const r of all) r.hidden = false;
  const limit = viewLen();
  pages = [];
  let used = Infinity;
  all.forEach((r, i) => {
    const l = len(r);
    if (used + l > limit) {
      pages.push(i);
      used = 0;
    }
    used += l;
  });
  if (page >= pages.length) page = 0;
  scrolling = pages.length > 1;
  showPage(false);
}
function showPage(animate: boolean): void {
  const all = drawn();
  const from = pages[page] ?? 0;
  const to = pages[page + 1] ?? all.length;
  let k = 0;
  all.forEach((r, i) => {
    r.hidden = i < from || i >= to;
    if (!r.hidden && animate) r.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 70 * k++, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  });
  dots.replaceChildren(...(pages.length > 1 ? pages.map((_, i) => h('i', { class: i === page ? 'on' : '' })) : []));
}

/** 第一条整个滚出去了：挪到最后面接着滚 */
function wrap(): void {
  for (let first = list.firstElementChild as HTMLElement | null; first && offset >= len(first); first = list.firstElementChild as HTMLElement | null) {
    offset -= len(first);
    list.append(first);
  }
}

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** 逐条上移：停一会儿，用 0.7 秒挪上去一条 */
function tickStep(dt: number): void {
  const first = list.firstElementChild as HTMLElement | null;
  if (!first) return;
  if (moveT < 0) {
    holdT += dt;
    if (holdT >= GIFTS_STEP_HOLD[config.giftsSpeed]) {
      holdT = 0;
      moveT = 0;
    }
    return;
  }
  moveT += dt;
  const p = Math.min(1, moveT / 0.7);
  offset = ease(p) * len(first);
  if (p >= 1) {
    wrap();
    offset = 0;
    moveT = -1;
  }
}

/** 翻页：停够了，这一页的行依次淡出往上，下一页的依次进来 */
function tickPage(dt: number): void {
  if (turning || pages.length < 2) return;
  holdT += dt;
  if (holdT < GIFTS_PAGE_HOLD[config.giftsSpeed]) return;
  holdT = 0;
  turning = true;
  const outs = drawn()
    .filter((r) => !r.hidden)
    .map((r, i) => r.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-16px)' }], { duration: 320, delay: 50 * i, easing: 'ease-in', fill: 'forwards' }));
  void Promise.all(outs.map((a) => a.finished.catch(() => undefined))).then(() => {
    for (const a of outs) a.cancel();
    turning = false;
    if (config.giftsMotion !== 'page' || pages.length < 2) return;
    page = (page + 1) % pages.length;
    showPage(true);
  });
}

function tick(t: number): void {
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  if (scrolling && config.giftsEnabled && !still()) {
    const m = config.giftsMotion;
    if (m === 'page') tickPage(dt);
    else {
      if (m === 'step') tickStep(dt);
      else {
        offset += (m === 'marquee' ? GIFTS_MARQUEE_PX : GIFTS_SPEED_PX)[config.giftsSpeed] * dt;
        wrap();
      }
      setOffset();
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- 新的一行、变了的一行 ----------

/** 插到排序上该在的位置 */
function insertSorted(row: GiftRow, el: HTMLElement): void {
  const cmp = giftRowCompare(f());
  const next = drawn().find((e) => {
    const r = rows.get(e.dataset.id!);
    return r !== undefined && cmp(row, r) < 0;
  });
  list.insertBefore(el, next ?? null);
}

/** 不滚动时：插到排序上该在的位置，别的行平滑挪开 */
function placeStatic(row: GiftRow, el: HTMLElement, old: HTMLElement | undefined): void {
  const before = new Map(drawn().map((e) => [e, pos(e)] as const));
  old?.remove();
  insertSorted(row, el);
  if (still()) trimStatic();
  const axis = horiz() ? 'translateX' : 'translateY';
  for (const e of drawn()) {
    const p0 = before.get(e);
    if (p0 !== undefined && p0 !== pos(e)) e.animate([{ transform: `${axis}(${p0 - pos(e)}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  if (el.isConnected) (old ? bump : enter)(el);
}

/** 翻页时：插到排序上该在的位置，重新分页（停在这一页）；在这一页上就播进场 */
function placePaged(row: GiftRow, el: HTMLElement, old: HTMLElement | undefined): void {
  old?.remove();
  insertSorted(row, el);
  paginate();
  if (!el.hidden) (old ? bump : enter)(el);
}

/** 滚动中：按时间排的插在下边缘（跑马灯是右边缘）、马上要滚进来的位置（不用等一整轮）；按金额排的插在排序上的下一行前面（首尾相接，最少的接在第一名前面） */
function placeScrolling(row: GiftRow, el: HTMLElement, old: HTMLElement | undefined): void {
  if (old?.isConnected) {
    if (pos(old) < offset) offset -= len(old);
    old.remove();
  }
  let ref: HTMLElement | null = null;
  if (!byValue()) {
    const edge = offset + viewLen();
    ref = drawn().find((r) => pos(r) >= edge) ?? null;
  } else {
    const order = shown();
    const i = order.findIndex((r) => r.id === row.id);
    for (let j = 1; j < order.length && !ref; j++) {
      const e = els.get(order[(i + j) % order.length]!.id);
      if (e?.isConnected) ref = e;
    }
  }
  const at = ref ? pos(ref) : Infinity;
  list.insertBefore(el, ref);
  // 插在已经滚过去的部分：后面的整体挪了一条，跟着挪，画面不跳
  if (at < offset) offset += len(el);
  setOffset();
  if (pos(el) + len(el) - gap > offset && pos(el) < offset + viewLen()) (old ? bump : enter)(el);
}

function upsert(row: GiftRow): void {
  rows.set(row.id, row);
  for (const id of giftRowsTrim(rows, f())) {
    els.get(id)?.remove();
    els.delete(id);
  }
  if (pinnedOnly() || !rows.has(row.id) || !shown().some((r) => r.id === row.id)) return;
  // 以前画过、但不滚动时被挤掉了的：算新来的
  const prev = els.get(row.id);
  const old = prev?.isConnected ? prev : undefined;
  const el = make(row);
  if (!still() && config.giftsMotion === 'page') placePaged(row, el, old);
  else if (scrolling) placeScrolling(row, el, old);
  else placeStatic(row, el, old);
  renumber();
  updateScrolling();
}

/** 刚挂上的一条：在置顶里、或者在名单上看得到（不在别的页、没滚出去、没被挤掉）时播进场 */
function enterPin(id: string): void {
  const el = els.get(id) ?? head.querySelector<HTMLElement>(`.gl-row[data-id="${id}"]`);
  if (!el?.isConnected || el.hidden) return;
  if (head.contains(el) || (pos(el) + len(el) - gap > offset && pos(el) < offset + viewLen())) enter(el);
}

/** 按现在的设置重新画一遍（不要动画） */
function redraw(): void {
  drawHead();
  els.clear();
  list.replaceChildren();
  dots.replaceChildren();
  scrolling = false;
  offset = 0;
  holdT = 0;
  moveT = -1;
  page = 0;
  pages = [];
  turning = false;
  setOffset();
  for (const r of shown()) list.append(make(r));
  const cs = getComputedStyle(list);
  gap = parseFloat(horiz() ? cs.columnGap : cs.rowGap) || 0;
  renumber();
  updateScrolling();
}

function applyConfig(next: OverlayConfig): void {
  const keys = ['giftsSize', 'giftsMax', 'giftsTitle', 'giftsLook', 'giftsMotion'] as const;
  // 关掉期间名单是隐藏的（量出来的高度是 0）：重新打开时也要重新排，不然滚动、翻页不对
  const redrawNeeded = keys.some((k) => next[k] !== config[k]) || (next.giftsEnabled && !config.giftsEnabled) || (next.giftsSpeed === 'off') !== (config.giftsSpeed === 'off') || JSON.stringify(next.giftsFilter) !== JSON.stringify(config.giftsFilter);
  config = next;
  const lite = q.get('lite') === '1' || config.liteMode === 'on' || (config.liteMode === 'auto' && !env.blur);
  root.className = `gl-root look-${config.giftsLook} motion-${config.giftsMotion} side-${config.giftsSide}${config.giftsSize === 'large' ? ' large' : ''}${lite ? ' lite' : ''}${config.giftsEnabled ? '' : ' off'}`;
  // 弥散外观：卡片的不透明度（后台设的是透明度）
  root.style.setProperty('--dif-a', String((100 - config.giftsAlpha) / 100));
  if (redrawNeeded) redraw();
}

addEventListener('resize', () => redraw());
// 字体（手写字、像素字、窄体数字）后加载完，每条的大小会变：重新量一下
document.fonts?.addEventListener('loadingdone', () => updateScrolling());

// ---------- 连接 ----------

let conn: Conn | null = null;
const build0 = pageBuild();
const onBuild = autoUpdate(build0, () => false);

function setRows(next: GiftRow[]): void {
  rows.clear();
  for (const r of next) rows.set(r.id, r);
}

function onMessage(m: ServerToOverlay): void {
  switch (m.type) {
    case 'hello':
      onBuild(m.build);
      applyConfig(m.config);
      setRows(m.gifts ?? []);
      pins = m.pins ?? [];
      redraw();
      conn?.send({ type: 'report', env: { ...detect(), lite: root.classList.contains('lite'), gifts: true, build: build0, ...(q.get('view') === '1' ? { view: true } : {}) } });
      break;
    case 'config':
      applyConfig(m.config);
      break;
    case 'gift_row':
      upsert(m.row);
      break;
    case 'gifts_set':
      setRows(m.rows);
      redraw();
      break;
    case 'gift_pins': {
      const had = new Set(pins.map((p) => p.id));
      pins = m.items;
      if (!pinnedOnly() && !f().pinTop) break;
      redraw();
      // 新挂上的：画面上看得到时播进场（别的行不动）
      for (const p of pins) if (!had.has(p.id)) enterPin(p.id);
      break;
    }
    case 'version':
      onBuild(m.build);
      break;
  }
}

applyConfig(config);

// 预览模式（管理后台里的 iframe）：只接收同源页面发来的消息，不连服务端
if (preview) {
  addEventListener('message', (e: MessageEvent<ServerToOverlay>) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    onMessage(e.data);
  });
  parent.postMessage({ type: 'starfall-preview-ready' }, location.origin);
} else {
  const output = q.get('output');
  const key = q.get('key');
  if (output && key) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay?output=${encodeURIComponent(output)}&key=${encodeURIComponent(key)}&view=gifts`;
    conn = connect(url, {
      onMessage,
      onFatal: () => notice('送礼名单地址已失效', '可能是重置了密钥或删除了这个输出，请在星临管理后台「直播软件输出」重新复制地址'),
    });
  } else {
    notice('这是星临送礼名单', '请在管理后台「直播软件输出」复制完整地址粘贴到浏览器源');
  }
}

function notice(title: string, detail: string): void {
  root.querySelector('.notice')?.remove();
  root.append(h('div', { class: 'notice' }, title, h('small', {}, detail)));
}

// 方便在浏览器控制台里调试
(window as unknown as { starfall: unknown }).starfall = { push: upsert, get config() { return config; } };
