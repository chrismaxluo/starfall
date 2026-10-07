// 送礼名单：本场直播（没开播时是上一场）收到的礼物、上舰、醒目留言，每次一条彩色小横条（和礼物特效同一套样子），
// 最新的在最上面，往下顶，最多显示设置的条数（放不下时少显示几条）。连击合成一条。
// 地址形如 /overlay/?output=1&key=...&gifts=1，在直播软件里单独加一个浏览器源（建议 640 宽），拖到画面一侧
import './gifts.css';
import { GUARD_BADGES, GIFTS_KEEP, giftListShows } from '@starfall/shared/overlay';
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
  let tier = tierOf(it.value);
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

/** 新来的一条：从侧面滑进来，礼物图弹一下 */
function enter(el: HTMLElement): void {
  const dx = config.giftsSide === 'right' ? 60 : -60;
  el.animate([{ opacity: 0, transform: `translateX(${dx}px) scale(.96)` }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
  el.querySelector('.gl-pic')?.animate([{ opacity: 0, transform: 'scale(.3) rotate(-16deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' });
  el.querySelector('.gl-num')?.animate([{ opacity: 0, transform: 'scale(2.2)' }, { opacity: 1, transform: 'scale(.92)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 360, easing: 'ease-out', fill: 'backwards' });
  el.querySelector('.gl-sheen')?.animate([{ left: '-30%', opacity: 0 }, { opacity: 1, offset: 0.15 }, { left: '120%', opacity: 0 }], { duration: 1000, delay: 420, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'backwards' });
}

/** 放不下的从最下面淡出 */
function trim(animate: boolean): void {
  const rows = [...list.children] as HTMLElement[];
  // 按排版位置算（不受正在滑动的动画影响）；字号大时整体放大过，换算回放大前的尺寸
  const k = config.giftsSize === 'large' ? 1.25 : 1;
  const limit = root.clientHeight / k - 12;
  rows.forEach((r, i) => {
    if (r.classList.contains('out')) return;
    const over = i >= config.giftsMax || r.offsetTop + r.offsetHeight > limit;
    if (!over) return;
    if (!animate) return void r.remove();
    r.classList.add('out');
    r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-in' }).onfinish = () => r.remove();
  });
}

function add(it: GiftListItem, animate = true): void {
  if (!giftListShows(config.giftsFilter, it)) return;
  // FLIP：记下原来的位置，插到最上面后，让原来的几条从旧位置滑到新位置
  const before = new Map([...list.children].map((r) => [r, (r as HTMLElement).offsetTop]));
  const el = build(it);
  list.prepend(el);
  if (animate) {
    for (const [r, top] of before) {
      const dy = top - (r as HTMLElement).offsetTop;
      if (Math.abs(dy) > 0.5) (r as HTMLElement).animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    enter(el);
  }
  trim(animate);
}

function push(it: GiftListItem): void {
  items = [...items, it].slice(-GIFTS_KEEP);
  add(it);
}

/** 按现在的设置重新画一遍（不要动画）：最新的在上 */
function redraw(): void {
  list.replaceChildren();
  for (const it of items) add(it, false);
}

function applyConfig(next: OverlayConfig): void {
  const redrawNeeded = next.giftsSize !== config.giftsSize || next.giftsMax !== config.giftsMax || JSON.stringify(next.giftsFilter) !== JSON.stringify(config.giftsFilter);
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
      redraw();
      conn?.send({ type: 'report', env: { ...detect(), lite: root.classList.contains('lite'), gifts: true, build: build0, ...(q.get('view') === '1' ? { view: true } : {}) } });
      break;
    case 'config':
      applyConfig(m.config);
      break;
    case 'gift_item':
      push(m.item);
      break;
    case 'gifts_clear':
      items = [];
      list.replaceChildren();
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
