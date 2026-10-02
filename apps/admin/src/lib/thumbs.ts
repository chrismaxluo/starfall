// 特效的缩略画面（素材库卡片、选特效的下拉框）：
// 内置样式用预先截好的效果图（design/tools/thumbs.mjs 生成）；图片用本身；
// 视频取中间一帧（开头常常是渐入、几乎全黑）；SVGA、Lottie 在浏览器里渲染中间一帧。结果按文件缓存在内存里
import type { LottiePlayer } from 'lottie-web';
import type * as SvgaLib from 'svgaplayerweb';
import type { EffectDto } from './types.ts';

const MAX_W = 360;
const cache = new Map<string, Promise<string | null>>();

/** 内置样式的效果图地址：竖图 9:14（素材库卡片）；wide 是贴着特效裁的 16:10 小图（选特效的下拉框） */
export const builtinThumb = (style: string, wide = false) => `/thumbs/${style}${wide ? '-w' : ''}.jpg`;

/** 同步能拿到的缩略图（内置样式、图片）；拿不到返回 null，再用 thumbOf 异步取 */
export function quickThumb(e: EffectDto | undefined, wide = false): string | null {
  if (!e) return null;
  if (e.visual.type === 'builtin_style') return builtinThumb(e.visual.style, wide);
  const a = e.asset;
  if (a?.kind === 'image' && a.ext !== 'json' && a.ext !== 'svga') return a.url;
  return null;
}

export function thumbOf(e: EffectDto | undefined, wide = false): Promise<string | null> {
  const quick = quickThumb(e, wide);
  if (quick || !e?.asset) return Promise.resolve(quick);
  const a = e.asset;
  let p = cache.get(a.url);
  if (!p) {
    p = (a.kind === 'video' ? videoFrame(a.url) : a.ext === 'svga' ? svgaFrame(a.url) : a.ext === 'json' ? lottieFrame(a.url) : Promise.resolve(null)).catch(() => null);
    cache.set(a.url, p);
  }
  return p;
}

function toCanvas(src: CanvasImageSource, w: number, h: number): string | null {
  if (!w || !h) return null;
  const k = Math.min(1, MAX_W / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  // 透明视频要保留透明：用 PNG
  return c.toDataURL('image/png');
}

/** 视频中间一帧（同源的 /files/ 地址，画到画布上不会被拦） */
function videoFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    const done = (r: string | null) => {
      clearTimeout(t);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const t = setTimeout(() => done(null), 15_000);
    v.onloadedmetadata = () => {
      v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? v.duration / 2 : 0;
    };
    v.onseeked = () => done(toCanvas(v, v.videoWidth, v.videoHeight));
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** 画在页面外的临时容器（SVGA 播放器要容器有尺寸） */
function offscreen(w: number, h: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'fixed', left: '-10000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  document.body.append(el);
  return el;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function svgaFrame(url: string): Promise<string | null> {
  const mod = (await import('svgaplayerweb')) as unknown as { default?: typeof SvgaLib } & typeof SvgaLib;
  const S = mod.default ?? mod;
  const item = await new Promise<SvgaLib.VideoEntity>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 10_000);
    new S.Parser().load(new URL(url, location.href).href, (x) => (clearTimeout(t), resolve(x)), (e) => (clearTimeout(t), reject(e)));
  });
  const vb = (item as unknown as { videoSize?: { width: number; height: number } }).videoSize ?? { width: 400, height: 400 };
  const k = Math.min(1, MAX_W / vb.width);
  const el = offscreen(Math.round(vb.width * k), Math.round(vb.height * k));
  try {
    const p = new S.Player(el);
    p.setContentMode('AspectFit');
    p.setVideoItem(item);
    // 图片在后台解码，等一下再定格
    await wait(400);
    p.stepToFrame(Math.floor(((item as unknown as { frames?: number }).frames ?? 2) / 2), false);
    await wait(60);
    const c = el.querySelector('canvas');
    return c ? toCanvas(c, c.width, c.height) : null;
  } finally {
    el.remove();
  }
}

async function lottieFrame(url: string): Promise<string | null> {
  const [mod, data] = await Promise.all([import('lottie-web/build/player/lottie_light'), fetch(url).then((r) => r.json() as Promise<{ w?: number; h?: number; op?: number; ip?: number }>)]);
  const lib = (mod as unknown as { default: LottiePlayer }).default;
  const w = data.w ?? 400;
  const h = data.h ?? 400;
  const el = offscreen(w, h);
  try {
    const anim = lib.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: false, animationData: data });
    anim.goToAndStop(Math.floor(((data.op ?? 2) + (data.ip ?? 0)) / 2), true);
    await wait(60);
    const svg = el.querySelector('svg');
    const out = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : null;
    anim.destroy();
    return out;
  } finally {
    el.remove();
  }
}
