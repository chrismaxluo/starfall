// 点歌窗口：正在放的歌（封面、歌名、歌手、谁点的、进度）、滚动歌词、后面几首、点歌结果的提示。
// 地址形如 /overlay/?output=1&key=...&music=1，在直播软件里单独加一个浏览器源（建议 640×560），拖到画面一侧。
// 同时加了好几个时只有一个出声音（服务端指定，消息里 player 为 true），别的只显示；在浏览器里查看（&view=1）时只显示不出声。
// 六种样子（display.style），每种的「正在放」各自搭，歌词、接下来、提示共用同一套结构，样子不同：
//   常规：card 玻璃卡片（封面颜色的柔光）、vinyl 黑胶唱片（唱片转动、唱臂落下）、capsule 细长胶囊（一行，占地方最少）；
//   风格：glass 流光（封面的模糊色铺满卡片）、journal 手帐（日系：方格纸、和纸胶带、拍立得封面、荧光笔划线、手写体）、
//   minimal 灵动岛（玻璃小胶囊，换歌、有人点歌时弹性展开显示提示）。
import './music.css';
import { lyricIndex } from '@starfall/shared/overlay';
import type { LyricLine, MusicDisplay, MusicItem, MusicNotice, MusicNow, MusicSong, MusicState, ServerToOverlay } from '@starfall/shared/overlay';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
import { DEFAULT_TINT, tintOf } from './music-tint.ts';
import type { Tint } from './music-tint.ts';
import { avatar, withGuardFrame } from './parts.ts';
import { autoUpdate, pageBuild } from './update.ts';
// 手帐用的手写体（霞鹜文楷，按字切成小块，只下载用到的字）
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';

const q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1';
const browse = q.get('view') === '1' && !preview;
const env = detect();

document.getElementById('stage')?.remove();
document.documentElement.classList.add('mu-page');
if (browse) document.documentElement.classList.add('mu-view');

const root = h('div', { class: 'mu-root' });
const toasts = h('div', { class: 'mu-toasts' });
const card = h('div', { class: 'mu-card' });
const lyric = h('div', { class: 'mu-lyric' });
const queue = h('div', { class: 'mu-queue' });
const idle = h('div', { class: 'mu-idle' });
root.append(toasts, card, lyric, queue, idle);
document.body.append(root);

let state: MusicState | null = null;
let player = false;
/** 收到状态时的本机时间：没暂停时进度按它往后算（不用服务端的时钟，两边时间不准也没关系） */
let gotAt = 0;

// ---------- 小部件 ----------

const NOTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
function icon(svg: string, cls: string): HTMLElement {
  const el = h('i', { class: cls });
  el.innerHTML = svg;
  return el;
}

function img(cls: string, src: string): HTMLImageElement {
  const el = h('img', { class: cls });
  el.alt = '';
  el.referrerPolicy = 'no-referrer';
  el.decoding = 'async';
  el.src = src;
  return el;
}

/** 封面：没有封面时画一个音符 */
function cover(song: MusicSong, cls = 'mu-cover'): HTMLElement {
  return song.cover ? img(cls, song.cover) : h('div', { class: `${cls} blank` }, icon(NOTE_SVG, 'mu-note'));
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 点歌的人：头像（大航海套头像框）+ 昵称 */
function byChip(it: MusicItem, size: number, label = '点歌'): HTMLElement {
  const v = it.by;
  const av = avatar({ name: v.name, guard: v.guard, isMod: false, ...(v.face ? { face: v.face } : {}) }, size);
  return h('span', { class: `mu-by${v.guard ? ` g${v.guard}` : ''}` }, v.guard ? withGuardFrame(av, v.guard) : av, h('span', { class: 'mu-byn' }, v.name), label ? h('span', { class: 'mu-byt' }, label) : null);
}

/** 歌名：放不下时来回滚动（放得下就不动） */
function title(text: string, cls = 'mu-title'): HTMLElement {
  const inner = h('span', { class: 'mu-tin' }, text);
  const el = h('span', { class: cls }, inner);
  // 用外层的滚动尺寸量（里面是行内元素，自己的尺寸量不出放不下多少）。字体加载完前量的不准，加载完再量一次
  const check = () => {
    if (!el.isConnected || el.classList.contains('marq')) return;
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 2) return;
    el.classList.add('marq');
    el.style.setProperty('--dx', `${-over - 8}px`);
    el.style.setProperty('--md', `${Math.max(8, over / 26 + 6).toFixed(1)}s`);
  };
  requestAnimationFrame(check);
  void document.fonts?.ready.then(() => requestAnimationFrame(check));
  setTimeout(check, 1500);
  return el;
}

