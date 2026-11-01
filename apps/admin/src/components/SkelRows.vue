<script setup lang="ts">
// 一列占位行（头像 + 两行字 + 时间）：列表还没读到时用，不先说「还没有」
withDefaults(defineProps<{ n?: number }>(), { n: 6 });
</script>

<template>
  <div class="skel-rows" aria-hidden="true">
    <div v-for="i in n" :key="i" class="skel-row">
      <span class="skel round" style="width: 32px; height: 32px" />
      <div><span class="skel line" :style="{ width: `${36 + ((i * 17) % 30)}%` }" /><span class="skel line" :style="{ width: `${55 + ((i * 23) % 35)}%`, height: '10px' }" /></div>
      <span class="skel line" style="width: 48px; justify-self: end" />
    </div>
  </div>
</template>
