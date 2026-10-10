// 弹幕点歌的后台状态：打开「弹幕点歌」页时读一次，之后由实时连接（music、music_notice、music_account）保持最新
import { reactive } from 'vue';
import type { MusicSettings } from '@starfall/shared';
import type { MusicItem, MusicNotice, MusicSong, MusicState } from '@starfall/shared/overlay';
import { get, put } from './api.ts';
import { attempt } from './toast.ts';

export interface MusicAccountStatus {
  loggedIn: boolean;
  uid?: number;
  name?: string;
  avatar?: string;
  vip?: boolean;
  invalid?: boolean;
  checkedAt?: number;
}

export interface LocalSong {
  id: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  cover: string | null;
  hasLyric: boolean;
  filename: string;
  size: number;
  folder: boolean;
  createdAt: number;
}

export type SearchHit = MusicSong & { playable: boolean; note?: string };

export interface MusicHistoryRow {
  id: number;
  item: MusicItem;
  status: 'played' | 'skipped' | 'cancelled' | 'failed';
  note: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export const music = reactive({
  loaded: false,
  settings: null as MusicSettings | null,
  state: null as MusicState | null,
  /** 列表里的全部歌（点歌窗口只收前几首，后台要全部） */
  queue: [] as MusicItem[],
  notices: [] as MusicNotice[],
  /** 出声的点歌窗口在不在 */
  player: false,
  account: null as MusicAccountStatus | null,
  libraryCount: 0,
  /** 收到状态时的本机时间（进度条按它往后走） */
  gotAt: 0,
  /** 本地歌库变了（别的窗口上传、删除）：歌库页据此重新读 */
  libraryRev: 0,
});

export async function loadMusic(): Promise<void> {
  const r = await get<{ settings: MusicSettings; state: MusicState; notices: MusicNotice[]; player: boolean; queue: MusicItem[]; account: MusicAccountStatus; library: { count: number } }>('/api/music');
  Object.assign(music, { loaded: true, settings: r.settings, state: r.state, notices: r.notices, player: r.player, queue: r.queue, account: r.account, libraryCount: r.library.count, gotAt: performance.now() });
}

/** 实时连接收到的点歌消息 */
export function onMusicMessage(m: { type: string; [k: string]: unknown }): void {
  if (m.type === 'music') {
    Object.assign(music, { state: m.state, notices: m.notices, player: m.player, queue: m.queue, gotAt: performance.now() });
  } else if (m.type === 'music_notice') {
    const n = m.notice as MusicNotice;
    if (!music.notices.some((x) => x.id === n.id)) music.notices = [n, ...music.notices].slice(0, 30);
  } else if (m.type === 'music_account') {
    music.account = m.account as MusicAccountStatus;
  }
}

/** 改点歌设置（只传改了的项）；msg 是成功后的提示 */
export async function saveMusic(patch: Partial<MusicSettings>, msg?: string): Promise<boolean> {
  const r = await attempt(() => put<{ settings: MusicSettings }>('/api/music/settings', patch), msg);
  if (r) music.settings = r.settings;
  return Boolean(r);
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 为什么没在放（后台顶部的提醒） */
export const HOLD_TEXT: Record<Exclude<MusicState['hold'], null>, string> = {
  disabled: '点歌关着：观众发点歌弹幕不会有反应',
  manual: '已暂停',
  offline: '没开播，已自动暂停：开播后自动接着放',
  no_player: '直播软件里还没加点歌窗口：歌不会放',
};
