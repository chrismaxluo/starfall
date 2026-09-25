<script setup lang="ts">
import { computed } from 'vue';
import { medalColors } from '../lib/identity.ts';

const props = defineProps<{ name?: string; level: number; colors?: { bg: string; level: string; border: string; text: string } | undefined; guard?: boolean }>();
const c = computed(() => props.colors ?? medalColors(props.level, props.guard));
</script>

<template>
  <span class="medal" :style="{ '--mc': c.bg, '--ml': c.level, '--mb': c.border, color: c.text }"><span>{{ name || '粉丝牌' }}</span><b>{{ level }}</b></span>
</template>
