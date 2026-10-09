// 本直播间的礼物面板（礼物规则、送礼名单选礼物用）。读不到时把原因说清楚：还没填直播间号就给去设置的入口，其他原因可以重试；
// 填好直播间号或换了直播间后自动重读
import { onMounted, ref, watch } from 'vue';
import { ApiError, get } from './api.ts';
import { state } from './store.ts';
import type { GiftConfig } from './types.ts';

export function useGiftCatalog() {
  const catalog = ref<GiftConfig[]>([]);
  /** 读取失败的原因（空 = 没出错） */
  const error = ref('');
  /** 还没填直播间号 */
  const noRoom = ref(false);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      catalog.value = (await get<{ gifts: GiftConfig[] }>('/api/gifts')).gifts;
      error.value = '';
      noRoom.value = false;
    } catch (e) {
      noRoom.value = e instanceof ApiError && e.code === 'no_room';
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);
  watch(
    () => state.status?.room?.roomId,
    (id, old) => {
      if (id && id !== old) void load();
    },
  );
  return { catalog, error, noRoom, loading, load };
}
