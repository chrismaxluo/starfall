<script setup lang="ts">
// 荣耀等级勋章：用 B站的图（每级一张，数字画在图上）；读不到图时显示文字
import { computed, ref, watch } from 'vue';
import { state } from '../lib/store.ts';

const props = defineProps<{ level?: number | null | undefined }>();
const url = computed(() => (props.level ? state.honorMedals[props.level] : undefined));
const broken = ref(false);
watch(url, () => (broken.value = false));
</script>

<template>
  <template v-if="level && level > 0">
    <img v-if="url && !broken" class="honor" :src="url" :alt="`荣耀等级 ${level}`" :title="`荣耀等级 ${level}`" referrerpolicy="no-referrer" @error="broken = true" />
    <i v-else class="honor honor-txt" :title="`荣耀等级 ${level}`">荣耀 {{ level }}</i>
  </template>
</template>
