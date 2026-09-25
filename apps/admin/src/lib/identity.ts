// 观众身份：标签、颜色、示例观众（预览用）
import type { Tier, Viewer } from './types.ts';

export type Identity = Tier | 'fan';

export const IDENTITY: Record<Identity, { name: string; icon: string | null; color: string; grad: string }> = {
  gov: { name: '总督', icon: 'g-gov', color: 'var(--gov)', grad: 'linear-gradient(135deg,#F7D58B,#C8612A)' },
  adm: { name: '提督', icon: 'g-adm', color: 'var(--adm)', grad: 'linear-gradient(135deg,#C9A8FF,#6A3FD1)' },
  cap: { name: '舰长', icon: 'g-cap', color: 'var(--cap)', grad: 'linear-gradient(135deg,#9CC4FF,#2F63D9)' },
  mod: { name: '房管', icon: 'g-mod', color: 'var(--mod)', grad: 'linear-gradient(135deg,#8FE6D6,#0E8C7A)' },
  fan: { name: '粉丝牌', icon: null, color: '#C770A4', grad: 'linear-gradient(135deg,#6B6F9E,#2D3059)' },
  nor: { name: '普通', icon: null, color: 'var(--nor)', grad: 'linear-gradient(135deg,#6C7080,#3A3D48)' },
};

/** 观众在本直播间的身份（大航海 > 房管 > 本直播间粉丝牌 > 普通） */
export function identityOf(v: Viewer, anchorUid: number | undefined): Identity {
  if (v.guard === 1) return 'gov';
  if (v.guard === 2) return 'adm';
  if (v.guard === 3) return 'cap';
  if (v.isMod) return 'mod';
  if (v.medal && v.medal.level > 0 && (anchorUid === undefined || v.medal.anchorUid === anchorUid)) return 'fan';
  return 'nor';
}

/** 预览用的示例观众 */
export interface SampleViewer {
  name: string;
  guard: 0 | 1 | 2 | 3;
  isMod: boolean;
  medalLevel: number | null;
}

export const SAMPLES: Record<Identity, SampleViewer> = {
  gov: { name: '长夜未央', guard: 1, isMod: false, medalLevel: 44 },
  adm: { name: '月下独酌', guard: 2, isMod: false, medalLevel: 38 },
  cap: { name: '星河漫步', guard: 3, isMod: false, medalLevel: 27 },
  mod: { name: '青柠汽水', guard: 0, isMod: true, medalLevel: 15 },
  fan: { name: '晚风与你', guard: 0, isMod: false, medalLevel: 21 },
  nor: { name: '路过的猫', guard: 0, isMod: false, medalLevel: null },
};

/** B 站粉丝牌配色（消息里没有颜色时使用） */
export function medalColors(level: number, guard = false): { bg: string; level: string; border: string; text: string } {
  const t = level <= 10 ? ['#5762A7', null] : level <= 20 ? ['#C770A4', null] : level <= 30 ? ['#3FB4F6', '#5FC7F4'] : level <= 40 ? ['#4C7DFF', '#58A1F8'] : level <= 50 ? ['#A773F1', '#D47AFF'] : ['#EC4F6E', '#F18087'];
  return { bg: `${t[0]}99`, level: `${t[0]}E6`, border: guard && t[1] ? t[1] : `${t[0]}99`, text: '#FFFFFF' };
}

/** 内置样式的名称和色块（素材卡片、素材选择） */
export const STYLES: Record<string, { name: string; grad: string; edge: string }> = {
  star: { name: '星冕', grad: IDENTITY.gov.grad, edge: 'rgba(240,180,90,.75)' },
  meteor: { name: '流星', grad: IDENTITY.adm.grad, edge: 'rgba(183,148,255,.7)' },
  flow: { name: '流光', grad: IDENTITY.cap.grad, edge: 'rgba(111,168,255,.7)' },
  patrol: { name: '巡场', grad: IDENTITY.mod.grad, edge: 'rgba(79,209,188,.55)' },
  frost: { name: '霜玻', grad: 'linear-gradient(135deg,#3FB4F6,#2B2F5E)', edge: 'rgba(255,255,255,.2)' },
  line: { name: '一行字', grad: IDENTITY.nor.grad, edge: 'transparent' },
  gift: { name: '礼物', grad: 'linear-gradient(135deg,#FFB38A,#E0568F)', edge: 'rgba(255,150,170,.7)' },
  bubble: { name: '气泡', grad: 'linear-gradient(135deg,#7FD8F5,#4C6FE0)', edge: 'rgba(127,216,245,.6)' },
};
export const ASSET_SWATCH = 'linear-gradient(135deg,#2A2B3A,#15161F)';
