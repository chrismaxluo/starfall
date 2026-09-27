// 规则页里各个标签共用的"在右侧预览"请求
import type { SampleViewer } from './identity.ts';
import type { TriggerKind } from './types.ts';

export interface PreviewRequest {
  effectId: number | null;
  viewer: SampleViewer;
  label: string;
  kind?: TriggerKind;
  vars?: { text?: string; gift?: string; count?: number; valueGold?: number; months?: number; guardLevel?: 1 | 2 | 3; op?: 'open' | 'renew' };
}

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
