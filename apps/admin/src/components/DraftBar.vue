<script setup lang="ts">
// 草稿条：有没保存的改动时贴在卡片底部（滚动时停在屏幕下沿），放弃 / 保存
defineProps<{ dirty: boolean; saving?: boolean }>();
defineEmits<{ save: []; discard: [] }>();
</script>

<template>
  <div v-if="dirty" class="draftbar" role="status">
    <span class="draftbar-t"><i />有改动还没保存<small>预览里是改后的样子，直播画面还是原来的</small></span>
    <button class="btn" type="button" :disabled="saving" @click="$emit('discard')">放弃</button>
    <button class="btn primary" type="button" :disabled="saving" @click="$emit('save')">{{ saving ? '保存中…' : '保存' }}</button>
  </div>
</template>

<style scoped>
.draftbar { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 10px 10px 14px; border-radius: var(--r-md);
  background: var(--l3); border: 1px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 10px 24px -12px rgba(0, 0, 0, .35); }
.draftbar-t { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; margin-right: auto; font-size: var(--fs-sec); font-weight: 600; color: var(--t1); }
.draftbar-t i { flex: none; align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.draftbar-t small { font-size: var(--fs-cap); font-weight: 400; color: var(--t2); }
.draftbar .btn { flex: none; height: 32px; }
/* 手机：避开底部导航 */
@media (max-width: 820px) { .draftbar { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); } }
</style>
