// 窗口和托盘的小规则（不依赖 Electron，方便测试）：窗口放在哪、托盘上怎么说现在的状态、缩放快捷键

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SavedWindow extends Rect {
  maximized: boolean;
}

/** 默认大小和最小大小（屏幕放不下时跟着屏幕缩小） */
const DEF_W = 1360;
const DEF_H = 880;
const MIN_W = 960;
const MIN_H = 640;
/** 和某块屏幕至少重叠这么多，才算还在这块屏幕上（标题栏能抓得到） */
const MIN_VISIBLE = 200 * 120;

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 窗口放在哪：回到上次的位置、大小、是否最大化（放在上次那块屏幕上）；那块屏幕没了（副屏拔掉）或者位置看不见了，放到主屏中间。
 * 第一次打开按主屏大小来定，笔记本小屏幕也放得下。areas 是每块屏幕去掉任务栏后的范围
 */
export function placeWindow(saved: SavedWindow | undefined, areas: Rect[], primary: Rect): { bounds: Rect; maximized: boolean; minWidth: number; minHeight: number } {
  let area: Rect | null = null;
  if (saved && saved.width > 0 && saved.height > 0) {
    let best = 0;
    for (const a of areas) {
      const o = overlap(saved, a);
      if (o > best) [best, area] = [o, a];
    }
    if (best < MIN_VISIBLE) area = null;
  }
  const mins = (a: Rect) => ({ minWidth: Math.min(MIN_W, a.width), minHeight: Math.min(MIN_H, a.height) });
  if (saved && area) {
    const width = Math.min(saved.width, area.width);
    const height = Math.min(saved.height, area.height);
    const x = clamp(saved.x, area.x, area.x + area.width - width);
    const y = clamp(saved.y, area.y, area.y + area.height - height);
    return { bounds: { x, y, width, height }, maximized: saved.maximized, ...mins(area) };
  }
  // 占屏幕的九成多，但不小于最小大小（屏幕本身比最小大小还小时就是整个屏幕）
  const width = Math.min(DEF_W, Math.max(Math.round(primary.width * 0.92), Math.min(MIN_W, primary.width)));
  const height = Math.min(DEF_H, Math.max(Math.round(primary.height * 0.92), Math.min(MIN_H, primary.height)));
  return { bounds: { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height }, maximized: false, ...mins(primary) };
}

/** 托盘要用的状态（/api/status 里的几项） */
export interface StatusLite {
  paused?: boolean;
  overlays?: number;
  room?: unknown;
  account?: { loggedIn?: boolean; expiresAt?: number | null };
  live?: { live?: boolean; connection?: string; loginInvalid?: boolean };
}

/** 鼠标放在托盘图标上的一句话；problem：要提醒的问题（没在直播时托盘弹一次） */
export function trayStatus(s: StatusLite | null, now: number): { text: string; problem: { key: string; title: string; text: string } | null } {
  const N = '星临';
  if (!s) return { text: `${N} · 正在连接服务…`, problem: null };
  const a = s.account;
  const loginBad = Boolean(s.room) && (!a?.loggedIn || s.live?.loginInvalid === true || (a.expiresAt !== undefined && a.expiresAt !== null && a.expiresAt < now));
  if (loginBad) return { text: `${N} · B站登录失效，收不到直播间消息`, problem: { key: 'login', title: 'B站登录失效了', text: '收不到直播间的消息，特效不会播放。打开星临，扫码重新登录就能恢复。' } };
  if (s.paused) return { text: `${N} · 特效已暂停`, problem: null };
  if (s.live?.live) {
    if (s.live.connection !== 'connected') return { text: `${N} · 直播中，正在重连直播间`, problem: null };
    if (!((s.overlays ?? 0) > 0)) return { text: `${N} · 直播中，特效页没连上`, problem: null };
    return { text: `${N} · 直播中，一切正常`, problem: null };
  }
  if (!s.room) return { text: `${N} · 还没设置直播间`, problem: null };
  return { text: `${N} · 未开播，开播后自动连接`, problem: null };
}

/** Ctrl + 这个键：放大（0.5）、缩小（-0.5）、回到原样（0）；别的键为 null */
export function zoomStep(key: string): number | null {
  if (key === '=' || key === '+') return 0.5;
  if (key === '-' || key === '_') return -0.5;
  if (key === '0') return 0;
  return null;
}
