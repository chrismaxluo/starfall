// 画布：按输出设置的宽高、安全区、缩放设置 CSS 变量，并把画布等比缩放到浏览器源的实际大小。
import type { OverlayConfig } from '@starfall/shared';

export const DEFAULT_CONFIG: OverlayConfig = { outputId: 0, name: '', app: 'livehime', orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9, scale: 100, liteMode: 'auto', chatEnabled: true, chatSide: 'left', chatSize: 'normal', chatMedal: 'own', chatMax: 8, chatFadeSec: 0, giftsEnabled: true, giftsSide: 'right', giftsSize: 'normal', giftsMax: 6, giftsSpeed: 'normal', giftsFilter: { mode: 'all', gifts: [], guard: true, sc: true } };

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

/** 浏览器查看模式：顶部留出状态栏，画布居中 */
let viewInset = 0;
export function setViewInset(px: number): void {
  viewInset = px;
}

export function fit(stage: HTMLElement, c: OverlayConfig): void {
  if (viewInset) {
    const pad = 16;
    const s = Math.min((innerWidth - 2 * pad) / c.width, (innerHeight - viewInset - 2 * pad) / c.height) || 1;
    const x = (innerWidth - c.width * s) / 2;
    const y = viewInset + (innerHeight - viewInset - c.height * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    return;
  }
  // 浏览器源大小和画布不一致时，等比缩放后居中（一致时就是原样铺满）
  const s = Math.min(innerWidth / c.width, innerHeight / c.height) || 1;
  const x = Math.max(0, (innerWidth - c.width * s) / 2);
  const y = Math.max(0, (innerHeight - c.height * s) / 2);
  stage.style.transform = x < 0.5 && y < 0.5 && Math.abs(s - 1) < 0.001 ? '' : `translate(${x}px, ${y}px) scale(${s})`;
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
