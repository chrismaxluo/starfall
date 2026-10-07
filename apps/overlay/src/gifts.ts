// 送礼名单：本场直播（没开播时是上一场）收到的礼物、上舰、醒目留言，每次一条彩色小横条（和礼物特效同一套样子），
// 按时间先后排成一串，一屏放不下时从下往上循环滚动。连击合成一条。设成「只显示挂上的记录」时只显示后台挂上的那几条。
// 地址形如 /overlay/?output=1&key=...&gifts=1，在直播软件里单独加一个浏览器源（建议 640 宽），拖到画面一侧
import './gifts.css';
import { GUARD_BADGES, GIFTS_KEEP, GIFTS_SPEED_PX, giftListShows } from '@starfall/shared/overlay';
import type { GiftListItem, OverlayConfig, ServerToOverlay } from '@starfall/shared/overlay';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
import { avatar, withGuardFrame } from './parts.ts';
import { DEFAULT_CONFIG } from './stage.ts';
import { guardTier, tierOf, tierVars } from './tiers.ts';
import { autoUpdate, pageBuild } from './update.ts';

const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' } as const;
const q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1';
const env = detect();

let config: OverlayConfig = { ...DEFAULT_CONFIG };
/** 本场收到的（最多 GIFTS_KEEP 条，旧的在前）：改设置（筛选、条数）时按它重新画 */
let items: GiftListItem[] = [];
/** 后台挂上的记录（按顺序）：设成「只显示挂上的记录」时只显示这些 */
let pins: GiftListItem[] = [];

document.getElementById('stage')?.remove();
const root = h('div', { class: 'gl-root' });
const list = h('div', { class: 'gl' });
root.append(list);
document.body.append(root);
document.documentElement.classList.add('gl-page');
if (q.get('view') === '1' && !preview) document.documentElement.classList.add('gl-view');

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

// ---------- 一条 ----------

function build(it: GiftListItem): HTMLElement {
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
    num = h('span', { class: 'gl-num months' }, h('small', {}, '×'), String(g.months), h('small', {}, '个月'));
  } else if (it.kind === 'sc' && it.sc) {
    line = h('span', { class: 'say sc' }, it.sc.text || '醒目留言');
    pic = h('span', { class: 'gl-sc' }, 'SC');
    num = h('span', { class: 'gl-num yuan' }, String(Math.round(it.sc.price)), h('small', {}, '元'));
  } else {
    const g = it.gift!;
    line = say('送出 ', g.name);
    if (g.img) pic = img('gl-img', g.img);
    num = h('span', { class: 'gl-num' }, h('small', {}, '×'), String(g.count));
  }
  return h(
    'div',
    { class: `gl-row kind-${it.kind}${pic ? '' : ' no-pic'}`, style: tierVars(tier) },
    h('div', { class: 'gl-bar' }, h('i', { class: 'gl-clip' }, h('i', { class: 'gl-sheen' })), withGuardFrame(avatar({ ...v, isMod: false }), v.guard), h('div', { class: 'gl-tx' }, h('span', { class: 'nm' }, v.name), line)),
    pic ? h('div', { class: 'gl-pic' }, pic) : null,
    num,
  );
}

