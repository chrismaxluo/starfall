<script setup lang="ts">
// 「ⓘ」小提示：较长的解释收在这里，鼠标停上去（或用键盘选中）才显示，页面上不再常驻一行行灰字
import Icon from './Icon.vue';

defineProps<{ text: string }>();
</script>

<template>
  <span class="tip" tabindex="0" role="note" :aria-label="text"><Icon name="i-info" /><span class="tip-b" aria-hidden="true">{{ text }}</span></span>
</template>
