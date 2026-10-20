// 弹幕列表：直播间里所有人的弹幕排成一列，新的从下面进来，旧的往上顶，最多显示设置的条数（放不下时少显示几条）。
// 地址形如 /overlay/?output=1&key=...&chat=1，在直播软件里单独加一个浏览器源（建议 600×900），拖到画面左边或右边。
// 可以设成没人发弹幕多少秒后，从最旧的开始一条一条淡出（chatFadeSec，0 为一直显示）。设计见 design/preview/chat-list.html；
// 小八主题外观（奶油贴纸、星月夜空、像素小屋）在 chat-theme.ts。毛玻璃在带透明度动画的父元素里会失效：透明度只加在气泡、头像本身，外层只做位移
import './chat.css';
import { CHAT_MAX_LIMIT, GUARD_BADGES } from '@starfall/shared/overlay';
import type { ChatItem, OverlayConfig, ServerToOverlay } from '@starfall/shared/overlay';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { segments } from './chat-text.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
import { avatar, fallbackColors, withGuardFrame } from './parts.ts';
import { buildThemed, isTheme, mountThemed, themeAlpha, themeClass } from './chat-theme.ts';
import { DEFAULT_CONFIG } from './stage.ts';
import { autoUpdate, pageBuild } from './update.ts';

const q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1';
const env = detect();

let config: OverlayConfig = { ...DEFAULT_CONFIG };
/** 最近收到的弹幕（最多 CHAT_MAX_LIMIT 条）：改设置（例如粉丝牌显示范围、条数调大）时按它重新画 */
let items: ChatItem[] = [];

document.getElementById('stage')?.remove();
const root = h('div', { class: 'chat-root' });
const list = h('div', { class: 'chat' });
root.append(list);
document.body.append(root);
document.documentElement.classList.add('chat-page');
// 在浏览器里查看（&view=1）：深色背景，看得清
if (q.get('view') === '1' && !preview) document.documentElement.classList.add('chat-view');

function img(cls: string, src: string, alt = ''): HTMLImageElement {
  const el = h('img', { class: cls });
  el.alt = alt;
  el.referrerPolicy = 'no-referrer';
  el.onerror = () => el.remove();
  el.src = src;
  return el;
}

// ---------- 一条弹幕 ----------

function build(item: ChatItem): HTMLElement {
  if (isTheme(config)) return buildThemed(item, config, !!item.viewer.medal && (config.chatMedal === 'all' || item.viewer.medal.own));
  const v = item.viewer;
  const guard = v.guard !== 0;
  const cls = ['msg'];
  if (guard) cls.push('guard', `lv-${v.guard}`);
  if (v.anchor) cls.push('anchor');
  const el = h('div', { class: cls.join(' ') });

  const av = avatar({ name: v.name, guard: v.guard, isMod: v.isMod, ...(v.face ? { face: v.face } : {}) });
  const avw = h('div', { class: 'avw' }, guard ? withGuardFrame(av, v.guard) : av);

  // 身份：主播 / 船锚 / 房 / 粉丝牌 / 荣耀勋章，然后是昵称（和 B 站弹幕里的顺序一样）
  const who = h('div', { class: 'who' });
  if (v.anchor) who.append(h('span', { class: 'zb' }, '主播'));
  if (guard) who.append(img('badge', GUARD_BADGES[v.guard as 1 | 2 | 3]));
  if (v.isMod) who.append(h('i', { class: 'fang' }, '房'));
  const m = v.medal;
  if (m && (config.chatMedal === 'all' || m.own)) {
    const c = m.colors ?? fallbackColors(m.level, guard);
    who.append(h('span', { class: 'medal', style: { '--mc': c.bg, '--ml': c.level, '--mb': c.border, '--mt': c.text } }, h('span', {}, m.name), h('b', {}, String(m.level))));
  }
  if (v.honor?.url) who.append(img('honor', v.honor.url));
  who.append(h('span', { class: 'nm' }, v.name));

  const body = item.sticker
    ? img('sticker', item.sticker.url, item.text)
    : h('div', { class: 'tx' }, ...segments(item.text, item.emots).map((s) => ('img' in s ? img('em', s.img, s.alt) : s.text)));
  const g = h('div', { class: 'g' }, h('div', { class: 'gl' }, h('div', { class: 'sheen' })), who, body);
  el.append(avw, g);
  return el;
}

const anim = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => el.animate(kf, { fill: 'both', ...o });
/** 进场动画：只在开始前（延迟期间）保持起始样子，播完就放开，不然会一直压住「快被顶走的两条变淡」写的透明度 */
const animIn = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => el.animate(kf, { fill: 'backwards', ...o });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 一条里面加透明度的部分：玻璃外观是气泡和头像，主题外观是头像和气泡外层（主题外观没有毛玻璃，加在外层没关系） */
const PARTS = ':scope > .g, :scope > .avw, :scope > .gw';