function eq(n = 4, cls = 'mu-eq'): HTMLElement {
  const el = h('span', { class: cls });
  for (let i = 0; i < n; i++) el.append(h('i', { style: { '--i': String(i) } }));
  return el;
}

interface Built {
  el: HTMLElement;
  fill?: HTMLElement;
  tCur?: HTMLElement;
  /** 每一帧（约 20 次 / 秒）按进度更新 */
  update?: (pos: number, dur: number) => void;
}

function prog(n: MusicNow, cls = 'mu-prog'): { el: HTMLElement; fill: HTMLElement; tCur: HTMLElement } {
  const fill = h('div', { class: 'mu-fill' }, h('i', { class: 'mu-head' }));
  const tCur = h('span', {}, '0:00');
  const el = h('div', { class: cls }, h('div', { class: 'mu-track' }, fill), h('div', { class: 'mu-time' }, tCur, h('span', {}, mmss(n.item.song.durationMs))));
  return { el, fill, tCur };
}

// ---------- 「正在放」 ----------

/** 常规三种样子共用：封面（带柔光）、跳动的音柱 + 歌名、歌手、谁点的、进度 */
function classic(n: MusicNow): Built {
  const s = n.item.song;
  const p = prog(n);
  const el = h(
    'div',
    { class: 'mu-body' },
    h('div', { class: 'mu-gl' }),
    h('div', { class: 'mu-art' }, s.cover ? img('mu-glow', s.cover) : null, h('div', { class: 'mu-disc' }, cover(s)), h('div', { class: 'mu-arm' })),
    h('div', { class: 'mu-meta' }, h('div', { class: 'mu-t1' }, eq(), title(s.name)), h('div', { class: 'mu-artist' }, s.artists || '未知歌手'), h('div', { class: 'mu-row' }, byChip(n.item, 30)), p.el),
  );
  return { el, fill: p.fill, tCur: p.tCur };
}

