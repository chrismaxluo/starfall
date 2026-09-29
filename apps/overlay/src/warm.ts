// 预热：减少第一次播放时的卡顿。
// 特效页空闲时画面上没有文字，浏览器不会下载字体；第一个特效来的时候才临时下载字体、第一次绘制毛玻璃等效果，
// 画面会停顿一下（网络越慢越明显）。所以连上服务端后：先把常用字的字体下载好，再把每种内置样式用肉眼看不见的
// 透明度（0.001，换算到 8 位颜色是 0）渲染一遍。有真实特效要播时立即停止预热。
import type { PlayItem } from '@starfall/shared/overlay';
import { buildBuiltin, isFullStage } from './builtin.ts';
import type { StageSize } from './builtin.ts';
import { h } from './dom.ts';

/** 默认欢迎语、身份标签里的常用字 */
const COMMON = '欢迎感谢送出开通续费驾临前来巡场来了进入直播间总督提督舰长房管粉丝新个月礼物主播观众恭迎上舰光临驾到谢赏 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ·×：，';
const FONTS: Array<[string, number[]]> = [
  ['Geist Sans', [400, 500, 600, 700]],
  ['Noto Sans SC', [400, 500, 600, 700]],
  ['Geist Mono', [500, 600]],
  ['Noto Serif SC', [600, 900]],
];
const STYLES = ['line', 'frost', 'royal-cap', 'royal-adm', 'royal-gov', 'glass-gift', 'glass-big', 'glass-mod', 'glass-dm'];
const WARM_MS = 600;

export async function warmFonts(): Promise<void> {
  if (!document.fonts?.load) return;
  const jobs: Array<Promise<unknown>> = [];
  for (const [family, weights] of FONTS) for (const w of weights) jobs.push(document.fonts.load(`${w} 26px "${family}"`, COMMON).catch(() => undefined));
  await Promise.all(jobs);
}

const sample = (style: string): PlayItem => ({
  id: `warm-${style}`,
  kind: 'enter',
  effect: { id: 0, name: '', visual: { type: 'builtin_style', style }, showText: true, position: 'center', durationMs: WARM_MS, fadeIn: false, fadeOut: false, fadeInMs: 500, fadeOutMs: 500, offsetX: 0, offsetY: 0, sound: null, volume: 0 },
  text: '欢迎舰长 星临观众 登船',
  viewer: { name: '星临观众', guard: 3, isMod: false, medal: { name: '星临', level: 21 } },
});

/** 依次把每种内置样式渲染一遍；busy() 为真（有真实特效在播）时停止 */
export async function warmStyles(stage: HTMLElement, size: () => StageSize, busy: () => boolean): Promise<void> {
  for (const style of STYLES) {
    if (busy()) return;
    const fx = buildBuiltin(sample(style), style, size());
    const slot = h('div', { class: `slot warm ${isFullStage(style) ? 'full' : 'pos-center'}`, style: { '--dur': `${WARM_MS}ms` } }, isFullStage(style) ? fx : h('div', { class: 'z' }, fx));
    stage.append(slot);
    await new Promise((r) => setTimeout(r, WARM_MS));
    slot.remove();
  }
}

/** 连上服务端后预热一次（重连不再重复） */
let warmed = false;
export function warmUp(stage: HTMLElement, size: () => StageSize, busy: () => boolean): void {
  if (warmed) return;
  warmed = true;
  void warmFonts().then(() => warmStyles(stage, size, busy));
}
