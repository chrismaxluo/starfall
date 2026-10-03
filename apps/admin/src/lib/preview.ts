// 规则页里各个标签共用的"在右侧预览"请求
import { SAMPLES } from './identity.ts';
import type { SampleViewer } from './identity.ts';
import type { EffectDto, TriggerKind } from './types.ts';

export interface PreviewRequest {
  effectId: number | null;
  viewer: SampleViewer;
  label: string;
  kind?: TriggerKind;
  vars?: { text?: string; gift?: string; count?: number; valueGold?: number; months?: number; guardLevel?: 1 | 2 | 3; op?: 'open' | 'renew' };
}

/** 按事件类型预览时用的示例观众和内容（礼物带礼物图和数量、弹幕带弹幕内容） */
export const PREVIEW_BY_KIND: Record<TriggerKind, Omit<PreviewRequest, 'effectId' | 'label'>> = {
  enter: { viewer: SAMPLES.cap, kind: 'enter' },
  danmu: { viewer: SAMPLES.nor, kind: 'danmu', vars: { text: '主播晚上好！' } },
  gift: { viewer: SAMPLES.fan, kind: 'gift', vars: { gift: '小花花', count: 66, valueGold: 6600 } },
  guard: { viewer: SAMPLES.cap, kind: 'guard', vars: { guardLevel: 3, op: 'open', months: 1 } },
};
/** 特效平时用在哪类事件上（没在用的按进场） */
export const usualKind = (e: EffectDto | undefined): TriggerKind => e?.usedBy[0]?.page ?? 'enter';

export const yuan = (gold: number) => {
  const y = gold / 1000;
  return `${Math.round(y * 10) / 10} 元`;
};

/** B 站礼物面板上的价格写法：1 电池 = 100 金瓜子 = 0.1 元；超过 1 万写成「1.314万电池」 */
export const battery = (gold: number) => {
  const b = gold / 100;
  return b > 10_000 ? `${Math.round(b / 10) / 1000}万电池` : `${Math.round(b * 10) / 10}电池`;
};
/** 电池数，后面括号备注金额：「1000电池（100 元）」 */
export const batteryYuan = (gold: number) => `${battery(gold)}（${yuan(gold)}）`;
