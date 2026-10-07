// 内置样式：大航海宫廷三级（金銮、亭阁、门楼），礼物卡片（晶礼、晶耀），玻璃质感（晶巡、晶语），霜玻（粉丝牌、普通观众），一行字
import type { PlayItem } from '@starfall/shared';
import { h } from './dom.ts';
import { avatar, medal, textLine } from './parts.ts';
import { GIFT_STYLES } from './giftcard.ts';
import { GLASS_FULL, GLASS_STYLES } from './glass.ts';
import { ROYAL_STYLES, buildRoyal } from './royal.ts';

export interface StageSize {
  width: number;
  height: number;
  /** 特效整体缩放（输出设置里的缩放 × 画布大小） */
  fxz?: number;
}

type Builder = (item: PlayItem, stage: StageSize) => HTMLElement;

const card = (cls: string, ...children: Array<Node | null>) => h('div', { class: `fx ${cls}` }, ...children);

const BUILDERS: Record<string, Builder> = {
  line: (it) => card('fx-line', h('i'), textLine(it.text, it.viewer.name)),

  frost: (it) => card('fx-frost glass', avatar(it.viewer), medal(it.viewer), textLine(it.text, it.viewer.name)),
};

/** 这个样式是否占满整个画面（不按位置摆放） */
export const isFullStage = (style: string) => style in ROYAL_STYLES || GLASS_FULL.has(style);

export function buildBuiltin(item: PlayItem, style: string, stage: StageSize): HTMLElement {
  const royal = ROYAL_STYLES[style];
  if (royal) return buildRoyal(item, royal, stage);
  const glass = GIFT_STYLES[style] ?? GLASS_STYLES[style];
  if (glass) return glass(item, stage);
  return (BUILDERS[style] ?? BUILDERS.line!)(item, stage);
}
