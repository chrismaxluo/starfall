// 点歌窗口：正在放的歌（封面、歌名、歌手、谁点的、进度）、滚动歌词、后面几首、点歌结果的提示。
// 地址形如 /overlay/?output=1&key=...&music=1，在直播软件里单独加一个浏览器源（建议 640×560），拖到画面一侧。
// 同时加了好几个时只有一个出声音（服务端指定，消息里 player 为 true），别的只显示；在浏览器里查看（&view=1）时只显示不出声。
// 六种样子（display.style），每种的「正在放」各自搭，歌词、接下来、提示共用同一套结构，样子不同：
//   glass 流光：封面的模糊色铺满卡片；vinyl 黑胶：胡桃木唱机、唱片转、唱臂落下；neon 霓虹：霓虹描边、扫描线、频谱；
//   cassette 卡带：磁带两个转轮，带子随进度从左边绕到右边；ink 国风：宣纸、竖排的歌名和歌词、红色印章；
//   minimal 灵动岛：黑色小胶囊，有人点歌时展开显示提示。
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
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 点歌的人：头像（大航海套头像框）+ 昵称 */
function byChip(it: MusicItem, size: number, label = '点歌'): HTMLElement {
  const v = it.by;
  const av = avatar({ name: v.name, guard: v.guard, isMod: false, ...(v.face ? { face: v.face } : {}) }, size);
  return h('span', { class: `mu-by${v.guard ? ` g${v.guard}` : ''}` }, v.guard ? withGuardFrame(av, v.guard) : av, h('span', { class: 'mu-byn' }, v.name), label ? h('span', { class: 'mu-byt' }, label) : null);
}

