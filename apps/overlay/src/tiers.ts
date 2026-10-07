// 礼物按价值分档的颜色（金瓜子）：B站连击条的四种颜色。礼物卡片（晶礼、晶耀）和送礼名单共用
export interface Tier {
  c1: string;
  c2: string;
  c3: string;
}

const TIERS: Array<Tier & { from: number }> = [
  { from: 100_000, c1: '#FF9D00', c2: '#FFD400', c3: '#FFF1B8' },
  { from: 50_000, c1: '#FF49A1', c2: '#FF7AB6', c3: '#FFD3E8' },
  { from: 10_000, c1: '#9F66FF', c2: '#6FACFE', c3: '#E2D4FF' },
  { from: 0, c1: '#3D8BFF', c2: '#62C6FF', c3: '#D3ECFF' },
];

export const tierOf = (value: number): Tier => TIERS.find((t) => value >= t.from)!;

/** 大航海自己的颜色（和弹幕列表、B站里一样）：舰长蓝、提督紫、总督红金，和礼物的价值档分开 */
const GUARD_TIERS: Record<1 | 2 | 3, Tier> = {
  3: { c1: '#2F7BFF', c2: '#4FB2FF', c3: '#CFE6FF' },
  2: { c1: '#8F4DFF', c2: '#C77DFF', c3: '#ECDDFF' },
  1: { c1: '#FF4E3A', c2: '#FFB13D', c3: '#FFE3B0' },
};
export const guardTier = (level: 1 | 2 | 3): Tier => GUARD_TIERS[level];

/** 写成 CSS 变量 */
export const tierVars = (t: Tier) => ({ '--c1': t.c1, '--c2': t.c2, '--c3': t.c3 });
