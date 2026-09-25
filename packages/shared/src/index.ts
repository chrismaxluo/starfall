export const APP_NAME = '星临';
export const APP_NAME_EN = 'Starfall';

/** 正式服务默认端口（可用环境变量 STARFALL_PORT 修改） */
export const DEFAULT_PORT = 17520;

/** B 站礼物价格单位：1 元 = 1000 金瓜子（P0 实测确认） */
export const GOLD_PER_YUAN = 1000;

/** 金瓜子换算成元，用于显示 */
export function goldToYuan(gold: number): number {
  return gold / GOLD_PER_YUAN;
}
