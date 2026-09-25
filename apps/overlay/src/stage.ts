// 画布：按输出设置的宽高、安全区、缩放设置 CSS 变量，并把画布等比缩放到浏览器源的实际大小。
import type { OverlayConfig } from '@starfall/shared';

export const DEFAULT_CONFIG: OverlayConfig = { outputId: 0, name: '', app: 'livehime', orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9, scale: 100, liteMode: 'auto' };

export interface StageMetrics {
  width: number;
  height: number;
  /** 特效整体缩放（按 1080 设计的尺寸 → 实际画布） */
  fxz: number;
  safeTop: number;
  safeBottom: number;
  marginX: number;
}

export function metrics(c: OverlayConfig): StageMetrics {
  return {
    width: c.width,
    height: c.height,
    fxz: (c.scale / 100) * Math.min(1, Math.min(c.width, c.height) / 1080),
    safeTop: (c.height * c.safeTop) / 100,
    safeBottom: (c.height * c.safeBottom) / 100,
    marginX: (c.width * c.marginX) / 100,
  };
}

export function applyConfig(stage: HTMLElement, c: OverlayConfig, lite: boolean): void {
  const m = metrics(c);
  stage.style.setProperty('--W', `${c.width}px`);
  stage.style.setProperty('--H', `${c.height}px`);
  stage.style.setProperty('--st', `${c.safeTop}%`);
  stage.style.setProperty('--sb', `${c.safeBottom}%`);
  stage.style.setProperty('--mx', `${c.marginX}%`);
  stage.style.setProperty('--fxz', String(m.fxz));
  stage.classList.toggle('lite', lite);
  fit(stage, c);
}

export function fit(stage: HTMLElement, c: OverlayConfig): void {
  const s = Math.min(innerWidth / c.width, innerHeight / c.height) || 1;
  stage.style.transform = Math.abs(s - 1) < 0.001 ? '' : `scale(${s})`;
}

/** 调试用：显示安全区 */
export function showSafeAreas(stage: HTMLElement): void {
  const top = document.createElement('div');
  top.className = 'safe top';
  top.textContent = '顶部信息栏';
  const bot = document.createElement('div');
  bot.className = 'safe bot';
  bot.textContent = '弹幕 / 礼物区';
  stage.append(top, bot);
}
