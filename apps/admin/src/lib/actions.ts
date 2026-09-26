// 顶栏、暂停提示条和命令面板共用的操作
import { post } from './api.ts';
import { refreshStatus, state } from './store.ts';
import { attempt, toast } from './toast.ts';

// 请求还没返回时不再发第二次（连点、按住快捷键时不会一下暂停一下又恢复）
let busy = false;
export async function togglePause(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const paused = state.status?.paused ?? false;
    await attempt(() => post(paused ? '/api/playback/resume' : '/api/playback/pause'), paused ? '已恢复播放' : '已暂停所有特效');
    await refreshStatus().catch(() => undefined);
  } finally {
    busy = false;
  }
}

/** 快捷键只负责暂停（直播中慌忙多按一次不会变成恢复）；恢复要点按钮 */
export async function pauseOnly(): Promise<void> {
  if (state.status?.paused) {
    toast('已经暂停了，恢复请点「恢复播放」');
    return;
  }
  await togglePause();
}

export async function clearQueue(): Promise<void> {
  const r = await attempt(() => post<{ cleared: number }>('/api/playback/clear'));
  if (r) toast(r.cleared ? `已清空 ${r.cleared} 个排队的特效` : '队列本来就是空的');
}
