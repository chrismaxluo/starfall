// 总览右侧面板共用：B 站名单里的人换成后台的观众格式、身份说明
import type { ListViewer, Viewer } from './types.ts';

export const GUARD_TEXT: Record<number, string> = { 1: '总督', 2: '提督', 3: '舰长' };

export function toViewer(v: ListViewer): Viewer {
  return { uid: v.uid, name: v.name, ...(v.face ? { face: v.face } : {}), guard: v.guard, isMod: false, ...(v.medal ? { medal: v.medal } : {}), ...(v.honor ? { honor: v.honor } : {}), mystery: v.mystery };
}

/** 一行说明里的身份：总督 / 房管 / 粉丝牌 N 级 / 普通观众 */
export function roleText(v: Viewer, anchorUid: number | undefined): string {
  if (v.guard) return GUARD_TEXT[v.guard]!;
  if (v.isMod) return '房管';
  if (v.medal && v.medal.level > 0 && (anchorUid === undefined || v.medal.anchorUid === anchorUid)) return `粉丝牌 ${v.medal.level} 级`;
  return '普通观众';
}

/** 页面在后台（切到别的标签页）时不刷新 */
export const pageVisible = () => document.visibilityState === 'visible';
