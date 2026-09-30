<script setup lang="ts">
// 总览右侧名单的一行：排名、头像（大航海套头像框）、昵称和一行说明、荣耀勋章和身份、右边的数值
import Avatar from './Avatar.vue';
import HonorMedal from './HonorMedal.vue';
import IdTag from './IdTag.vue';
import type { Viewer } from '../lib/types.ts';

defineProps<{ viewer: Viewer; rank?: number | undefined; sub?: string; value?: string; unit?: string }>();
const emit = defineEmits<{ pick: [viewer: Viewer, x: number, y: number] }>();
</script>

<template>
  <div class="prow" :class="{ norank: rank === undefined }" role="button" tabindex="0" @click="(e) => emit('pick', viewer, e.clientX, e.clientY)" @keydown.enter="(e) => emit('pick', viewer, (e.target as HTMLElement).getBoundingClientRect().left + 40, (e.target as HTMLElement).getBoundingClientRect().bottom)">
    <span v-if="rank !== undefined" class="n" :class="rank <= 3 ? `rk r${rank}` : ''">{{ rank }}</span>
    <Avatar :name="viewer.name" :face="viewer.face" :guard="viewer.guard" />
    <span class="who"><b>{{ viewer.name || `UID ${viewer.uid}` }}</b><span v-if="sub">{{ sub }}</span></span>
    <span class="ids"><HonorMedal :level="viewer.honor" /><IdTag :viewer="viewer" /></span>
    <span v-if="value !== undefined" class="sc num">{{ value }}<small v-if="unit">{{ unit }}</small></span>
  </div>
</template>
