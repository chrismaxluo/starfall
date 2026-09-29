<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { GUARD_FRAMES } from '@starfall/shared/overlay';

/** guard：大航海等级（1 总督、2 提督、3 舰长），有的话套上 B 站的头像框 */
const props = defineProps<{ name: string; face?: string | null | undefined; size?: number; guard?: number | null | undefined }>();
const GRADS = ['#6E6BF2', '#E0689B', '#2FA6A0', '#E58B3A', '#5B8DEF', '#9A6BE0'];
const failed = ref(false);
const frameFailed = ref(false);
watch(() => props.face, () => (failed.value = false));
watch(() => props.guard, () => (frameFailed.value = false));
const bg = computed(() => GRADS[[...(props.name || '?')].reduce((s, c) => s + c.charCodeAt(0), 0) % GRADS.length]);
const style = computed(() => ({ background: bg.value, ...(props.size ? { width: `${props.size}px`, height: `${props.size}px`, fontSize: `${Math.round(props.size * 0.42)}px` } : {}) }));
/** 后台里的头像都不大：用 B 站的缩略图，省流量 */
const frame = computed(() => {
  const url = props.guard ? GUARD_FRAMES[props.guard as 1 | 2 | 3] : undefined;
  return url && !frameFailed.value ? `${url}@120w_120h.webp` : null;
});
</script>

<template>
  <span class="avatar" :class="{ framed: frame }" :style="style">
    <img v-if="face && !failed" :src="face" alt="" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover" @error="failed = true" />
    <template v-else>{{ [...(name || '?')][0] }}</template>
    <img v-if="frame" class="av-frame" :src="frame" alt="" referrerpolicy="no-referrer" @error="frameFailed = true" />
  </span>
</template>
