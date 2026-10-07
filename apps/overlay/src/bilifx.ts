// 「B站动画」：播 B站礼物全屏动画，上方叠一条「谁送了什么」。
// 动画是一个 MP4，里面一块是画面、一块是透明度（排布由服务端从 B站读好放在 gift.fx 里），用 WebGL 合成带透明的画面。
// 浏览器不支持 WebGL、视频读不出来或迟迟不开始时：100 元以上换成晶耀，以下只留下面那条
import { BIG_GIFT_GOLD } from '@starfall/shared/overlay';
import type { GiftFx, PlayItem } from '@starfall/shared';
import type { StageSize } from './builtin.ts';
import { h } from './dom.ts';
import { giftHero, giftStrip } from './giftcard.ts';
import type { Media } from './media.ts';

/** 视频这么久还没出画面就换成卡片 */
const STALL_MS = 2500;

const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}';
const FS = 'precision mediump float;varying vec2 uv;uniform sampler2D t;uniform vec4 c;uniform vec4 a;void main(){vec3 rgb=texture2D(t,c.xy+uv*c.zw).rgb;float al=texture2D(t,a.xy+uv*a.zw).r;gl_FragColor=vec4(rgb*al,al);}';

interface Gl {
  draw(v: HTMLVideoElement): void;
  dispose(): void;
}

/** 建好合成用的 WebGL；不支持时为 null */
function makeGl(canvas: HTMLCanvasElement, fx: GiftFx): Gl | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VS);
  const fs = shader(gl.FRAGMENT_SHADER, FS);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const rect = (r: GiftFx['rgb']) => [r[0] / fx.videoW, r[1] / fx.videoH, r[2] / fx.videoW, r[3] / fx.videoH] as const;
  gl.uniform4f(gl.getUniformLocation(prog, 'c'), ...rect(fx.rgb));
  gl.uniform4f(gl.getUniformLocation(prog, 'a'), ...rect(fx.alpha));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return {
    draw(v) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      // 浏览器同时能开的 WebGL 有上限：用完马上释放
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

export interface BiliFx extends Media {
  /** 正在用的视频（换成卡片后为 null）；播放器按它的 playing / ended 算结束时间 */
  video: HTMLVideoElement | null;
}

/** 「谁送了什么」：沿用晶礼的样子，放在画面上方居中 */
function bar(item: PlayItem): HTMLElement {
  return h('div', { class: 'bfx-bar' }, giftStrip(item));
}

/** onFallback：动画没放出来、换成卡片时告诉服务端原因（写进日志） */
export function buildBiliFx(item: PlayItem, stage: StageSize, onFallback?: (why: string) => void): BiliFx {
  const fx = item.gift!.fx!;
  const el = h('div', { class: 'fx bfx' });
  const canvas = h('canvas', { class: 'bfx-cv' });
  canvas.width = fx.w;
  canvas.height = fx.h;
  const video = h('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const gl = makeGl(canvas, fx);
  let frame = 0;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const out: BiliFx = { el, video: gl ? video : null, start, stop };

  /** 动画放不了：100 元以上换成晶耀，以下只留下面那条 */
  const fallback = (why: string) => {
    if (stopped || !out.video) return;
    onFallback?.(`B站动画没放出来（${why}），换成了卡片`);
    out.video = null;
    clear();
    canvas.remove();
    if ((item.gift?.value ?? 0) >= BIG_GIFT_GOLD) el.replaceChildren(giftHero(item, stage));
  };
  const clear = () => {
    clearTimeout(stalled);
    if (frame && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = 0;
    video.pause();
    video.removeAttribute('src');
    video.load();
    gl?.dispose();
  };
  const loop = () => {
    if (stopped || !out.video || !gl) return;
    if (video.readyState >= 2) gl.draw(video);
    frame = 'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };

  async function start(): Promise<void> {
    if (!gl) return fallback('浏览器不支持 WebGL');
    video.addEventListener('error', () => fallback(`视频读取失败${video.error?.message ? `：${video.error.message}` : ''}`), { once: true });
    video.addEventListener('playing', () => clearTimeout(stalled), { once: true });
    stalled = setTimeout(() => fallback(`${STALL_MS / 1000} 秒还没开始播放`), STALL_MS);
    video.src = fx.src;
    loop();
    try {
      await video.play();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fallback(`${(e as Error).name}：${(e as Error).message}`);
    }
  }
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clear();
  }

  if (gl) el.append(canvas);
  el.append(bar(item));
  return out;
}
