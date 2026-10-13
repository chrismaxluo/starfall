// 弹幕点歌的后台状态：打开「弹幕点歌」页时读一次，之后由实时连接（music、music_notice、music_account）保持最新
import { reactive } from 'vue';
import type { MusicSettings } from '@starfall/shared';
import type { MusicItem, MusicNotice, MusicSong, MusicState } from '@starfall/shared/overlay';
import { del, get, post, put } from './api.ts';
import { state } from './store.ts';
import { attempt, toast, undoable } from './toast.ts';

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

// ---------- 列表、历史里的快捷操作（都能撤销） ----------

/** 从列表删掉一首，提示里可以撤销 */
export async function removeSong(it: MusicItem): Promise<void> {
  if (!(await attempt(() => del(`/api/music/queue/${it.id}`)))) return;
  undoable(`已从列表删掉《${it.song.name}》`, () => post('/api/music/queue/restore', { ids: [it.id] }));
}

/** 清空列表，提示里可以撤销 */
export async function clearQueue(): Promise<void> {
  const r = await attempt(() => post<{ cleared: number; ids: number[] }>('/api/music/queue/clear'));
  if (!r) return;
  if (!r.cleared) return toast('列表本来就是空的', 'info');
  undoable(`已清空 ${r.cleared} 首（正在放的这首放完）`, () => post('/api/music/queue/restore', { ids: r.ids }));
}

/** 不让这位观众点歌（主播自己不受限制）；列表里 TA 还没放的歌一起删掉 */
export async function banRequester(it: MusicItem): Promise<void> {
  const s = music.settings;
  if (!s) return;
  if (it.by.uid <= 0 || it.by.uid === state.status?.room?.anchorUid) return toast('主播自己不受点歌限制', 'info');
  const prev = s.bannedUids;
  if (!prev.includes(it.by.uid) && !(await saveMusic({ bannedUids: [...prev, it.by.uid] }))) return;
  const theirs = music.queue.filter((x) => x.by.uid === it.by.uid);
  for (const x of theirs) await attempt(() => del(`/api/music/queue/${x.id}`));
  undoable(`${it.by.name} 不能点歌了${theirs.length ? `，TA 列表里的 ${theirs.length} 首已删掉` : ''}`, async () => {
    await saveMusic({ bannedUids: prev });
    if (theirs.length) await post('/api/music/queue/restore', { ids: theirs.map((x) => x.id) });
  });
}

/** 这首歌以后不收（歌名加进「不收的歌」）；还在列表里的一起删掉 */
export async function blockSong(it: MusicItem): Promise<void> {
  const s = music.settings;
  if (!s) return;
  const prev = s.blockWords;
  if (!prev.includes(it.song.name) && !(await saveMusic({ blockWords: [...prev, it.song.name] }))) return;
  const same = music.queue.filter((x) => x.song.source === it.song.source && x.song.id === it.song.id);
  for (const x of same) await attempt(() => del(`/api/music/queue/${x.id}`));
  undoable(`《${it.song.name}》以后不收了`, async () => {
    await saveMusic({ blockWords: prev });
    if (same.length) await post('/api/music/queue/restore', { ids: same.map((x) => x.id) });
  });
}

/** 切歌、暂停 / 继续（总览卡片、命令面板用） */
export async function skipSong(): Promise<void> {
  await attempt(() => post('/api/music/skip'), '已切歌');
}
export async function toggleMusicPause(): Promise<void> {
  const r = await attempt(() => post<{ paused: boolean }>('/api/music/toggle-pause'));
  if (r) toast(r.paused ? '已暂停点歌：正在放的歌停在这里' : '继续放歌');
}