/** 新来的一条：从下面浮上来，礼物图弹一下 */
function enter(el: HTMLElement): void {
  el.animate([{ opacity: 0, transform: 'translateY(40px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
  el.querySelector('.gl-pic')?.animate([{ opacity: 0, transform: 'scale(.3) rotate(-16deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' });
  el.querySelector('.gl-num')?.animate([{ opacity: 0, transform: 'scale(2.2)' }, { opacity: 1, transform: 'scale(.92)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 360, easing: 'ease-out', fill: 'backwards' });
  el.querySelector('.gl-sheen')?.animate([{ left: '-30%', opacity: 0 }, { opacity: 1, offset: 0.15 }, { left: '120%', opacity: 0 }], { duration: 1000, delay: 420, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'backwards' });
}

// ---------- 循环滚动 ----------
// 所有的条目排成一串往上滚（像片尾字幕），滚出顶部的一条挪到最后面接着滚，首尾直接接上；一屏放得下时不滚。
// 设成不滚动时固定挂着，放不下只留最新的几条。
// 位置都按排版尺寸算（字号大时整体放大过，不受动画影响）

/** 相邻两条的间距（和 CSS 里 .gl 的 gap 一致） */
const GAP = 10;
let offset = 0;
let scrolling = false;
let lastT = 0;

const zoomK = () => (config.giftsSize === 'large' ? 1.25 : 1);
/** 能显示的高度（放大前） */
/** 一条（含间距）多高（放大前）：按画出来的第一条量，还没画时按标准尺寸算 */
const rowH = () => ((list.firstElementChild as HTMLElement | null)?.offsetHeight ?? 86) + GAP;
/**
 * 能显示的高度（放大前）：浏览器源的高度和「一屏几条」取小的那个。
 * 浏览器源比设置的条数高时，把名单的窗口缩到那么高（上下淡出也跟着走），多出来的部分空着
 */
function viewH(): number {
  const want = config.giftsMax * rowH();
  const k = zoomK();
  const fits = want + 40 < innerHeight / k;
  root.style.height = fits ? `${Math.ceil((want + 40) * k)}px` : '';
  return (fits ? want + 40 : innerHeight / k) - 40;
}
const rows = () => [...list.children] as HTMLElement[];

/** 不滚动时：放不下就从最上面（最旧的）开始去掉，只留最新的几条 */
function trimStatic(): void {
  let content = rows().reduce((sum, r) => sum + r.offsetHeight + GAP, 0);
  for (let first = list.firstElementChild as HTMLElement | null; first && content > viewH(); first = list.firstElementChild as HTMLElement | null) {
    content -= first.offsetHeight + GAP;
    first.remove();
  }
}

/** 内容比一屏高时开始滚，放得下时停下、回到开头；设成不滚动时只留最新的几条 */
function updateScrolling(): void {
  if (config.giftsSpeed === 'off') return trimStatic();
  const content = rows().reduce((sum, r) => sum + r.offsetHeight + GAP, 0);
  const need = content > viewH();
  if (need === scrolling) return;
  scrolling = need;
  if (!need) {
    // 停下：按时间先后重新排好，回到开头
    offset = 0;
    list.style.transform = '';
    redraw();
  }
}

function tick(t: number): void {
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  if (scrolling && config.giftsEnabled) {
    offset += (GIFTS_SPEED_PX[config.giftsSpeed] || GIFTS_SPEED_PX.normal) * dt;
    // 第一条整个滚出顶部：挪到最后面
    for (let first = list.firstElementChild as HTMLElement | null; first && offset >= first.offsetHeight + GAP; first = list.firstElementChild as HTMLElement | null) {
      offset -= first.offsetHeight + GAP;
      list.append(first);
    }
    list.style.transform = `translateY(${-offset}px)`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function add(it: GiftListItem, animate = true): void {
  if (!giftListShows(config.giftsFilter, it)) return;
  const el = build(it);
  if (scrolling) {
    // 插在下边缘、马上要滚进来的位置（不用等一整轮）
    const bottom = offset + viewH();
    const next = rows().find((r) => r.offsetTop >= bottom);
    if (next) list.insertBefore(el, next);
    else list.append(el);
  } else {
    list.append(el);
    if (animate) enter(el);
  }
  updateScrolling();
}

function push(it: GiftListItem): void {
  items = [...items, it].slice(-GIFTS_KEEP);
  add(it);
}

/** 按现在的设置重新画一遍（不要动画）：按时间先后，旧的在上 */
function redraw(): void {
  list.replaceChildren();
  scrolling = false;
  offset = 0;
  list.style.transform = '';
  if (config.giftsFilter.mode === 'pinned') for (const it of pins) list.append(build(it));
  else for (const it of items) if (giftListShows(config.giftsFilter, it)) list.append(build(it));
  updateScrolling();
}

function applyConfig(next: OverlayConfig): void {
  const redrawNeeded = next.giftsSize !== config.giftsSize || next.giftsMax !== config.giftsMax || (next.giftsSpeed === 'off') !== (config.giftsSpeed === 'off') || JSON.stringify(next.giftsFilter) !== JSON.stringify(config.giftsFilter);
  config = next;
  const lite = q.get('lite') === '1' || config.liteMode === 'on' || (config.liteMode === 'auto' && !env.blur);
  root.className = `gl-root side-${config.giftsSide}${config.giftsSize === 'large' ? ' large' : ''}${lite ? ' lite' : ''}${config.giftsEnabled ? '' : ' off'}`;
  if (redrawNeeded) redraw();
}

addEventListener('resize', () => redraw());

// ---------- 连接 ----------

let conn: Conn | null = null;
const build0 = pageBuild();
const onBuild = autoUpdate(build0, () => false);

function onMessage(m: ServerToOverlay): void {
  switch (m.type) {
    case 'hello':
      onBuild(m.build);
      applyConfig(m.config);
      items = (m.gifts ?? []).slice(-GIFTS_KEEP);
      pins = m.pins ?? [];
      redraw();
      conn?.send({ type: 'report', env: { ...detect(), lite: root.classList.contains('lite'), gifts: true, build: build0, ...(q.get('view') === '1' ? { view: true } : {}) } });
      break;
    case 'config':
      applyConfig(m.config);
      break;
    case 'gift_item':
      push(m.item);
      break;
    case 'gift_pins':
      pins = m.items;
      if (config.giftsFilter.mode === 'pinned') redraw();
      break;
    case 'gifts_clear':
      items = [];
      redraw();
      break;
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
(window as unknown as { starfall: unknown }).starfall = { push, get config() { return config; } };
