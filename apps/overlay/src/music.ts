// 点歌窗口：正在放的歌（封面、歌名、歌手、谁点的、进度）、滚动歌词、后面几首、点歌结果的提示。
// 地址形如 /overlay/?output=1&key=...&music=1，在直播软件里单独加一个浏览器源（建议 640×560），拖到画面一侧。
// 同时加了好几个时只有一个出声音（服务端指定，消息里 player 为 true），别的只显示；在浏览器里查看（&view=1）时只显示不出声。
// 三种样子：glass 玻璃卡片（封面颜色的柔光）、vinyl 黑胶唱片（转动）、minimal 一条细长的胶囊。
import './music.css';
import { lyricIndex } from '@starfall/shared/overlay';
import type { LyricLine, MusicItem, MusicNotice, MusicState, ServerToOverlay } from '@starfall/shared/overlay';
import { connect } from './conn.ts';
import type { Conn } from './conn.ts';
import { h } from './dom.ts';
import { detect } from './env.ts';
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

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 封面的主色（没有封面、跨域读不了时用星辉靛） */
const DEFAULT_TINT = '139, 140, 255';
const tints = new Map<string, string>();
function tintOf(url: string, done: (rgb: string) => void): void {
  const hit = tints.get(url);
  if (hit) return done(hit);
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.referrerPolicy = 'no-referrer';
  im.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 12;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, 12, 12);
      const d = g.getImageData(0, 0, 12, 12).data;
      // 挑饱和度高、不太暗不太亮的像素平均，免得灰扑扑
      let r = 0, gg = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i]!, G = d[i + 1]!, B = d[i + 2]!;
        const max = Math.max(R, G, B), min = Math.min(R, G, B);
        const sat = max ? (max - min) / max : 0;
        const lum = (max + min) / 2;
        const k = sat * sat * (lum > 30 && lum < 235 ? 1 : 0.1) + 0.02;
        r += R * k; gg += G * k; b += B * k; w += k;
      }
      // 提亮一点，放在深色玻璃上看得清；封面太素（黑白、灰）时掺一半星辉靛，免得灰扑扑
      let [R, G, B] = [r / w, gg / w, b / w];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      if (!max || (max - min) / max < 0.18) [R, G, B] = [(R + 139) / 2, (G + 140) / 2, (B + 255) / 2];
      const lift = (x: number) => Math.round(Math.min(255, x * 0.75 + 70));
      const rgb = `${lift(R)}, ${lift(G)}, ${lift(B)}`;
      tints.set(url, rgb);
      done(rgb);
    } catch {
      done(DEFAULT_TINT);
    }
  };
  im.onerror = () => done(DEFAULT_TINT);
  im.src = url;
}

/** 点歌的人：头像（大航海套头像框）+ 昵称 */
function byChip(it: MusicItem, size: number): HTMLElement {
  const v = it.by;
  const av = avatar({ name: v.name, guard: v.guard, isMod: false, ...(v.face ? { face: v.face } : {}) }, size);
  return h('span', { class: `mu-by${v.guard ? ` g${v.guard}` : ''}` }, v.guard ? withGuardFrame(av, v.guard) : av, h('span', { class: 'mu-byn' }, v.name), h('span', { class: 'mu-byt' }, '点歌'));
}

// ---------- 正在放 ----------

let shownId: number | null = null;
let fill: HTMLElement | null = null;
let tCur: HTMLElement | null = null;
let tDur: HTMLElement | null = null;

