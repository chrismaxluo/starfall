// 按名字在 B 站全站礼物里找（礼物规则、送礼名单、模拟送礼用）：盲盒里爆出来的权杖、下架的活动礼物这类不在礼物面板上，
// 面板列表里找不到。打字停下 0.3 秒后去找，只用最后一次的结果；面板里已经有的不重复列
import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import { get } from './api.ts';
import type { GiftConfig } from './types.ts';

export function useGiftSearch(q: Ref<string>, known: () => GiftConfig[]): { extra: Ref<GiftConfig[]>; searching: Ref<boolean> } {
  const extra = ref<GiftConfig[]>([]);
  const searching = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  watch(q, (v) => {
    clearTimeout(timer);
    const key = v.trim();
    seq++;
    if (!key) {
      extra.value = [];
      searching.value = false;
      return;
    }
    searching.value = true;
    timer = setTimeout(async () => {
      const my = seq;
      const r = await get<{ gifts: GiftConfig[] }>(`/api/gifts/search?q=${encodeURIComponent(key)}`).catch(() => ({ gifts: [] }));
      if (my !== seq) return;
      const have = new Set(known().map((g) => g.id));
      extra.value = r.gifts.filter((g) => !have.has(g.id));
      searching.value = false;
    }, 300);
  });
  return { extra, searching };
}
