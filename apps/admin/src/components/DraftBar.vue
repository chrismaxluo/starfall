<script setup lang="ts">
// 草稿条：有没保存的改动时贴在卡片底部（滚动时停在屏幕下沿），放弃 / 保存。
// 从下面滑上来；保存成功后原地变成「已保存」，停一下再收起（不另外弹提示）
import { onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { quietNext } from '../lib/toast.ts';

/** 平常的保存提示交给草稿条自己说；带「浏览器源宽高要改」这类提醒的照常弹出 */
const PLAIN_SAVED = '已保存，直播画面已更新';
const SAVED_MS = 1400;

const props = defineProps<{ dirty: boolean; saving?: boolean }>();
const emit = defineEmits<{ save: []; discard: [] }>();
const saved = ref(false);
/** 点了保存、还没有结果：草稿条先留着（保存完到草稿清空之间有一下 dirty 已经是 false） */
const holding = ref(false);
let t: ReturnType<typeof setTimeout> | null = null;
function settle(): void {
  if (props.saving) return;
  holding.value = false;
  if (props.dirty) return;
  saved.value = true;
  if (t) clearTimeout(t);
  t = setTimeout(() => (saved.value = false), SAVED_MS);
}
function save(): void {
  quietNext(() => undefined, (text) => text === PLAIN_SAVED, 15_000);
  holding.value = true;
  emit('save');
  // 没有开始保存（例如已经在保存）：不留着
  setTimeout(() => !props.saving && (holding.value = false), 0);
}
// 保存中 → 保存完：草稿清空了就是成功（草稿在保存完之后才清空，等一下再看）
watch(
  () => props.saving,
  (now, was) => {
    if (was && !now) setTimeout(settle, 0);
  },
);
// 又改了：回到「有改动」
watch(
  () => props.dirty,
  (d) => {
    if (!d || !saved.value) return;
    saved.value = false;
    if (t) clearTimeout(t);
  },
);
onBeforeUnmount(() => t && clearTimeout(t));
</script>

<template>
  <Transition name="draft">
    <div v-if="dirty || saved || holding" class="draftbar" :class="{ ok: saved && !dirty }" role="status">
      <template v-if="saved && !dirty">
        <span class="draftbar-t"><Icon name="i-check" />已保存<small>直播画面已更新</small></span>
      </template>
      <template v-else>
        <span class="draftbar-t"><i />有改动还没保存<small>预览里是改后的样子，直播画面还是原来的</small></span>
        <button class="btn" type="button" :disabled="saving" @click="emit('discard')">放弃</button>
        <button class="btn primary" type="button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
.draftbar { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 8px; min-height: 54px; margin-top: 14px; padding: 10px 10px 10px 14px; border-radius: var(--r-md);
  background: var(--l3); border: 1px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 10px 24px -12px rgba(0, 0, 0, .35); transition: border-color .2s, box-shadow .2s; }
.draftbar-t { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; margin-right: auto; font-size: var(--fs-sec); font-weight: 600; color: var(--t1); }
.draftbar-t i { flex: none; align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.draftbar-t small { font-size: var(--fs-cap); font-weight: 400; color: var(--t2); }
.draftbar .btn { flex: none; height: 32px; }
.draftbar.ok { border-color: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft), 0 10px 24px -12px rgba(0, 0, 0, .35); }
.draftbar.ok .draftbar-t { color: var(--ok); }
.draftbar.ok .draftbar-t svg { align-self: center; width: 15px; height: 15px; }
/* 手机：避开底部导航 */
@media (max-width: 820px) { .draftbar { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); } }
</style>
