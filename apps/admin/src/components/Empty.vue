<script setup lang="ts">
// 空状态：图标 + 一句话 +（可选）一行说明和下一步按钮。列表、面板、页面里没有内容时都用这个，样子统一
import Icon from './Icon.vue';

defineProps<{ icon?: string; title: string; desc?: string; compact?: boolean }>();
</script>

<template>
  <div class="empty-st" :class="{ compact }">
    <span class="es-ic"><Icon :name="icon ?? 'i-spark'" /></span>
    <b>{{ title }}</b>
    <span v-if="desc" class="es-d">{{ desc }}</span>
    <div v-if="$slots.default" class="es-act"><slot /></div>
  </div>
</template>