/** 歌名：放不下时来回滚动（放得下就不动；竖排的上下滚） */
function title(text: string, cls = 'mu-title'): HTMLElement {
  const inner = h('span', { class: 'mu-tin' }, text);
  const el = h('span', { class: cls }, inner);
  // 用外层的滚动尺寸量（里面是行内元素，自己的尺寸量不出放不下多少）。字体加载完前量的不准，加载完再量一次
  const check = () => {
    if (!el.isConnected || el.classList.contains('marq')) return;
    const vertical = getComputedStyle(el).writingMode.startsWith('vertical');
    const over = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
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
  /** 歌词放在卡片里（国风竖排） */
  lyricHost?: HTMLElement;
}

function prog(n: MusicNow, cls = 'mu-prog'): { el: HTMLElement; fill: HTMLElement; tCur: HTMLElement } {
  const fill = h('div', { class: 'mu-fill' }, h('i', { class: 'mu-head' }));
  const tCur = h('span', {}, '0:00');
  const el = h('div', { class: cls }, h('div', { class: 'mu-track' }, fill), h('div', { class: 'mu-time' }, tCur, h('span', {}, mmss(n.item.song.durationMs))));
  return { el, fill, tCur };
}

// ---------- 六种样子的「正在放」 ----------

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

  // 黑胶：胡桃木唱机，唱片带彩虹反光、慢慢转，唱臂放的时候落下、暂停时抬起；文字用宋体，像唱片封套
  vinyl(n) {
    const s = n.item.song;
    const p = prog(n);
    const el = h(
      'div',
      { class: 'mu-body' },
      h(
        'div',
        { class: 'v-deck' },
        // 反光不跟着唱片转（灯光是固定的）
        h('div', { class: 'v-platter' }, h('div', { class: 'mu-disc v-record' }, cover(s, 'mu-cover v-label'), h('i', { class: 'v-hole' })), h('i', { class: 'v-sheen' })),
        h('div', { class: 'mu-arm' }, h('i', { class: 'v-pivot' }), h('i', { class: 'v-rod' }), h('i', { class: 'v-head' })),
        h('i', { class: 'v-light' }),
      ),
      h('div', { class: 'mu-meta' }, h('div', { class: 'v-kicker' }, eq(3), h('span', {}, 'NOW SPINNING')), title(s.name), h('div', { class: 'mu-artist' }, s.artists || '未知歌手'), h('div', { class: 'mu-row' }, byChip(n.item, 28)), p.el),
    );
    return { el, fill: p.fill, tCur: p.tCur };
  },

  // 霓虹：深色面板、霓虹描边和四角括号、扫描线；封面红蓝错位；底部一排频谱跟着跳；时间用等宽数字
  neon(n) {
    const s = n.item.song;
    const p = prog(n);
    const spec = h('div', { class: 'n-spec' });
    for (let i = 0; i < 36; i++) spec.append(h('i', { style: { '--d': `${(0.55 + ((i * 37) % 23) / 30).toFixed(2)}s`, '--dl': `${(-((i * 53) % 17) / 17).toFixed(2)}s`, '--x': String(i / 35) } }));
    const el = h(
      'div',
      { class: 'mu-body' },
      h('i', { class: 'n-c tl' }),
      h('i', { class: 'n-c tr' }),
      h('i', { class: 'n-c bl' }),
      h('i', { class: 'n-c br' }),
      h('div', { class: 'mu-art' }, s.cover ? img('n-ghost r', s.cover) : null, s.cover ? img('n-ghost b', s.cover) : null, h('div', { class: 'mu-disc' }, cover(s))),
      h('div', { class: 'mu-meta' }, h('div', { class: 'n-tag' }, h('i', { class: 'n-dot' }), h('span', {}, 'ON AIR'), h('span', { class: 'n-tag2' }, '点歌')), title(s.name), h('div', { class: 'mu-artist' }, s.artists || '未知歌手'), h('div', { class: 'mu-row' }, byChip(n.item, 26))),
      spec,
      p.el,
      h('i', { class: 'n-scan' }),
    );
    return { el, fill: p.fill, tCur: p.tCur };
  },

  // 卡带：一盘磁带，标签纸上写歌名歌手，封面当贴纸；两个转轮转动，带子随进度从左边绕到右边；底下是点歌人和机械计数器
  cassette(n) {
    const s = n.item.song;
    const counter = h('span', { class: 'c-count' }, '00:00');
    const el = h(
      'div',
      { class: 'mu-body' },
      h(
        'div',
        { class: 'c-tape' },
        h('i', { class: 'c-screw a' }),
        h('i', { class: 'c-screw b' }),
        h('i', { class: 'c-screw c' }),
        h('i', { class: 'c-screw d' }),
        h(
          'div',
          { class: 'c-label' },
          h('div', { class: 'c-stripe' }),
          h('div', { class: 'c-side' }, 'A'),
          s.cover ? img('c-sticker', s.cover) : null,
          h('div', { class: 'c-text' }, title(s.name, 'mu-title c-title'), h('div', { class: 'mu-artist c-artist' }, s.artists || '未知歌手')),
          h(
            'div',
            { class: 'c-window' },
            h('div', { class: 'c-reel l' }, h('i', { class: 'c-wind' }), h('i', { class: 'c-hub' })),
            h('div', { class: 'c-gap' }, h('i', { class: 'c-film' })),
            h('div', { class: 'c-reel r' }, h('i', { class: 'c-wind' }), h('i', { class: 'c-hub' })),
          ),
        ),
        h('div', { class: 'c-foot' }, byChip(n.item, 24), h('span', { class: 'c-meter' }, counter, h('small', {}, `/ ${mmss(s.durationMs)}`))),
      ),
    );
    let lastSec = -1;
    return {
      el,
      update(pos, dur) {
        el.style.setProperty('--p', Math.min(1, pos / dur).toFixed(4));
        const sec = Math.floor(pos / 1000);
        if (sec !== lastSec) {
          lastSec = sec;
          counter.textContent = `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
        }
      },
    };
  },

  // 国风：宣纸底、角上一团淡墨；歌名、歌手竖排在右边；歌词竖排在中间（当前一句浓墨，下一句淡）；左边圆形封面 + 点歌人的朱红印章；进度是一条竖线
  ink(n) {
    const s = n.item.song;
    const fill = h('div', { class: 'mu-fill' });
    const lyricHost = h('div', { class: 'k-lyric' });
    // 印章：昵称前四个字，从右往左、从上往下读（和真的印章一样）
    const chars = [...n.item.by.name.replace(/\s+/g, '')].slice(0, 4);
    const seal = h('div', { class: `k-seal n${chars.length}${n.item.by.guard ? ` g${n.item.by.guard}` : ''}` }, h('span', {}, ...chars.map((c) => h('b', {}, c))), h('small', {}, '点歌'));
    const el = h(
      'div',
      { class: 'mu-body' },
      h('i', { class: 'k-wash' }),
      h('i', { class: 'k-mount' }),
      h('div', { class: 'k-head' }, title(s.name, 'mu-title k-title'), h('div', { class: 'k-artist' }, s.artists || '佚名')),
      lyricHost,
      h('div', { class: 'k-side' }, h('div', { class: 'mu-art' }, h('div', { class: 'mu-disc' }, cover(s))), seal, h('div', { class: 'k-prog' }, h('div', { class: 'mu-track' }, fill))),
    );
    return { el, fill, lyricHost };
  },

  // 灵动岛：黑色胶囊，左边转动的小封面，右边跳动的音柱；有人点歌时胶囊展开显示提示，再收回去
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
  if (fresh && !reduced()) built.el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.98)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' });
  lastLine = -2;
}

function applyTint(t: Tint): void {
  root.style.setProperty('--tint', t.c1);
  root.style.setProperty('--tint2', t.c2);
}

// ---------- 歌词 ----------

let lastLine = -2;
let lyCur: HTMLElement | null = null;

function renderLyric(s: MusicState, pos: number): void {
  const n = s.now;
  const lines: LyricLine[] | null = n?.lyric ?? null;
  const show = Boolean(n && lines && s.display.lyrics);
  // 国风的歌词竖排在卡片里，下面那块不用
  const host = built?.lyricHost ?? lyric;
  lyric.classList.toggle('on', show && host === lyric);
  built?.lyricHost?.classList.toggle('on', show);
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
    // 长句子（竖排放不下）字小一点
    lyCur = h('div', { class: `ly-cur${[...(cur?.text ?? '')].length > 9 ? ' long' : ''}` }, cur?.text ?? '');
    // 国风是竖排：英文翻译竖着排没法看，改成显示下一句
    const tr = s.display.lyricsTrans && cur?.tr && !(built?.lyricHost && /^[\x20-\x7e]+$/.test(cur.tr)) ? cur.tr : null;
    const sub = h('div', { class: `ly-sub${tr ? ' tr' : ''}` }, tr ?? next?.text ?? '');
    const box = h('div', { class: 'ly-box' }, lyCur, sub);
    host.replaceChildren(box);
    if (!reduced()) box.animate(host === lyric ? [{ opacity: 0, transform: 'translateY(16px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }] : [{ opacity: 0, transform: 'translateX(-14px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  // 这一句唱到哪：从这一句开始到下一句开始，颜色从左往右（竖排从上往下）填过去
  if (lyCur && i < 0) lyCur.style.setProperty('--p', '0%');
  else if (lyCur) {
    const t0 = lines[i]!.t;
    const t1 = lines[i + 1]?.t ?? t0 + 5000;
    const p = Math.min(1, Math.max(0, (pos - t0) / Math.max(400, Math.min(t1 - t0, 12_000))));
    lyCur.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
  }
}

// ---------- 后面几首、空闲提示 ----------

const QUEUE_HEAD: Partial<Record<MusicDisplay['style'], string>> = { neon: 'UP NEXT', cassette: 'B 面 · 接下来', ink: '后 续' };
const INK_NUM = '一二三四五';

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
      h('div', { class: 'mu-qi' }, h('span', { class: 'mu-qx' }, s.display.style === 'ink' ? INK_NUM[i]! : String(i + 1)), h('span', { class: 'mu-qt' }, h('b', {}, it.song.name), it.song.artists ? h('span', {}, ` · ${it.song.artists}`) : null), h('span', { class: 'mu-qb' }, it.by.name)),
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

let noteTimer: ReturnType<typeof setTimeout> | null = null;

function toast(n: MusicNotice): void {
  if (!state?.enabled) return;
  // 灵动岛：胶囊展开，把提示写在里面
  const island = state.display.style === 'minimal' && built ? built.el.querySelector<HTMLElement>('.i-note') : null;
  if (island) {
    island.replaceChildren(h('i', { class: `i-dot ${n.ok ? 'ok' : 'no'}` }), h('b', {}, n.who), h('span', {}, n.ok ? ` ${n.text}` : `：${n.text}`));
    card.classList.add('noting');
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => card.classList.remove('noting'), 3800);
    return;
  }
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
  tick();
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
/** 音量慢慢变过去（特效开始、结束时不突兀） */
function rampVolume(): void {
  if (volTimer) clearInterval(volTimer);
  const target = volumeTarget();
  volTimer = setInterval(() => {
    const d = target - vol;
    vol = Math.abs(d) < 0.02 ? target : vol + d * 0.25;
    audio.volume = Math.min(1, Math.max(0, vol));
    if (vol === target && volTimer) {
      clearInterval(volTimer);
      volTimer = null;
    }
  }, 40);
}

function syncAudio(): void {
  const n = state?.now;
  if (!player || !n?.url) {
    if (!audio.paused) audio.pause();
    if (!n || !player) {
      if (loaded) {
        audio.removeAttribute('src');
        audio.load();
      }
      loaded = null;
    }
    return;
  }
  if (!loaded || loaded.id !== n.item.id || loaded.load !== n.load) {
    loaded = { id: n.item.id, load: n.load };
    startedSent = false;
    seekTo = n.posMs / 1000;
    vol = volumeTarget();
    audio.volume = vol;
    audio.src = n.url;
    audio.load();
  }
  if (state!.hold === null) play();
  else if (!audio.paused) audio.pause();
  rampVolume();
}

function play(): void {
  if (!audio.paused) return;
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
      rampVolume();
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
