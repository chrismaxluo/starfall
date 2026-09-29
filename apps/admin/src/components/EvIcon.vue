<script setup lang="ts">
// 事件类型小图标：礼物有官方礼物图时显示礼物图（加载失败退回「礼」字）
import { ref, watch } from 'vue';
import { EV_ICON } from '../lib/events.ts';
import type { TriggerKind } from '../lib/types.ts';

const props = defineProps<{ kind: TriggerKind; img?: string | null }>();
const broken = ref(false);
watch(() => props.img, () => (broken.value = false));
</script>

<template>
  <img v-if="kind === 'gift' && img && !broken" class="ev gimg" :src="img" alt="" referrerpolicy="no-referrer" @error="broken = true" />
  <span v-else class="ev" :style="{ background: EV_ICON[kind].bg }">{{ EV_ICON[kind].text }}</span>
</template>