/** 列表满了时，最上面两条淡一点（快要离开了）；透明度加在气泡和头像本身 */
function fadeAged(): void {
  const rows = [...list.children].filter((r) => !(r as HTMLElement).dataset.out) as HTMLElement[];
  const max = config.chatMax;
  rows.forEach((r, i) => {
    const age = rows.length - 1 - i;
    const o = max < 4 ? '' : age >= max - 1 ? '0.55' : age >= max - 2 ? '0.78' : '';
    for (const e of r.querySelectorAll<HTMLElement>(PARTS)) e.style.opacity = o;
  });
}

function enter(el: HTMLElement, item: ChatItem): void {
  if (reduced()) return;
  const right = config.chatSide === 'right';
  if (isTheme(config)) return enterThemed(el, right);
  const g = el.querySelector<HTMLElement>(':scope > .g')!;
  const av = el.querySelector<HTMLElement>(':scope > .avw')!;
  // 头像先弹出来，气泡从头像那边展开，身份和内容跟着出现
  animIn(av, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.12)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  g.style.transformOrigin = right ? '100% 0' : '0 0';
  animIn(g, [{ opacity: 0, transform: `translateX(${right ? 18 : -18}px) scale(.7)` }, { opacity: 1, transform: 'translateX(0) scale(1.02)', offset: 0.65 }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 70, easing: 'cubic-bezier(.2,.9,.3,1)' });
  animIn(g.querySelector('.who')!, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 200, easing: 'ease-out' });
  const body = g.querySelector('.tx, .sticker');
  if (body) {
    const st = body.classList.contains('sticker');
    animIn(body, [{ opacity: 0, transform: st ? 'scale(.5) rotate(-8deg)' : 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: st ? 480 : 320, delay: 260, easing: st ? 'cubic-bezier(.3,1.6,.5,1)' : 'ease-out' });
  }
  // 大航海、主播：一道高光扫过
  if (item.viewer.guard || item.viewer.anchor) {
    const sweep = right ? ['translateX(420%) skewX(-18deg)', 'translateX(-120%) skewX(-18deg)'] : ['translateX(-120%) skewX(-18deg)', 'translateX(420%) skewX(-18deg)'];
    animIn(g.querySelector('.sheen')!, [{ opacity: 0, transform: sweep[0] }, { opacity: 1, offset: 0.25 }, { opacity: 0, transform: sweep[1] }], { duration: 900, delay: 360, easing: 'cubic-bezier(.45,0,.3,1)' });
  }
}

/** 主题外观：头像先弹出来，小八晚一点探出头，气泡从头像那边弹开 */
function enterThemed(el: HTMLElement, right: boolean): void {
  const flip = right ? 'scaleX(-1) ' : '';
  const av = el.querySelector<HTMLElement>(':scope > .avw')!;
  const gw = el.querySelector<HTMLElement>(':scope > .gw')!;
  animIn(av, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.1)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  gw.style.transformOrigin = right ? '100% 50%' : '0 50%';
  animIn(gw, [{ opacity: 0, transform: `translateX(${right ? 18 : -18}px) scale(.7)` }, { opacity: 1, transform: 'translateX(0) scale(1.03)', offset: 0.65 }, { opacity: 1, transform: 'none' }], { duration: 440, delay: 70, easing: 'cubic-bezier(.2,.9,.3,1)' });
  const cat = el.querySelector<HTMLElement>('.cat');
  if (cat) animIn(cat, [{ opacity: 0, transform: `${flip}translateY(14px) scale(.6)` }, { opacity: 1, transform: `${flip}translateY(-3px) scale(1.06)`, offset: 0.7 }, { opacity: 1, transform: `${flip}none` }], { duration: 460, delay: 340, easing: 'ease-out' });
}

