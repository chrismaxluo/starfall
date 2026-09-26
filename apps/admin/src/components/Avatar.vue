<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ name: string; face?: string | null | undefined; size?: number }>();
const GRADS = ['#6E6BF2', '#E0689B', '#2FA6A0', '#E58B3A', '#5B8DEF', '#9A6BE0'];
const failed = ref(false);
watch(() => props.face, () => (failed.value = false));
const bg = computed(() => GRADS[[...(props.name || '?')].reduce((s, c) => s + c.charCodeAt(0), 0) % GRADS.length]);
const style = computed(() => ({ background: bg.value, ...(props.size ? { width: `${props.size}px`, height: `${props.size}px`, fontSize: `${Math.round(props.size * 0.42)}px` } : {}) }));
</script>

<template>
  <span class="avatar" :style="style">
    <img v-if="face && !failed" :src="face" alt="" referrerpolicy="no-referrer" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover" @error="failed = true" />
    <template v-else>{{ [...(name || '?')][0] }}</template>
  </span>
</template>
