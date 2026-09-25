// 接口返回的数据格式（与服务端 apps/server 的返回值一致）
import type { Effect, EnterRules, Exclusive, GuardLevel, Medal, MedalBand, OverlayConfig, PlayStatus, Tier, TierRule, TriggerKind, Viewer } from '@starfall/shared';

export type { Tier, TierRule, MedalBand, PlayStatus, TriggerKind, Viewer, Medal, GuardLevel, OverlayConfig };

export interface AssetDto {
  id: number;
  kind: 'video' | 'image' | 'fx' | 'audio';
  filename: string;
  url: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAlpha: boolean;
  warnings: Array<'no_alpha' | 'large'>;
  createdAt: number;
}

export interface EffectDto extends Effect {
  asset: AssetDto | null;
  sound: AssetDto | null;
  usedBy: Array<{ page: 'enter'; label: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface SoundDto extends AssetDto {
  usedBy: Array<{ id: number; name: string; as: 'visual' | 'sound' }>;
}

export type EnterBase = Omit<EnterRules, 'exclusives'>;

export interface ExclusiveDto extends Exclusive {
  name: string | null;
  face: string | null;
  createdAt: number;
}

export interface OutputDto {
  id: number;
  name: string;
  app: 'livehime' | 'obs';
  orient: 'portrait' | 'landscape';
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  marginX: number;
  scale: number;
  liteMode: 'auto' | 'on' | 'off';
  key: string;
  path: string;
}

export type AccountStatus = { loggedIn: false } | { loggedIn: true; uid: number; name: string; face: string; expiresAt: number | null };

export interface RoomRecord {
  roomId: number;
  shortId: number;
  anchorUid: number;
  anchorName: string;
}

export interface LiveStatus {
  live: boolean;
  liveSince: number | null;
  sessionId: number | null;
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';
  connectionDetail: string | null;
  reason: 'ok' | 'no_room' | 'not_logged_in' | 'offline';
  adminCount: number;
}

export interface StatusSnapshot {
  live: LiveStatus;
  account: AccountStatus;
  room: RoomRecord | null;
  paused: boolean;
  queue: { playing: boolean; size: number };
  overlays: number;
}

export interface Settings {
  paused: boolean;
  connectMode: 'live_only' | 'always';
  offlinePolicy: 'mute' | 'play';
  cooldownMode: 'minutes' | 'oncePerLive';
  queueMax: number;
  queueJump: boolean;
  blockAnchor: boolean;
  blockAccount: boolean;
  retentionDays: 0 | 30 | 90 | 180;
}

export interface EventDto {
  id: number;
  ts: number;
  kind: TriggerKind;
  uid: number;
  uname: string;
  viewer: Viewer;
  payload: { source?: string; text?: string; giftName?: string; count?: number; unitPrice?: number; level?: number; months?: number; op?: string } | null;
  rule: string | null;
  effectId: number | null;
  status: PlayStatus;
}

export interface QueueSnapshot {
  playing: { id: string; kind: TriggerKind; effectName: string; viewerName: string; startedAt: number; durationMs: number; test: boolean } | null;
  items: Array<{ id: string; kind: TriggerKind; effectName: string; viewerName: string; enqueuedAt: number; test: boolean }>;
}

export interface OverlayInfo {
  outputId: number;
  since: number;
  env: Record<string, string | number | boolean | null> | null;
  lastError: string | null;
}

export interface TodayStats {
  day: string;
  since: number;
  enterUnique: number;
  played: number;
  guardPlayed: number;
  composition: Record<'gov' | 'adm' | 'cap' | 'mod' | 'fan' | 'nor', number>;
}

export interface BlacklistEntry {
  uid: number;
  name: string;
  note: string;
  createdAt: number;
}

export interface SimulateResult {
  rule: string | null;
  effect: { id: number; name: string } | null;
  status: PlayStatus;
  statusText: string;
}
