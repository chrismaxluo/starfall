// 上传素材的位置微调和大小：算出挪动、缩放后的位置，判断有没有盖住信息栏、弹幕区或超出画面
import type { Position } from '@starfall/shared';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 缩放时不动的那个点：左下角的素材贴着左下，顶部的贴着上边，居中的按中心 */
export function scaleRect(r: Rect, k: number, pos: Position): Rect {
  const w = r.w * k;
  const h = r.h * k;
  const x = pos === 'bl' ? r.x : pos === 'br' ? r.x + r.w - w : r.x + (r.w - w) / 2;
  const y = pos === 'top' ? r.y : pos === 'center' ? r.y + (r.h - h) / 2 : r.y + r.h - h;
  return { x, y, w, h };
}

/**
 * 和不挪、不缩放的时候比，调整后多盖住了哪些区域（多 1 像素以上才算）。
 * base：不挪、100% 时素材的位置；stage：画面；safeTop / safeBottom：安全区占画面高度的百分比。
 */
export function placeWarnings(base: Rect, stage: Rect, o: { safeTop: number; safeBottom: number }, pos: Position, dx: number, dy: number, sizePct: number): { into: string[]; out: boolean } {
  const s = scaleRect(base, sizePct / 100, pos);
  const r = { x: s.x + (stage.w * dx) / 100, y: s.y + (stage.h * dy) / 100, w: s.w, h: s.h };
  const top = stage.y + (stage.h * o.safeTop) / 100;
  const bot = stage.y + stage.h - (stage.h * o.safeBottom) / 100;
  const more = (now: number, was: number) => Math.max(0, now) > Math.max(0, was) + 1;
  const into: string[] = [];
  if (more(top - r.y, top - base.y)) into.push('顶部信息栏');
  if (more(r.y + r.h - bot, base.y + base.h - bot)) into.push('底部弹幕区');
  // 超出画面：四条边任意一条比原来多出去
  const outs = (q: Rect) => [stage.x - q.x, q.x + q.w - (stage.x + stage.w), stage.y - q.y, q.y + q.h - (stage.y + stage.h)];
  const b = outs(base);
  const out = outs(r).some((v, i) => more(v, b[i]!));
  return { into, out };
}