function renderCard(s: MusicState): void {
  const n = s.now;
  card.classList.toggle('on', Boolean(n));
  if (!n) {
    shownId = null;
    return;
  }
  card.classList.toggle('paused', n.paused || s.hold !== null);
  if (shownId === n.item.id) return;
  const fresh = shownId !== null;
  shownId = n.item.id;
  const song = n.item.song;
  const art = h('div', { class: 'mu-art' });
  if (song.cover) {
    art.append(img('mu-glow', song.cover), h('div', { class: 'mu-disc' }, img('mu-cover', song.cover)));
    tintOf(song.cover, (rgb) => root.style.setProperty('--tint', rgb));
  } else {
    art.append(h('div', { class: 'mu-disc' }, h('div', { class: 'mu-cover blank' }, icon(NOTE_SVG, 'mu-note'))));
    root.style.setProperty('--tint', DEFAULT_TINT);
  }
  art.append(h('div', { class: 'mu-arm' }));
  const eq = h('span', { class: 'mu-eq' }, h('i'), h('i'), h('i'), h('i'));
  fill = h('div', { class: 'mu-fill' });
  tCur = h('span', {}, '0:00');
  tDur = h('span', {}, mmss(song.durationMs));
  const meta = h(
    'div',
    { class: 'mu-meta' },
    h('div', { class: 'mu-t1' }, eq, h('span', { class: 'mu-title' }, song.name)),
    h('div', { class: 'mu-artist' }, song.artists || '未知歌手'),
    h('div', { class: 'mu-row' }, byChip(n.item, 30)),
    h('div', { class: 'mu-prog' }, h('div', { class: 'mu-track' }, fill), h('div', { class: 'mu-time' }, tCur, tDur)),
  );
  const body = h('div', { class: 'mu-body' }, h('div', { class: 'mu-gl' }), art, meta);
  card.replaceChildren(body);
  if (fresh && !reduced()) body.animate([{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
  lastLine = -2;
}

// ---------- 歌词 ----------

let lastLine = -2;
let lyCur: HTMLElement | null = null;

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
    lyCur = h('div', { class: 'ly-cur' }, cur?.text ?? '');
    const subText = s.display.lyricsTrans && cur?.tr ? cur.tr : (next?.text ?? '');
    const sub = h('div', { class: `ly-sub${s.display.lyricsTrans && cur?.tr ? ' tr' : ''}` }, subText);
    const box = h('div', { class: 'ly-box' }, lyCur, sub);
    lyric.replaceChildren(box);
    if (!reduced()) box.animate([{ opacity: 0, transform: 'translateY(16px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  // 这一句唱到哪：从这一句开始到下一句开始，颜色从左往右填过去
  if (lyCur && i < 0) lyCur.style.setProperty('--p', '0%');
  else if (lyCur) {
    const t0 = lines[i]!.t;
    const t1 = lines[i + 1]?.t ?? t0 + 5000;
    const p = Math.min(1, Math.max(0, (pos - t0) / Math.max(400, Math.min(t1 - t0, 12_000))));
    lyCur.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
  }
}

// ---------- 后面几首、空闲提示 ----------

function renderQueue(s: MusicState): void {
  const n = s.display.showQueue;
  const items = s.queue.slice(0, n);
  queue.classList.toggle('on', items.length > 0);
  if (!items.length) return queue.replaceChildren();
  const more = s.total - items.length;
  const tail = more > 0 ? [h('div', { class: 'mu-qmore' }, `还有 ${more} 首`)] : [];
  queue.replaceChildren(
    h('div', { class: 'mu-qh' }, h('span', {}, '接下来'), h('span', { class: 'mu-qn' }, `共 ${s.total} 首`)),
    ...items.map((it, i) =>
      h('div', { class: 'mu-qi' }, h('span', { class: 'mu-qx' }, String(i + 1)), h('span', { class: 'mu-qt' }, h('b', {}, it.song.name), it.song.artists ? h('span', {}, ` · ${it.song.artists}`) : null), h('span', { class: 'mu-qb' }, it.by.name)),
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
  const el = h('div', { class: `mu-toast ${n.ok ? 'ok' : 'no'}` }, h('b', {}, n.who), h('span', {}, n.ok ? ` ${n.text}` : `：${n.text}`));
  toasts.append(el);
  while (toasts.children.length > 2) toasts.firstElementChild?.remove();
  const anim = reduced() ? null : el.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  void anim;
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
    if (fill) fill.style.width = `${Math.min(100, (pos / dur) * 100).toFixed(2)}%`;
    if (tCur) tCur.textContent = mmss(pos);
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
        idleHint();
      }
    },
    (e: Error) => {
      // 浏览器要求先点一下页面才能出声（直播软件里不会这样）：不当作放不了
      if (e.name === 'NotAllowedError') {
        blocked = true;
        idleHint();
      }
    },
  );
}

/** 浏览器拦住了声音时，在页面上提示点一下 */
function idleHint(): void {
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

function notice(title: string, detail: string): void {
  root.querySelector('.notice')?.remove();
  root.className = 'mu-root';
  root.append(h('div', { class: 'notice' }, title, h('small', {}, detail)));
}

// 方便在浏览器控制台里调试
(window as unknown as { starfall: unknown }).starfall = { get state() { return state; }, audio };
