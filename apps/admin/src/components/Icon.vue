<script setup lang="ts">
// 图标：name 为 i-xxx 或 g-xxx（见 Sprite.vue）
defineProps<{ name: string }>();
</script>

<template>
  <svg class="i" aria-hidden="true"><use :href="`#${name}`" /></svg>
</template>