const BUILD: Record<MusicDisplay['style'], (n: MusicNow) => Built> = {
  // 流光：封面放大、模糊后铺满整张卡片做底色，上面一层暗色玻璃；封面上一道光定时扫过
  glass(n) {
    const s = n.item.song;
    const p = prog(n);
    const el = h(
      'div',
      { class: 'mu-body' },
      s.cover ? img('g-bg', s.cover) : h('div', { class: 'g-bg blank' }),
      h('div', { class: 'g-shade' }),
      h('div', { class: 'mu-art' }, s.cover ? img('mu-glow', s.cover) : null, h('div', { class: 'mu-disc' }, cover(s), h('i', { class: 'g-sheen' }))),
      h('div', { class: 'mu-meta' }, h('div', { class: 'mu-t1' }, eq(), title(s.name)), h('div', { class: 'mu-artist' }, s.artists || '未知歌手'), h('div', { class: 'mu-row' }, byChip(n.item, 30)), p.el),
    );
    return { el, fill: p.fill, tCur: p.tCur };
  },

  // 手帐（日系）：方格纸，和纸胶带贴着拍立得风格的封面；歌名像用荧光笔划过，手写体；角落几个手绘的小星星、小爱心
  journal(n) {
    const s = n.item.song;
    const fill = h('div', { class: 'mu-fill' }, h('i', { class: 'j-pencil' }));
    const tCur = h('span', {}, '0:00');
    const d = new Date();
    const date = `${d.getMonth() + 1}.${d.getDate()} ${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()]}`;
    const el = h(
      'div',
      { class: 'mu-body' },
      h('div', { class: 'j-photo' }, h('i', { class: 'j-tape a' }), h('i', { class: 'j-tape b' }), h('div', { class: 'mu-disc' }, cover(s)), h('div', { class: 'j-cap' }, '♪ now playing')),
      h(
        'div',
        { class: 'mu-meta' },
        h('div', { class: 'j-date' }, date, h('span', {}, '今日点歌')),
        title(s.name, 'mu-title j-title'),
        h('div', { class: 'mu-artist' }, s.artists || '未知歌手'),
        h('div', { class: 'mu-row' }, byChip(n.item, 28, '点的歌')),
        h('div', { class: 'j-prog' }, h('div', { class: 'mu-track' }, fill), h('div', { class: 'mu-time' }, tCur, h('span', {}, mmss(s.durationMs)))),
      ),
      h('i', { class: 'j-doodle star' }),
      h('i', { class: 'j-doodle heart' }),
      h('i', { class: 'j-doodle swirl' }),
    );
    // 涂鸦的位置、角度按这首歌稍微变一变，每首不完全一样
    const seed = [...s.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
    el.style.setProperty('--j1', `${(seed % 7) * 3 - 9}deg`);
    el.style.setProperty('--j2', `${(seed % 5) * 4}px`);
    el.style.setProperty('--j3', `${((seed >> 2) % 5) * 5 - 10}deg`);
    return { el, fill, tCur };
  },

  // 常规三种（玻璃卡片、黑胶唱片、细长胶囊）：同一套结构，样子在 CSS 里分开（唱臂只在黑胶里显示）
  card: classic,
  vinyl: classic,
  capsule: classic,

  // 灵动岛：玻璃胶囊，左边转动的小封面，右边跳动的音柱；换歌、有人点歌时胶囊展开显示提示，再收回去
  minimal(n) {
    const s = n.item.song;
    const fill = h('div', { class: 'mu-fill' });
    const el = h(
      'div',
      { class: 'mu-body' },
      h('div', { class: 'mu-art' }, h('div', { class: 'mu-disc' }, cover(s))),
      h('div', { class: 'mu-meta' }, title(s.name), h('div', { class: 'mu-artist' }, `${s.artists || '未知歌手'} · ${n.item.by.name} 点歌`)),
      eq(5, 'mu-eq i-wave'),
      h('div', { class: 'i-note' }),
      h('div', { class: 'i-prog' }, fill),
    );
    return { el, fill };
  },
};

// ---------- 正在放 ----------

let shown: { id: number; style: string } | null = null;
let built: Built | null = null;

function renderCard(s: MusicState): void {
  const n = s.now;
  card.classList.toggle('on', Boolean(n));
  if (!n) {
    shown = null;
    built = null;
    return;
  }
  card.classList.toggle('paused', n.paused || s.hold !== null);
  if (shown?.id === n.item.id && shown.style === s.display.style) return;
  const fresh = shown !== null;
  shown = { id: n.item.id, style: s.display.style };
  built = BUILD[s.display.style](n);
  card.replaceChildren(built.el);
  const song = n.item.song;
  if (song.cover) tintOf(song.cover, applyTint);
  else applyTint(DEFAULT_TINT);
  if (fresh && !reduced()) {
    built.el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.98)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const photo = built.el.querySelector('.j-photo');
    const art = built.el.querySelector('.mu-art');
    if (photo) photo.animate([{ opacity: 0, transform: 'translate(-10px, -26px) rotate(-14deg) scale(1.08)' }, { opacity: 1, transform: 'rotate(-4deg)' }], { duration: 700, delay: 120, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });
    else if (art) art.animate([{ opacity: 0, transform: 'scale(.7) rotate(-8deg)' }, { opacity: 1, transform: 'none' }], { duration: 720, delay: 100, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' });
  }
  // 灵动岛：从一个小胶囊弹开到正常大小，再展开写一下现在放的是什么
  if (s.display.style === 'minimal') {
    const b = built.el;
    requestAnimationFrame(() => {
      measureIsland(b);
      if (!reduced()) {
        b.style.transition = 'none';
        b.style.width = '120px';
        b.style.height = '36px';
        void b.offsetWidth;
        b.style.transition = '';
      }
      requestAnimationFrame(() => sizeIsland(b, null));
    });
    // 字体加载完后歌名的宽度会变：重新量一次
    void document.fonts?.ready.then(() => {
      if (built?.el !== b || card.classList.contains('noting')) return;
      measureIsland(b);
      sizeIsland(b, null);
    });
    const name = song.name;
    const by = n.item.by.name;
    setTimeout(() => built?.el === b && island([h('i', { class: 'i-dot play' }), h('span', {}, '正在播放'), h('b', {}, `《${name}》`), h('span', { class: 'i-dim' }, `${by} 点的`)], 3200), reduced() ? 0 : 650);
  }
  lastLine = -2;
}

/** 量灵动岛平时（收起时）的宽高：先临时取消固定的宽高量自然大小，再放回去（不触发动画） */
function measureIsland(b: HTMLElement): void {
  const w = b.style.width;
  const hh = b.style.height;
  b.style.transition = 'none';
  b.style.width = '';
  b.style.height = '';
  b.dataset.cw = String(Math.ceil(b.offsetWidth));
  b.dataset.ch = String(Math.ceil(b.offsetHeight));
  b.style.width = w;
  b.style.height = hh;
  void b.offsetWidth;
  b.style.transition = '';
}

/** 灵动岛的宽高（带弹性的过渡）：note 为展开时里面提示的宽度，null 为收起 */
function sizeIsland(b: HTMLElement, note: number | null): void {
  if (!b.dataset.cw) measureIsland(b);
  const cw = Number(b.dataset.cw);
  const ch = Number(b.dataset.ch);
  if (note === null) {
    b.style.width = `${cw}px`;
    b.style.height = `${ch}px`;
  } else {
    b.style.width = `${Math.min(580, Math.max(cw + 30, note + 60))}px`;
    b.style.height = `${ch + 18}px`;
  }
}

let noteTimer: ReturnType<typeof setTimeout> | null = null;

/** 灵动岛展开一会儿，显示 nodes，再收回去：胶囊按提示的长度弹性变宽变高，原来的内容先淡出，提示从模糊变清楚 */
function island(nodes: Node[], ms: number): boolean {
  const b = built?.el;
  const note = b?.querySelector<HTMLElement>('.i-note');
  if (!b || !note) return false;
  const inner = h('span', { class: 'i-nin' }, ...nodes);
  note.replaceChildren(inner);
  card.classList.add('noting');
  sizeIsland(b, inner.offsetWidth);
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    card.classList.remove('noting');
    if (built?.el === b) sizeIsland(b, null);
  }, ms);
  return true;
}

