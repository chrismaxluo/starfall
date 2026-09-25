// 上传的素材：WebM / MP4 用 <video>，GIF / PNG / WebP 用 <img>，SVGA、Lottie 按需加载对应的播放库。
import type { LottiePlayer } from 'lottie-web';
import type * as SvgaLib from 'svgaplayerweb';
import type { PlayVisual } from '@starfall/shared';
import { h } from './dom.ts';

type AssetVisual = Extract<PlayVisual, { type: 'asset' }>;

export interface Media {
  el: HTMLElement;
  start(): Promise<void>;
  stop(): void;
}

export interface Box {
  w: number;
  h: number;
}

/** 素材显示尺寸：保持比例放进 box；maxScale 限制放大倍数（角落位置不放大超过整体缩放） */
export function fitSize(v: Pick<AssetVisual, 'width' | 'height'>, box: Box, maxScale: number): Box {
  const w = v.width || box.w;
  const hh = v.height || box.h;
  const s = Math.min(box.w / w, box.h / hh, maxScale);
  return { w: Math.round(w * s), h: Math.round(hh * s) };
}

function video(v: AssetVisual, volume: number): Media {
  const el = h('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.volume = Math.min(1, Math.max(0, volume / 100));
  el.src = v.url;
  return {
    el,
    async start() {
      try {
        await el.play();
      } catch {
        // 普通浏览器不允许有声自动播放；直播软件里一般不会走到这里
        el.muted = true;
        await el.play().catch(() => undefined);
      }
    },
    stop() {
      el.pause();
      el.removeAttribute('src');
      el.load();
    },
  };
}

function image(v: AssetVisual): Media {
  const el = h('img');
  el.alt = '';
  el.src = v.url;
  return { el, start: async () => undefined, stop: () => undefined };
}

function svga(v: AssetVisual): Media {
  // 播放器按容器大小创建画布，容器必须先有尺寸
  const el = h('div', { style: { width: '100%', height: '100%' } });
  let player: { stopAnimation(clear?: boolean): void; clear(): void } | null = null;
  let stopped = false;
  return {
    el,
    async start() {
      // svgaplayerweb 是 UMD 包，打包后可能挂在 default 上
      const mod = (await import('svgaplayerweb')) as unknown as { default?: typeof SvgaLib } & typeof SvgaLib;
      const S = mod.default ?? mod;
      // 解析在 Web Worker 里进行，要用完整地址；加载卡住时 10 秒后报错
      const url = new URL(v.url, location.href).href;
      const item = await new Promise<SvgaLib.VideoEntity>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('SVGA 加载超时')), 10_000);
        new S.Parser().load(url, (x) => (clearTimeout(t), resolve(x)), (e) => (clearTimeout(t), reject(e)));
      });
      if (stopped) return;
      const p = new S.Player(el as HTMLDivElement);
      p.loops = 1;
      p.clearsAfterStop = false;
      p.fillMode = 'Forward';
      p.setContentMode('AspectFit');
      p.setVideoItem(item);
      p.startAnimation();
      player = p;
    },
    stop() {
      stopped = true;
      player?.stopAnimation(true);
      player?.clear();
    },
  };
}

function lottie(v: AssetVisual): Media {
  const el = h('div', { style: { width: '100%', height: '100%' } });
  let anim: { destroy(): void } | null = null;
  let stopped = false;
  return {
    el,
    async start() {
      // 自己下载 JSON 再交给 lottie：lottie 用 path 加载时在 Web Worker 里请求，相对地址会失败
      const [mod, data] = await Promise.all([import('lottie-web/build/player/lottie_light'), fetch(v.url).then((r) => r.json() as Promise<unknown>)]);
      if (stopped) return;
      const lib = (mod as unknown as { default: LottiePlayer }).default;
      anim = lib.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: true, animationData: data });
    },
    stop() {
      stopped = true;
      anim?.destroy();
    },
  };
}

export function buildMedia(v: AssetVisual, volume: number): Media {
  if (v.kind === 'video') return video(v, volume);
  if (v.ext === 'svga') return svga(v);
  if (v.ext === 'json') return lottie(v);
  return image(v);
}
