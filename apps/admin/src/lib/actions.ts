// 顶栏、暂停提示条和命令面板共用的操作
import { post } from './api.ts';
import { refreshStatus, state } from './store.ts';
import { attempt, toast } from './toast.ts';

export async function togglePause(): Promise<void> {
  const paused = state.status?.paused ?? false;
  await attempt(() => post(paused ? '/api/playback/resume' : '/api/playback/pause'), paused ? '已恢复播放' : '已暂停所有特效');
  await refreshStatus().catch(() => undefined);
}

export async function clearQueue(): Promise<void> {
  const r = await attempt(() => post<{ cleared: number }>('/api/playback/clear'));
  if (r) toast(r.cleared ? `已清空 ${r.cleared} 个排队的特效` : '队列本来就是空的');
}