function applyTint(t: Tint): void {
  root.style.setProperty('--tint', t.c1);
  root.style.setProperty('--tint2', t.c2);
  root.style.setProperty('--tintD', t.d1);
  root.style.setProperty('--tintD2', t.d2);
}

// ---------- 歌词 ----------

let lastLine = -2;
let lyCur: HTMLElement | null = null;
/** 当前这句的文字（染色、滑动都在它身上）；放不下时多出来多少像素 */
let lyIn: HTMLElement | null = null;
let lyOver = 0;

function renderLyric(s: MusicState, pos: number): void {
  const n = s.now;
  const lines: LyricLine[] | null = n?.lyric ?? null;
  const show = Boolean(n && lines && s.display.lyrics);
  lyric.classList.toggle('on', show);
  if (!show || !lines) {
    lastLine = -2;
    return;
  }
  const i = lyricIndex(lines, pos);
  if (i !== lastLine) {
    lastLine = i;
    // 还没唱到第一句（前奏）：先把第一句摆出来，不填色
    const cur = lines[Math.max(0, i)] ?? null;
    const next = lines[Math.max(0, i) + 1] ?? null;
    const inner = h('span', { class: 'ly-in' }, cur?.text ?? '');
    const line = h('div', { class: 'ly-cur' }, inner);
    lyIn = inner;
    lyCur = line;
    lyOver = 0;
    // 量一下这句放不放得下（字体加载完前量的可能不准，过一会儿再量一次）
    const measure = () => {
      if (!inner.isConnected || lyIn !== inner) return;
      lyOver = Math.max(0, inner.offsetWidth - line.clientWidth);
      line.classList.toggle('long', lyOver > 2);
      if (lyOver > 2 && !line.classList.contains('fade-l')) line.classList.add('fade-r');
    };
    requestAnimationFrame(measure);
    setTimeout(measure, 700);
    const tr = s.display.lyricsTrans && cur?.tr ? cur.tr : null;
    const sub = h('div', { class: `ly-sub${tr ? ' tr' : ''}` }, tr ?? next?.text ?? '');
    const box = h('div', { class: 'ly-box' }, lyCur, sub);
    lyric.replaceChildren(box);
    if (!reduced()) box.animate([{ opacity: 0, transform: 'translateY(16px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  // 这一句唱到哪：从这一句开始到下一句开始，颜色从左往右填过去
  if (lyCur && i < 0) lyCur.style.setProperty('--p', '0%');
  else if (lyCur) {
    const t0 = lines[i]!.t;
    const t1 = lines[i + 1]?.t ?? t0 + 5000;
    const p = Math.min(1, Math.max(0, (pos - t0) / Math.max(400, Math.min(t1 - t0, 12_000))));
    lyCur.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    // 太长放不下：唱到两成后开始往左滑，唱到八成半滑到句尾，正在唱的地方一直留在框里
    if (lyOver > 2 && lyIn) {
      const k = Math.min(1, Math.max(0, (p - 0.2) / 0.65));
      lyIn.style.transform = `translateX(${(-lyOver * k).toFixed(1)}px)`;
      lyCur.classList.toggle('fade-l', k > 0);
      lyCur.classList.toggle('fade-r', k < 1);
    }
  }
}

// ---------- 后面几首、空闲提示 ----------

const QUEUE_HEAD: Partial<Record<MusicDisplay['style'], string>> = { journal: '待播清单 ♡' };

function renderQueue(s: MusicState): void {
  const n = s.display.showQueue;
  const items = s.queue.slice(0, n);
  queue.classList.toggle('on', items.length > 0);
  if (!items.length) return queue.replaceChildren();
  const more = s.total - items.length;
  const tail = more > 0 ? [h('div', { class: 'mu-qmore' }, `还有 ${more} 首`)] : [];
  queue.replaceChildren(
    h('div', { class: 'mu-qh' }, h('span', {}, QUEUE_HEAD[s.display.style] ?? '接下来'), h('span', { class: 'mu-qn' }, `共 ${s.total} 首`)),
    ...items.map((it, i) =>
      h('div', { class: 'mu-qi' }, h('span', { class: 'mu-qx' }, String(i + 1)), it.song.cover ? img('mu-qc', it.song.cover) : h('span', { class: 'mu-qc blank' }, icon(NOTE_SVG, 'mu-note')), h('span', { class: 'mu-qt' }, h('b', {}, it.song.name), it.song.artists ? h('span', {}, ` · ${it.song.artists}`) : null), h('span', { class: 'mu-qb' }, it.by.name)),
    ),
    ...tail,
  );
}

function renderIdle(s: MusicState): void {
  const on = !s.now;
  idle.classList.toggle('on', on);
  if (on) idle.replaceChildren(icon(NOTE_SVG, 'mu-note'), h('span', {}, '发送弹幕 ', h('b', {}, `${s.cmd} 歌名`), ' 点歌'));
}

// ---------- 提示 ----------

function toast(n: MusicNotice): void {
  if (!state?.enabled) return;
  // 灵动岛：胶囊展开，把提示写在里面
  if (state.display.style === 'minimal' && island([h('i', { class: `i-dot ${n.ok ? 'ok' : 'no'}` }), h('b', {}, n.who), h('span', {}, n.ok ? ` ${n.text}` : `：${n.text}`)], 3800)) return;
  const el = h('div', { class: `mu-toast ${n.ok ? 'ok' : 'no'}` }, h('i', { class: 'mu-td' }), h('b', {}, n.who), h('span', {}, n.ok ? ` ${n.text}` : `：${n.text}`));
  toasts.append(el);
  while (toasts.children.length > 2) toasts.firstElementChild?.remove();
  if (!reduced()) el.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  setTimeout(() => {
    const out = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 300, fill: 'forwards' });
    out.onfinish = () => el.remove();
  }, 4500);
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 整体 ----------

function render(): void {
  const s = state;
  if (!s) return;
  const d = s.display;
  const lite = q.get('lite') === '1' || !env.blur;
  root.className = `mu-root st-${d.style} side-${d.side}${d.size === 'large' ? ' large' : ''}${lite ? ' lite' : ''}${s.enabled ? '' : ' off'}`;
  renderCard(s);
  renderQueue(s);
  renderIdle(s);
  // 没有在放的歌（这首放完了、切掉了）：歌词也收起来。歌词平时在每一帧里更新，没歌时不跑那一段，要在这里清掉
  if (!s.now) clearLyric();
  tick();
}

function clearLyric(): void {
  lyric.classList.remove('on');
  lyric.replaceChildren();
  lastLine = -2;
  lyCur = lyIn = null;
  lyOver = 0;
}

/** 现在放到哪（毫秒）：出声的窗口直接看播放器，别的按收到状态后过了多久算 */
function position(): number {
  const n = state?.now;
  if (!n) return 0;
  if (player && loaded && loaded.id === n.item.id && !audio.paused) return audio.currentTime * 1000;
  return n.paused ? n.posMs : n.posMs + (performance.now() - gotAt);
}

let raf = 0;
let lastPaint = 0;
function tick(): void {
  cancelAnimationFrame(raf);
  const s = state;
  if (!s?.now) return;
  const now = performance.now();
  if (now - lastPaint > 45) {
    lastPaint = now;
    const pos = position();
    const dur = s.now.item.song.durationMs || (player ? audio.duration * 1000 : 0) || 1;
    const b = built;
    if (b?.fill) b.fill.style.setProperty('--w', `${Math.min(100, (pos / dur) * 100).toFixed(2)}%`);
    if (b?.tCur) b.tCur.textContent = mmss(pos);
    b?.update?.(pos, dur);
    renderLyric(s, pos);
  }
  const moving = !(s.now.paused || s.hold !== null) || (player && !audio.paused);
  if (moving) raf = requestAnimationFrame(tick);
}

// ---------- 出声音（只有服务端指定的那个窗口） ----------

const audio = new Audio();
audio.preload = 'auto';
let loaded: { id: number; load: number } | null = null;
let seekTo = 0;
let startedSent = false;
let lastPosSent = 0;
let duck = { on: false, pct: 30 };
let vol = 0;
let volTimer: ReturnType<typeof setInterval> | null = null;
let blocked = false;

function volumeTarget(): number {
  const base = (state?.volume ?? 70) / 100;
  return duck.on ? base * (duck.pct / 100) : base;
}
/** 音量慢慢变过去（特效开始、结束时不突兀）；speed 越小越慢（新歌淡入用慢的） */
function rampVolume(speed = 0.25): void {
  if (fadeTimer) return;
  if (volTimer) clearInterval(volTimer);
  const target = volumeTarget();
  volTimer = setInterval(() => {
    const d = target - vol;
    vol = Math.abs(d) < 0.01 ? target : vol + d * speed;
    audio.volume = Math.min(1, Math.max(0, vol));
    if (vol === target && volTimer) {
      clearInterval(volTimer);
      volTimer = null;
    }
  }, 40);
}

/** 淡出（约 0.35 秒）后再做 then：切歌、暂停、歌放完时不突然断掉。又来了新的状态时，用新的 then */
let fadeTimer: ReturnType<typeof setInterval> | null = null;
function fadeOut(then: () => void): void {
  if (volTimer) clearInterval(volTimer);
  volTimer = null;
  if (fadeTimer) clearInterval(fadeTimer);
  fadeTimer = null;
  if (audio.paused || vol < 0.01) return then();
  const step = Math.max(0.01, vol / 12);
  fadeTimer = setInterval(() => {
    vol = Math.max(0, vol - step);
    audio.volume = vol;
    if (vol > 0) return;
    clearInterval(fadeTimer!);
    fadeTimer = null;
    then();
  }, 30);
}

function syncAudio(): void {
  const n = state?.now;
  if (!player || !n?.url) {
    const playerNow = player;
    fadeOut(() => {
      if (!audio.paused) audio.pause();
      if (!n || !playerNow) {
        if (loaded) {
          audio.removeAttribute('src');
          audio.load();
        }
        loaded = null;
      }
    });
    return;
  }
  const url = n.url;
  const go = () => {
    if (state?.hold === null) {
      play();
      rampVolume(loaded && startedSent ? 0.25 : 0.1);
    } else fadeOut(() => audio.pause());
  };
  if (!loaded || loaded.id !== n.item.id || loaded.load !== n.load) {
    // 换歌：旧的先淡出，新的从静音开始淡入
    const next = { id: n.item.id, load: n.load, posMs: n.posMs };
    fadeOut(() => {
      loaded = { id: next.id, load: next.load };
      startedSent = false;
      seekTo = next.posMs / 1000;
      vol = 0;
      audio.volume = 0;
      audio.src = url;
      audio.load();
      go();
    });
    return;
  }
  if (fadeTimer && state?.hold === null) {
    // 正在淡出（刚才要暂停），又说继续：停止淡出，淡入回来
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  go();
}

function play(): void {
  if (!audio.paused) return;
  // 暂停后继续：从静音淡入
  vol = 0;
  audio.volume = 0;
  audio.play().then(
    () => {
      if (blocked) {
        blocked = false;
        blockedHint();
      }
    },
    (e: Error) => {
      // 浏览器要求先点一下页面才能出声（直播软件里不会这样）：不当作放不了
      if (e.name === 'NotAllowedError') {
        blocked = true;
        blockedHint();
      }
    },
  );
}

/** 浏览器拦住了声音时，在页面上提示点一下 */
function blockedHint(): void {
  root.querySelector('.mu-blocked')?.remove();
  if (blocked) root.append(h('div', { class: 'mu-blocked' }, '浏览器拦住了声音，点一下页面开启'));
}
addEventListener('pointerdown', () => blocked && play());

audio.addEventListener('loadedmetadata', () => {
  if (seekTo > 0.5 && (!Number.isFinite(audio.duration) || seekTo < audio.duration - 1)) audio.currentTime = seekTo;
  seekTo = 0;
});
audio.addEventListener('playing', () => {
  if (!loaded) return;
  if (!startedSent) {
    startedSent = true;
    conn?.send({ type: 'music_started', id: loaded.id, load: loaded.load });
  }
  tick();
});
audio.addEventListener('timeupdate', () => {
  if (!loaded || !startedSent) return;
  const now = performance.now();
  if (now - lastPosSent < 5000) return;
  lastPosSent = now;
  conn?.send({ type: 'music_pos', id: loaded.id, pos: Math.round(audio.currentTime * 1000) });
});
audio.addEventListener('ended', () => {
  if (loaded) conn?.send({ type: 'music_ended', id: loaded.id });
});
audio.addEventListener('error', () => {
  if (!loaded || !audio.getAttribute('src')) return;
  const e = audio.error;
  const why = e ? ({ 1: '加载被中止', 2: '网络错误', 3: '解码失败', 4: '格式不支持或地址失效' } as Record<number, string>)[e.code] ?? `错误 ${e.code}` : '未知错误';
  conn?.send({ type: 'music_error', id: loaded.id, load: loaded.load, message: `${why}${e?.message ? `（${e.message}）` : ''}` });
});

// ---------- 连接 ----------

let conn: Conn | null = null;
const build0 = pageBuild();
// 正在出声时不自动刷新（刷新会断一下），等这首放完、没有歌的时候再刷新
const onBuild = autoUpdate(build0, () => !audio.paused);

function onMessage(m: ServerToOverlay): void {
  switch (m.type) {
    case 'hello':
      onBuild(m.build);
      conn?.send({ type: 'report', env: { ...detect(), music: true, build: build0, ...(browse ? { view: true } : {}) } });
      break;
    case 'music':
      state = m.state;
      player = m.player && !browse && !preview;
      gotAt = performance.now();
      render();
      syncAudio();
      break;
    case 'music_duck':
      duck = { on: m.on, pct: m.pct };
      if (!audio.paused) rampVolume();
      break;
    case 'music_notice':
      toast(m.notice);
      break;
    case 'version':
      onBuild(m.build);
      break;
  }
}

// 预览模式（管理后台里的 iframe）：只接收同源页面发来的消息，不连服务端、不出声
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
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay?output=${encodeURIComponent(output)}&key=${encodeURIComponent(key)}&view=${browse ? 'music-view' : 'music'}`;
    conn = connect(url, {
      onMessage,
      onFatal: () => notice('点歌窗口地址已失效', '可能是重置了密钥或删除了这个输出，请在星临管理后台「直播软件输出」重新复制地址'),
      onState: (online) => {
        // 断开时停下（服务端会把歌停在原处，连回来接着放）
        if (!online && !audio.paused) audio.pause();
      },
    });
  } else {
    notice('这是星临点歌窗口', '请在管理后台「直播软件输出」复制完整地址粘贴到浏览器源');
  }
}

function notice(t: string, detail: string): void {
  root.querySelector('.notice')?.remove();
  root.className = 'mu-root';
  root.append(h('div', { class: 'notice' }, t, h('small', {}, detail)));
}

// 方便在浏览器控制台里调试
(window as unknown as { starfall: unknown }).starfall = { get state() { return state; }, audio };
