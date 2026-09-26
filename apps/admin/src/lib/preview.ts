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
  return `${y >= 100 ? Math.round(y) : Math.round(y * 10) / 10} 元`;
};