// ---------- 自动消失 ----------
// 没人发弹幕一段时间（chatFadeSec）后，从最上面最旧的那条开始，每隔 FADE_STEP_MS 淡出一条；有新弹幕来就重新计时。
// 新弹幕照样会把最旧的顶走（满了的时候）
const FADE_STEP_MS = 2000;
const fadeMs = () => (config.chatFadeSec > 0 ? config.chatFadeSec * 1000 : 0);
/** 最近一条弹幕来的时间（本机时间）；打开页面时补上的旧弹幕按它发出的时间算，不晚于现在 */
let lastArrival = Date.now();
let lastExpire = 0;
function expire(el: HTMLElement): void {
  if (el.dataset.out) return;
  el.dataset.out = '1';
  if (reduced()) return void el.remove();
  // 列表从底部往上排，最上面的最旧：原地淡出、往上飘一点，下面的不会跳
  const parts = el.querySelectorAll<HTMLElement>(PARTS);
  let done = 0;
  for (const p of parts) {
    anim(p, [{ opacity: Number(p.style.opacity || 1), transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 700, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(
      () => ++done === parts.length && el.remove(),
      () => el.remove(),
    );
  }
}
setInterval(() => {
  const ms = fadeMs();
  if (!ms) return;
  const now = Date.now();
  if (now - lastArrival < ms || now - lastExpire < FADE_STEP_MS) return;
  const oldest = [...list.children].find((r) => !(r as HTMLElement).dataset.out) as HTMLElement | undefined;
  if (!oldest) return;
  lastExpire = now;
  expire(oldest);
  // 消失的弹幕不再画回来（改设置、源的大小变了时会重画）
  const visible = list.querySelectorAll(':scope > :not([data-out])').length;
  items = visible ? items.slice(-visible) : [];
}, 300);

/** 加一条：旧的往上挪（FLIP：先记下位置，插入后从旧位置滑过去）；超过条数或放不下时，最上面的淡出 */
function add(item: ChatItem, quiet = false, remember = true): void {
  if (remember) items = [...items, item].slice(-CHAT_MAX_LIMIT);
  // 设成「黑名单的人不显示」：记下来（改设置时还能显示回来），但不画
  if (config.chatHideBlocked && item.viewer.blocked) return;
  const before = new Map([...list.children].map((r) => [r, r.getBoundingClientRect().top]));
  const el = build(item);
  if (!quiet) lastArrival = Date.now();
  list.append(el);
  if (isTheme(config)) mountThemed(el, config);
  const leaving: HTMLElement[] = [];
  const live = [...list.children].filter((r) => !(r as HTMLElement).dataset.out) as HTMLElement[];
  while (live.length > 1 && (live.length > config.chatMax || list.offsetHeight > root.clientHeight)) {
    const old = live.shift()!;
    old.dataset.out = '1';
    if (quiet || reduced()) {
      old.remove();
      continue;
    }
    old.style.cssText = 'position:absolute;left:0;right:0;top:0';
    leaving.push(old);
  }
  const top0 = list.getBoundingClientRect().top;
  for (const old of leaving) {
    old.style.top = `${(before.get(old) ?? top0) - top0}px`;
    const out = [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-40px) scale(.94)' }];
    const parts = old.querySelectorAll<HTMLElement>(PARTS);
    let done = 0;
    for (const p of parts) {
      out[0]!.opacity = Number(p.style.opacity || 1);
      anim(p, out, { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(
        () => ++done === parts.length && old.remove(),
        () => old.remove(),
      );
    }
  }
  fadeAged();
  if (quiet || reduced()) return;
  for (const [r, y0] of before) {
    if ((r as HTMLElement).dataset.out) continue;
    const dy = y0 - r.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  enter(el, item);
}

/** 按现在的设置重新画一遍（不要动画） */
function redraw(): void {
  list.replaceChildren();
  const shown = config.chatHideBlocked ? items.filter((it) => !it.viewer.blocked) : items;
  for (const it of shown.slice(-config.chatMax)) add(it, true, false);
}

function applyConfig(next: OverlayConfig): void {
  const keys = ['chatMedal', 'chatSize', 'chatMax', 'chatFadeSec', 'chatLook', 'chatGuardFrame', 'chatMascot', 'chatHideBlocked'] as const;
  // 主题外观的气泡是按左右画的：换边也要重画
  const redrawNeeded = keys.some((k) => next[k] !== config[k]) || (isTheme(next) && next.chatSide !== config.chatSide);
  config = next;
  const lite = q.get('lite') === '1' || config.liteMode === 'on' || (config.liteMode === 'auto' && !env.blur);
  root.className = `chat-root side-${config.chatSide}${config.chatSize === 'large' ? ' large' : ''}${lite ? ' lite' : ''}${config.chatEnabled ? '' : ' off'}${themeClass(config)}`;
  if (isTheme(config)) root.style.setProperty('--bga', String(themeAlpha(config)));
  if (redrawNeeded) redraw();
}

// 源的高度变了（在直播软件里改了宽高）：放不下的去掉
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
      items = (m.chat ?? []).slice(-CHAT_MAX_LIMIT);
      lastArrival = Math.min(items[items.length - 1]?.ts ?? Date.now(), Date.now());
      redraw();
      conn?.send({ type: 'report', env: { ...detect(), lite: root.classList.contains('lite'), chat: true, build: build0, ...(q.get('view') === '1' ? { view: true } : {}) } });
      break;
    case 'config':
      applyConfig(m.config);
      break;
    case 'chat':
      add(m.item);
      break;
    case 'chat_clear':
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
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay?output=${encodeURIComponent(output)}&key=${encodeURIComponent(key)}&view=chat`;
    conn = connect(url, {
      onMessage,
      onFatal: () => notice('弹幕列表地址已失效', '可能是重置了密钥或删除了这个输出，请在星临管理后台「直播软件输出」重新复制地址'),
    });
  } else {
    notice('这是星临弹幕列表', '请在管理后台「直播软件输出」复制完整地址粘贴到浏览器源');
  }
}

function notice(title: string, detail: string): void {
  root.querySelector('.notice')?.remove();
  root.append(h('div', { class: 'notice' }, title, h('small', {}, detail)));
}

// 方便在浏览器控制台里调试
(window as unknown as { starfall: unknown }).starfall = { add, get config() { return config; } };
