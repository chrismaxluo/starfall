// 播放一个特效。播放节奏由服务端控制：新的 play 到来时，上一个一定已经结束（stop 时立即清掉）。
import type { OverlayToServer, PlayItem } from '@starfall/shared';
import { buildBuiltin, isFullStage } from './builtin.ts';
import { h } from './dom.ts';
import { buildMedia, fitSize } from './media.ts';
import type { Media } from './media.ts';
import { avatar, textLine } from './parts.ts';
import type { StageMetrics } from './stage.ts';

interface Current {
  id: string;
  slot: HTMLElement;
  media: Media | null;
  audio: HTMLAudioElement | null;
  timer: ReturnType<typeof setTimeout>;
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

    if (e.visual.type === 'builtin_style') {
      const full = isFullStage(e.visual.style);
      slot.classList.add(full ? 'full' : `pos-${e.position}`);
      const fx = buildBuiltin(item, e.visual.style, m);
      slot.append(full ? fx : h('div', { class: 'z' }, fx));
    } else {
      slot.classList.add(`pos-${e.position}`);
      const center = e.position === 'center';
      // 居中：铺满画面（全屏动画本来就按整屏设计）；角落：不超过画面宽度、高度的 45%
      const box = center ? { w: m.width, h: m.height } : { w: m.width - 2 * m.marginX - 48, h: m.height * 0.45 };
      const size = fitSize(e.visual, box, center ? Infinity : m.fxz);
      media = buildMedia(e.visual, e.volume);
      const wrap = h('div', { class: 'media', style: { width: `${size.w}px`, height: `${size.h}px` } }, media.el);
      const fx = h('div', { class: 'fx fx-asset' }, wrap);
      if (e.showText) fx.append(h('div', { class: 'card glass' }, avatar(item.viewer), textLine(item.text, item.viewer.name)));
      slot.append(fx);
    }

    this.stage.append(slot);
    let audio: HTMLAudioElement | null = null;
    if (e.sound) {
      audio = new Audio(e.sound.url);
      audio.volume = Math.min(1, Math.max(0, e.volume / 100));
      audio.play().catch((err: Error) => this.send({ type: 'error', id: item.id, message: `音效没有播放：${err.message}` }));
    }
    media?.start().catch((err: Error) => this.send({ type: 'error', id: item.id, message: `素材播放失败：${err.message}` }));

    const timer = setTimeout(() => {
      this.stop();
      this.send({ type: 'ended', id: item.id });
    }, e.durationMs);
    this.current = { id: item.id, slot, media, audio, timer };
    this.send({ type: 'started', id: item.id });
  }

  stop(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    clearTimeout(c.timer);
    c.media?.stop();
    c.audio?.pause();
    c.slot.remove();
  }
}
