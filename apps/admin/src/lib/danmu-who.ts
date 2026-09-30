// 弹幕规则「谁发的才算」：一句话说明（规则列表里显示）和预览用的示例观众
import type { DanmuWho } from '@starfall/shared';
import { SAMPLES } from './identity.ts';
import type { SampleViewer } from './identity.ts';

export interface DanmuPerson {
  uid: number;
  name: string | null;
  face: string | null;
  guard: number;
}

const GUARD = { 1: '总督', 2: '提督', 3: '舰长' } as const;

/** 例如「所有人」「主播、房管」「大航海」「粉丝牌 20 级以上、道具堡」 */
export function whoText(w: DanmuWho, people: DanmuPerson[] = []): string {
  if (w.all) return '所有人';
  const parts: string[] = [];
  if (w.anchor) parts.push('主播');
  if (w.mod) parts.push('房管');
  if (w.guards.length === 3) parts.push('大航海');
  else for (const g of [...w.guards].sort()) parts.push(GUARD[g]);
  if (w.fanMin !== null) parts.push(w.fanMin <= 1 ? '戴本房间粉丝牌' : `粉丝牌 ${w.fanMin} 级以上`);
  if (w.honorMin !== null) parts.push(`荣耀 ${w.honorMin} 级以上`);
  if (w.uids.length) {
    const names = w.uids.map((uid) => people.find((p) => p.uid === uid)?.name || String(uid));
    parts.push(names.length <= 2 ? names.join('、') : `${names[0]} 等 ${names.length} 人`);
  }
  return parts.length > 3 ? `${parts.slice(0, 3).join('、')} 等` : parts.join('、') || '（没选）';
}

/** 预览用的示例观众：按勾选的身份挑一个能触发的 */
export function sampleFor(w: DanmuWho): SampleViewer {
  if (w.all || w.fanMin !== null) return w.fanMin !== null && w.fanMin > 21 ? { ...SAMPLES.fan, medalLevel: w.fanMin } : SAMPLES.fan;
  if (w.guards.length) return [SAMPLES.cap, SAMPLES.gov, SAMPLES.adm, SAMPLES.cap][Math.min(...w.guards)]!;
  if (w.mod) return SAMPLES.mod;
  if (w.honorMin !== null) return { ...SAMPLES.nor, honor: Math.max(28, w.honorMin) };
  return SAMPLES.nor;
}
