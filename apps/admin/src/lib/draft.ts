// 先改、再保存：外观这类设置改动先放在草稿里，预览照着草稿显示，点「保存」才发到服务端、出现在直播画面上。
// 有没保存的改动时，换页面、刷新、关掉后台前先问一句（lib/route.ts）
import { computed, onBeforeUnmount, ref } from 'vue';
import { leaveGuards } from './route.ts';

/**
 * 草稿：source 是已保存的值，keys 是要先改再保存的字段，save 把改动发出去（成功返回 true）。
 * pending 只含和已保存不一样的字段；view 是「已保存 + 草稿」，给预览和界面用
 */
export function useDraft<T extends object, K extends keyof T>(source: () => T | undefined, keys: readonly K[], save: (patch: Partial<Pick<T, K>>) => Promise<boolean>) {
  const edits = ref<Partial<Pick<T, K>>>({}) as { value: Partial<Pick<T, K>> };
  const pending = computed(() => {
    const s = source();
    const out: Partial<Pick<T, K>> = {};
    if (!s) return out;
    for (const k of keys) if (k in edits.value && edits.value[k] !== s[k]) out[k] = edits.value[k];
    return out;
  });
  const dirty = computed(() => Object.keys(pending.value).length > 0);
  const view = computed(() => {
    const s = source();
    return s ? ({ ...s, ...pending.value } as T) : undefined;
  });
  const saving = ref(false);

  const set = (patch: Partial<Pick<T, K>>) => void (edits.value = { ...edits.value, ...patch });
  const reset = () => void (edits.value = {});
  async function commit(): Promise<boolean> {
    if (!dirty.value || saving.value) return false;
    saving.value = true;
    const ok = await save({ ...pending.value }).finally(() => (saving.value = false));
    if (ok) reset();
    return ok;
  }

  const guard = () => dirty.value;
  leaveGuards.add(guard);
  onBeforeUnmount(() => leaveGuards.delete(guard));

  return { view, pending, dirty, saving, set, reset, commit };
}
