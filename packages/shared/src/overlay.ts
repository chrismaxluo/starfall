// 服务端与特效页之间的消息（方案设计 9.3）。特效页和服务端共用这些类型。
import type { GuardLevel, TriggerKind } from './events.ts';
import type { Position } from './rules.ts';

export interface OverlayConfig {
  outputId: number;
  name: string;
  app: 'livehime' | 'obs';
  orient: 'portrait' | 'landscape';
  width: number;
  height: number;
  /** 安全区，单位：画布高度 / 宽度的百分比 */
  safeTop: number;
  safeBottom: number;
  marginX: number;
  /** 特效整体缩放，百分比 */
  scale: number;
  liteMode: 'auto' | 'on' | 'off';
}

export type PlayVisual =
  | { type: 'builtin_style'; style: string }
  | { type: 'asset'; url: string; ext: string; kind: 'video' | 'image' | 'fx'; width: number | null; height: number | null; hasAlpha: boolean };

/** 一次播放：入队时生成的快照，播放过程中修改素材不影响它 */
export interface PlayItem {
  id: string;
  kind: TriggerKind;
  effect: {
    id: number;
    name: string;
    visual: PlayVisual;
    showText: boolean;
    position: Position;
    durationMs: number;
    sound: { url: string } | null;
    volume: number;
  };
  /** 替换好变量的欢迎语（纯文本，特效页不能当作 HTML 显示） */
  text: string;
  viewer: {
    name: string;
    face?: string;
    guard: GuardLevel;
    isMod: boolean;
    medal?: { name: string; level: number; colors?: { bg: string; level: string; border: string; text: string } };
  };
  /** 上舰事件：开通还是续费（宫廷特效的印章用） */
  guardOp?: 'open' | 'renew';
  /** 后台"测试播放"发出的 */
  test?: boolean;
}

export type ServerToOverlay =
  | { type: 'hello'; config: OverlayConfig; preload: string[] }
  | { type: 'config'; config: OverlayConfig }
  | { type: 'preload'; preload: string[] }
  | { type: 'play'; item: PlayItem }
  | { type: 'stop' };

export type OverlayToServer =
  | { type: 'report'; env: Record<string, string | number | boolean | null> }
  | { type: 'started'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'error'; id?: string; message: string };

/** 特效页被服务端断开的原因（WebSocket 关闭码） */
export const OVERLAY_CLOSE = {
  /** 输出不存在或密钥不对（包括重置了密钥、删除了输出）：特效页不再重连 */
  badKey: 4003,
} as const;
