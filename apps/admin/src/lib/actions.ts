// 顶栏、暂停提示条和命令面板共用的操作
import { ref } from 'vue';
import { post } from './api.ts';
import { refreshStatus, state } from './store.ts';
import { attempt, toast } from './toast.ts';

// 请求还没返回时不再发第二次（连点、按住快捷键时不会一下暂停一下又恢复）。
// 一点马上换成新的样子（顶部提示条滑下来），不再另外弹提示；没成功就换回去并说明原因
export const pauseBusy = ref(false);
export async function togglePause(): Promise<void> {
  if (pauseBusy.value) return;
  pauseBusy.value = true;
  const s = state.status;
  const was = s?.paused ?? false;
  if (s) s.paused = !was;
  try {
    const ok = await attempt(() => post(was ? '/api/playback/resume' : '/api/playback/pause'));
    if (!ok && s && state.status === s) s.paused = was;
    await refreshStatus().catch(() => undefined);
  } finally {
    pauseBusy.value = false;
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
