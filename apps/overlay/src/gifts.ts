// 送礼名单：后台选的那段时间（本场、今天、本周、本月、从某个时间起）收到的礼物、上舰、醒目留言，每次一条彩色小横条（和礼物特效同一套样子），
// 或者按人合计（感谢榜：每人一条，按总价值排，前三名金银铜）。一屏放不下时从下往上循环滚动。
// 名单由服务端算好（合并、按人合计、按金额排要用到全部记录），这里只管画：新的一行插到该在的位置，已有的一行变了就换掉、挪过去。
// 设成「只显示挂上的记录」时只显示后台挂上的那几条；打开「置顶」时挂上的记录固定在最上面，下面接着自动名单。上面可以有一行标题。
// 地址形如 /overlay/?output=1&key=...&gifts=1，在直播软件里单独加一个浏览器源（建议 640 宽），拖到画面一侧
import './gifts.css';
import { GUARD_BADGES, GIFTS_SPEED_PX, giftRowCompare, giftRowsSorted, giftRowsTrim, giftsView } from '@starfall/shared/overlay';
import type { GiftListItem, GiftRankRow, GiftRow, OverlayConfig, ServerToOverlay } from '@starfall/shared/overlay';
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
/** 服务端算好的名单：行号 → 一行（改设置时按它重新画） */
const rows = new Map<string, GiftRow>();
/** 后台挂上的记录（按顺序） */
let pins: GiftListItem[] = [];
/** 画出来的行：行号 → 元素 */
const els = new Map<string, HTMLElement>();

document.getElementById('stage')?.remove();
const root = h('div', { class: 'gl-root' });
/** 上面不滚动的部分：标题、置顶的记录 */
const head = h('div', { class: 'gl-head' });
/** 滚动的窗口（上下两头淡出） */
const view = h('div', { class: 'gl-view' });
const list = h('div', { class: 'gl' });
view.append(list);
root.append(head, view);
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

const f = () => config.giftsFilter;
const pinnedOnly = () => f().mode === 'pinned';
/** 置顶的记录（最多占一屏少一条，下面至少留一条给自动名单） */
const headPins = () => (!pinnedOnly() && f().pinTop ? pins.slice(0, Math.max(0, config.giftsMax - 1)) : []);
/** 按金额排、按人合计：多的在上，放不下时去掉下面的 */
const byValue = () => giftsView(f()) === 'viewer' || f().sort === 'value';

// ---------- 一行 ----------

function build(it: GiftRow): HTMLElement {
  const el = it.kind === 'viewer' ? buildRank(it) : buildItem(it);
  el.dataset.id = it.id;
  return el;
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
    num = h('span', { class: 'gl-num months' }, h('small', {}, '×'), String(g.months), h('small', {}, '个月'));
  } else if (it.kind === 'sc' && it.sc) {
    line = h('span', { class: 'say sc' }, it.sc.text || '醒目留言');
    pic = h('span', { class: 'gl-sc' }, 'SC');
    num = h('span', { class: 'gl-num yuan' }, String(Math.round(it.sc.price)), h('small', {}, '元'));
  } else {
    const g = it.gift!;
    line = say('送出 ', g.name);
    if (it.times && it.times > 1) line.append(h('span', { class: 'times' }, ` · ${it.times} 次`));
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
  const amount = f().amount !== false;
  return h(
    'div',
    { class: `gl-row kind-viewer${pic ? '' : ' no-pic'}${amount ? '' : ' no-num'}`, style: tierVars(tier) },
    h('div', { class: 'gl-bar' }, h('i', { class: 'gl-clip' }, h('i', { class: 'gl-sheen' })), h('span', { class: 'gl-rank' }), withGuardFrame(avatar({ ...v, isMod: false }), v.guard), h('div', { class: 'gl-tx' }, h('span', { class: 'nm' }, v.name), h('span', { class: 'say' }, parts.join(' · ')))),
    pic ? h('div', { class: 'gl-pic' }, pic) : null,
    amount ? h('span', { class: 'gl-num amt' }, battery(r.value), h('small', {}, '电池')) : null,
  );
}

/** 按人合计：写上名次（前三名金银铜） */
function renumber(): void {
  if (giftsView(f()) !== 'viewer') return;
  shown().forEach((r, i) => {
    const el = els.get(r.id)?.querySelector('.gl-rank');
    if (!el) return;
    el.textContent = String(i + 1);
    el.className = `gl-rank${i < 3 ? ` r${i + 1}` : ''}${i >= 99 ? ' small' : ''}`;
  });
}

