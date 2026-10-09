<script setup lang="ts">
// 礼物面板读不到时的提示：还没填直播间号 → 去设置；其他原因 → 显示原因，可以重试
defineProps<{ error: string; noRoom: boolean; loading: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <span class="hint gc-err" role="status">
    <template v-if="noRoom">还没填直播间号，读不到礼物面板。<a class="linkish" href="#settings">去设置 →</a></template>
    <template v-else>读取礼物面板失败：{{ error }}<button class="linkish" type="button" :disabled="loading" @click="$emit('retry')">{{ loading ? '正在重试…' : '重试' }}</button></template>
  </span>
</template>

<style scoped>
.gc-err { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--t2); }
.gc-err button.linkish { cursor: pointer; }
</style>
