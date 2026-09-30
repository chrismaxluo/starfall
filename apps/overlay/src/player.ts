// 播放一个特效。播放节奏由服务端控制：新的 play 到来时，上一个一定已经结束（stop 时立即清掉）。
import { FEATHER_MAX } from '@starfall/shared/overlay';
import type { OverlayToServer, PlayItem } from '@starfall/shared';
import { buildBuiltin, isFullStage } from './builtin.ts';
import { h } from './dom.ts';
import { buildMedia, fitSize } from './media.ts';
import type { Media } from './media.ts';
import { addHonor, avatar, textLine, withGuardFrame } from './parts.ts';
import type { StageMetrics } from './stage.ts';

/** 素材上的头像和欢迎语显示多久（素材更短时跟素材一起结束） */
const CAPTION_MS = 4500;
/** 设置的时长和视频实际长度差这么多以内算播到结尾（素材时长是上传时测的，可能差一点） */
const END_SLACK_MS = 250;
/** 视频晚开始时最多多等这么久 */
const VIDEO_GRACE_MS = 3000;

interface Current {
  id: string;
  slot: HTMLElement;
  /** 上传的素材（可以挪位置） */
  asset: boolean;
  /** 预览里正在拖动：先不结束 */
  held?: boolean;
  media: Media | null;
  audio: HTMLAudioElement | null;
  timer?: ReturnType<typeof setTimeout>;
  fadeTimer?: ReturnType<typeof setTimeout>;
}

export class Player {
  private current: Current | null = null;
  private readonly stage: HTMLElement;
  private readonly metrics: () => StageMetrics;
  private readonly send: (m: OverlayToServer) => void;

  constructor(stage: HTMLElement, metrics: () => StageMetrics, send: (m: OverlayToServer) => void) {
    this.stage = stage;
    this.metrics = metrics;
    this.send = send;
  }

  get playing(): string | null {
    return this.current?.id ?? null;
  }