/** 新来的一行：从下面浮上来，礼物图弹一下 */
function enter(el: HTMLElement): void {
  el.animate([{ opacity: 0, transform: 'translateY(40px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
  el.querySelector('.gl-pic')?.animate([{ opacity: 0, transform: 'scale(.3) rotate(-16deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' });
  el.querySelector('.gl-num')?.animate([{ opacity: 0, transform: 'translateY(-50%) scale(2.2)' }, { opacity: 1, transform: 'translateY(-50%) scale(.92)', offset: 0.7 }, { opacity: 1, transform: 'translateY(-50%)' }], { duration: 480, delay: 360, easing: 'ease-out', fill: 'backwards' });
  sheen(el, 420);
}

/** 已有的一行变了（又送了一次）：整条跳一下，数字弹一下 */
function bump(el: HTMLElement): void {
  el.animate([{ transform: 'none' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
  el.querySelector('.gl-num')?.animate([{ transform: 'translateY(-50%) scale(1.7)', opacity: 0.5 }, { transform: 'translateY(-50%)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  sheen(el, 120);
}

function sheen(el: HTMLElement, delay: number): void {
  el.querySelector('.gl-sheen')?.animate([{ left: '-30%', opacity: 0 }, { opacity: 1, offset: 0.15 }, { left: '120%', opacity: 0 }], { duration: 1000, delay, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'backwards' });
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

// ---------- 循环滚动 ----------
// 所有的行排成一串往上滚（像片尾字幕），滚出顶部的一行挪到最后面接着滚，首尾直接接上；一屏放得下时不滚。
// 设成不滚动时固定挂着，放不下时按时间排的去掉最旧的，按金额排的去掉最少的。
// 位置都按排版尺寸算（字号大时整体放大过，不受动画影响）

/** 相邻两条的间距（和 CSS 里 .gl 的 gap 一致） */
const GAP = 10;
let offset = 0;
let scrolling = false;
let lastT = 0;

const zoomK = () => (config.giftsSize === 'large' ? 1.25 : 1);
/** 一条（含间距）多高（放大前）：按画出来的第一条量，还没画时按标准尺寸算 */
const rowH = () => ((list.firstElementChild as HTMLElement | null)?.offsetHeight ?? 86) + GAP;
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
const drawn = () => [...list.children] as HTMLElement[];

/** 不滚动时：放不下就去掉一些（按时间排的从最上面最旧的开始，按金额排的从最下面最少的开始） */
function trimStatic(): void {
  const fromEnd = byValue();
  let content = drawn().reduce((sum, r) => sum + r.offsetHeight + GAP, 0);
  const limit = viewH();
  for (let el = (fromEnd ? list.lastElementChild : list.firstElementChild) as HTMLElement | null; el && content > limit; el = (fromEnd ? list.lastElementChild : list.firstElementChild) as HTMLElement | null) {
    content -= el.offsetHeight + GAP;
    el.remove();
  }
}

/** 内容比一屏高时开始滚，放得下时停下、回到开头；设成不滚动时只留放得下的 */
function updateScrolling(): void {
  if (config.giftsSpeed === 'off') return trimStatic();
  const content = drawn().reduce((sum, r) => sum + r.offsetHeight + GAP, 0);
  const need = content > viewH();
  if (need === scrolling) return;
  scrolling = need;
  if (!need) {
    // 停下：按顺序重新排好，回到开头
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

// ---------- 新的一行、变了的一行 ----------

/** 不滚动时：插到排序上该在的位置，别的行平滑挪开 */
function placeStatic(row: GiftRow, el: HTMLElement, old: HTMLElement | undefined): void {
  const before = new Map(drawn().map((e) => [e, e.offsetTop] as const));
  old?.remove();
  const cmp = giftRowCompare(f());
  const next = drawn().find((e) => {
    const r = rows.get(e.dataset.id!);
    return r !== undefined && cmp(row, r) < 0;
  });
  list.insertBefore(el, next ?? null);
  if (config.giftsSpeed === 'off') trimStatic();
  for (const e of drawn()) {
    const y0 = before.get(e);
    if (y0 !== undefined && y0 !== e.offsetTop) e.animate([{ transform: `translateY(${y0 - e.offsetTop}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  if (el.isConnected) (old ? bump : enter)(el);
}

/** 滚动中：按时间排的插在下边缘、马上要滚进来的位置（不用等一整轮）；按金额排的插在排序上的下一行前面（首尾相接，最少的接在第一名前面） */
function placeScrolling(row: GiftRow, el: HTMLElement, old: HTMLElement | undefined): void {
  if (old?.isConnected) {
    if (old.offsetTop < offset) offset -= old.offsetHeight + GAP;
    old.remove();
  }
  let ref: HTMLElement | null = null;
  if (!byValue()) {
    const bottom = offset + viewH();
    ref = drawn().find((r) => r.offsetTop >= bottom) ?? null;
  } else {
    const order = shown();
    const i = order.findIndex((r) => r.id === row.id);
    for (let j = 1; j < order.length && !ref; j++) {
      const e = els.get(order[(i + j) % order.length]!.id);
      if (e?.isConnected) ref = e;
    }
  }
  const top = ref ? ref.offsetTop : Infinity;
  list.insertBefore(el, ref);
  // 插在已经滚过去的部分：下面的整体往下挪了一条，跟着挪，画面不跳
  if (top < offset) offset += el.offsetHeight + GAP;
  list.style.transform = `translateY(${-offset}px)`;
  if (el.offsetTop + el.offsetHeight > offset && el.offsetTop < offset + viewH()) (old ? bump : enter)(el);
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
  if (scrolling) placeScrolling(row, el, old);
  else placeStatic(row, el, old);
  renumber();
  updateScrolling();
}

/** 按现在的设置重新画一遍（不要动画） */
function redraw(): void {
  drawHead();
  els.clear();
  list.replaceChildren();
  scrolling = false;
  offset = 0;
  list.style.transform = '';
  for (const r of shown()) list.append(make(r));
  renumber();
  updateScrolling();
}

function applyConfig(next: OverlayConfig): void {
  const redrawNeeded = next.giftsSize !== config.giftsSize || next.giftsMax !== config.giftsMax || next.giftsTitle !== config.giftsTitle || (next.giftsSpeed === 'off') !== (config.giftsSpeed === 'off') || JSON.stringify(next.giftsFilter) !== JSON.stringify(config.giftsFilter);
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
    case 'gift_pins':
      pins = m.items;
      if (pinnedOnly() || f().pinTop) redraw();
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
(window as unknown as { starfall: unknown }).starfall = { push: upsert, get config() { return config; } };
