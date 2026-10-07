// 观众身份：标签、颜色、示例观众（预览用）
import type { Tier, Viewer } from './types.ts';

export type Identity = Tier | 'fan';

// B站官方大航海图标（200×200，直播间「大航海」页的静态资源）。版权归哔哩哔哩：只在运行时引用，不放进项目；
// 地址带构建哈希，B站改版后可能失效，加载失败时退回自绘的 g-xxx 图标。见 docs/bili-protocol.md §5.6.2
const BADGE = 'https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/';

export const IDENTITY: Record<Identity, { name: string; icon: string | null; badge?: string; color: string; grad: string }> = {
  gov: { name: '总督', icon: 'g-gov', badge: `${BADGE}governor-DpDXKEdA.png`, color: 'var(--gov)', grad: 'linear-gradient(135deg,#F7D58B,#C8612A)' },
  adm: { name: '提督', icon: 'g-adm', badge: `${BADGE}supervisor-u43ElIjU.png`, color: 'var(--adm)', grad: 'linear-gradient(135deg,#C9A8FF,#6A3FD1)' },
  cap: { name: '舰长', icon: 'g-cap', badge: `${BADGE}captain-Bjw5Byb5.png`, color: 'var(--cap)', grad: 'linear-gradient(135deg,#9CC4FF,#2F63D9)' },
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

/** 主播本人（显示「主播」标签，不算普通观众） */
export function isAnchor(v: Viewer, anchorUid: number | undefined): boolean {
  return anchorUid !== undefined && anchorUid > 0 && v.uid === anchorUid;
}

/** 预览用的示例观众 */
export interface SampleViewer {
  name: string;
  guard: 0 | 1 | 2 | 3;
  isMod: boolean;
  medalLevel: number | null;
  /** 荣耀等级（0 没有）；不填用服务端的示例等级 */
  honor?: number;
}

export const SAMPLES: Record<Identity, SampleViewer> = {
  gov: { name: '长夜未央', guard: 1, isMod: false, medalLevel: 44 },
  adm: { name: '月下独酌', guard: 2, isMod: false, medalLevel: 38 },
  cap: { name: '星河漫步', guard: 3, isMod: false, medalLevel: 27 },
  mod: { name: '青柠汽水', guard: 0, isMod: true, medalLevel: 15 },
  fan: { name: '晚风与你', guard: 0, isMod: false, medalLevel: 21 },
  nor: { name: '路过的猫', guard: 0, isMod: false, medalLevel: null },
};

/** B站粉丝牌配色（消息里没有颜色时使用） */
export function medalColors(level: number, guard = false): { bg: string; level: string; border: string; text: string } {
  const t = level <= 10 ? ['#5762A7', null] : level <= 20 ? ['#C770A4', null] : level <= 30 ? ['#3FB4F6', '#5FC7F4'] : level <= 40 ? ['#4C7DFF', '#58A1F8'] : level <= 50 ? ['#A773F1', '#D47AFF'] : ['#EC4F6E', '#F18087'];
  return { bg: `${t[0]}99`, level: `${t[0]}E6`, border: guard && t[1] ? t[1] : `${t[0]}99`, text: '#FFFFFF' };
}

/** 内置样式的名称和色块（素材卡片、素材选择） */
export const STYLES: Record<string, { name: string; grad: string; edge: string }> = {
  'royal-gov': { name: '金銮', grad: 'linear-gradient(135deg,#F2C46E,#B3342A)', edge: 'rgba(233,194,122,.8)' },
  'royal-adm': { name: '亭阁', grad: 'linear-gradient(135deg,#E6BF86,#4A1C54)', edge: 'rgba(230,191,134,.75)' },
  'royal-cap': { name: '门楼', grad: 'linear-gradient(135deg,#A9DDF0,#1F4F86)', edge: 'rgba(169,221,240,.7)' },
  'glass-gift': { name: '晶礼', grad: 'linear-gradient(135deg,#FFD2B8,#6B5A7E)', edge: 'rgba(255,179,138,.7)' },
  'glass-big': { name: '晶耀', grad: 'linear-gradient(135deg,#FFE0A8,#7A5A40)', edge: 'rgba(255,195,122,.75)' },
  'bili-gift': { name: 'B站动画', grad: 'linear-gradient(135deg,#FF9DC4,#3D5BD9)', edge: 'rgba(255,157,196,.7)' },
  'glass-mod': { name: '晶巡', grad: 'linear-gradient(135deg,#B8F2E8,#2F5A62)', edge: 'rgba(61,214,193,.6)' },
  'glass-dm': { name: '晶语', grad: 'linear-gradient(135deg,#CFE9FF,#3E5C8A)', edge: 'rgba(124,199,255,.6)' },
  frost: { name: '霜玻', grad: 'linear-gradient(135deg,#3FB4F6,#2B2F5E)', edge: 'rgba(255,255,255,.2)' },
  line: { name: '一行字', grad: IDENTITY.nor.grad, edge: 'transparent' },
};
export const ASSET_SWATCH = 'linear-gradient(135deg,#2A2B3A,#15161F)';