  play(item: PlayItem): void {
    this.stop();
    const e = item.effect;
    const m = this.metrics();
    const slot = h('div', { class: 'slot', style: { '--dur': `${e.durationMs}ms` } });
    let media: Media | null = null;
    let wrap: HTMLElement | null = null;

    if (e.visual.type === 'builtin_style') {
      const full = isFullStage(e.visual.style);
      slot.classList.add(full ? 'full' : `pos-${e.position}`);
      const fx = buildBuiltin(item, e.visual.style, m);
      if (e.honorBadge) addHonor(fx, item.viewer);
      slot.append(full ? fx : h('div', { class: 'z' }, fx));
    } else {
      slot.classList.add(`pos-${e.position}`);
      place(slot, e.offsetX, e.offsetY, m);
      const center = e.position === 'center';
      // 居中：铺满画面（全屏动画本来就按整屏设计）；角落：不超过画面宽度、高度的 45%
      const box = center ? { w: m.width, h: m.height } : { w: m.width - 2 * m.marginX - 48, h: m.height * 0.45 };
      const size = fitSize(e.visual, box, center ? Infinity : m.fxz);
      media = buildMedia(e.visual, e.volume);
      // 自动算出的大小记在 data 上，预览里调大小时按它缩放
      wrap = h('div', { class: 'media' }, media.el);
      wrap.dataset.w = String(size.w);
      wrap.dataset.h = String(size.h);
      resize(wrap, e.sizePct);
      feather(wrap, e.featherPct);
      // 渐入渐出最多各占一半时长
      if (e.fadeIn) wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(e.fadeInMs, e.durationMs / 2), easing: 'ease-out', fill: 'backwards' });
      const fx = h('div', { class: 'fx fx-asset' }, wrap);
      // 头像和欢迎语只显示几秒，不跟着素材一直挂着
      if (e.showText) {
        const card = h('div', { class: 'card glass', style: { '--cd': `${Math.min(e.durationMs, CAPTION_MS)}ms` } }, e.guardFrame ? withGuardFrame(avatar(item.viewer), item.viewer.guard) : avatar(item.viewer), textLine(item.text, item.viewer.name));
        if (e.honorBadge) addHonor(card, item.viewer);
        fx.append(card);
      }
      slot.append(fx);
    }

    this.stage.append(slot);
    let audio: HTMLAudioElement | null = null;
    if (e.sound) {
      audio = new Audio(e.sound.url);
      audio.volume = Math.min(1, Math.max(0, e.volume / 100));
      // 还没开始播就被停止（紧急暂停、特效很短）时浏览器会报 AbortError，不算出错
      audio.play().catch((err: Error) => this.current?.id === item.id && err.name !== 'AbortError' && this.send({ type: 'error', id: item.id, message: `音效没有播放：${err.message}` }));
    }
    media?.start().catch((err: Error) => this.current?.id === item.id && err.name !== 'AbortError' && this.send({ type: 'error', id: item.id, message: `素材播放失败：${err.message}` }));

    const finish = () => {
      if (this.current?.id !== item.id || this.current.held) return;
      this.stop();
      this.send({ type: 'ended', id: item.id });
    };
    // 视频按真正开始播放的时间算：加载慢、开始晚了也不提前切掉（下一个特效来了照常停止）
    // 跟随素材时放完（ended）就结束；手动设置了更短的时长时到点结束
    const vid = media?.el instanceof HTMLVideoElement ? media.el : null;
    vid?.addEventListener('ended', finish, { once: true });
    const w = e.fadeOut ? wrap : null;
    const fadeOutMs = Math.min(e.fadeOutMs, e.durationMs / 2);
    /** 从现在起 ms 毫秒后结束（结尾渐出在最后 fadeOutMs 毫秒） */
    const schedule = (ms: number, grace: number) => {
      const c = this.current;
      if (c?.id !== item.id) return;
      clearTimeout(c.timer);
      clearTimeout(c.fadeTimer);
      c.timer = setTimeout(finish, ms + grace);
      if (w) c.fadeTimer = setTimeout(() => w.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.min(fadeOutMs, ms), easing: 'ease-in', fill: 'forwards' }), Math.max(0, ms - fadeOutMs));
    };
    this.current = { id: item.id, slot, media, audio, asset: e.visual.type === 'asset' };
    schedule(e.durationMs, vid ? VIDEO_GRACE_MS : 0);
    vid?.addEventListener(
      'playing',
      () => {
        const full = Number.isFinite(vid.duration) ? vid.duration * 1000 : Infinity;
        const end = Math.min(e.durationMs, full);
        // 播到结尾的交给 ended，定时只兜底
        schedule(Math.max(0, end - vid.currentTime * 1000), end >= full - END_SLACK_MS ? 500 : 0);
      },
      { once: true },
    );
    this.send({ type: 'started', id: item.id });
  }

  /** 预览里拖动、调滑块时：把正在播放的素材挪到新位置、改成新大小（不重新播放） */
  nudge(x: number, y: number, sizePct: number): boolean {
    const c = this.current;
    if (!c?.asset) return false;
    place(c.slot, x, y, this.metrics());
    const wrap = c.slot.querySelector<HTMLElement>('.media');
    if (wrap) resize(wrap, sizePct);
    return true;
  }

  /** 预览里调羽化时：直接改正在播放的素材 */
  feather(pct: number): void {
    const wrap = this.current?.asset ? this.current.slot.querySelector<HTMLElement>('.media') : null;
    if (wrap) feather(wrap, pct);
  }

  /** 预览里拖动时：素材一直显示（视频循环、取消渐出），松手后由后台重新播放 */
  hold(): void {
    const c = this.current;
    if (!c?.asset) return;
    c.held = true;
    clearTimeout(c.fadeTimer);
    const media = c.slot.querySelector<HTMLElement>('.media');
    media?.getAnimations().forEach((a) => a.cancel());
    if (c.media?.el instanceof HTMLVideoElement) c.media.el.loop = true;
  }

  stop(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    clearTimeout(c.timer);
    clearTimeout(c.fadeTimer);
    c.media?.stop();
    if (c.audio) {
      c.audio.pause();
      c.audio.removeAttribute('src');
      c.audio.load();
    }
    c.slot.remove();
  }
}

/** 上传的素材：在位置的基础上挪动（画面宽、高的百分比，正数往右、往下） */
function place(slot: HTMLElement, x: number, y: number, m: StageMetrics): void {
  slot.style.translate = x || y ? `${(m.width * x) / 100}px ${(m.height * y) / 100}px` : '';
}

/** 上传的素材：按自动大小的百分比显示 */
function resize(wrap: HTMLElement, sizePct: number): void {
  const k = (sizePct || 100) / 100;
  wrap.dataset.k = String(k);
  wrap.style.width = `${Math.round(Number(wrap.dataset.w) * k)}px`;
  wrap.style.height = `${Math.round(Number(wrap.dataset.h) * k)}px`;
}

/** 上传的素材：上下边缘羽化（素材高度的百分比），按平滑曲线从透明过渡到不透明 */
function feather(wrap: HTMLElement, pct: number): void {
  const p = Math.max(0, Math.min(FEATHER_MAX, pct || 0));
  const ramp = (from: number, dir: 1 | -1) =>
    [0, 0.16, 0.5, 0.84, 1].map((a, i) => `rgba(0,0,0,${a}) ${from + dir * (p * i) / 4}%`);
  const m = p ? `linear-gradient(to bottom, ${[...ramp(0, 1), ...ramp(100, -1).reverse()].join(', ')})` : '';
  wrap.style.setProperty('-webkit-mask-image', m);
  wrap.style.setProperty('mask-image', m);
}
