<script setup lang="ts">
// 需要确认的操作：点第一次变成"确认…"，4 秒内再点才执行
import { onBeforeUnmount, ref } from 'vue';

const props = defineProps<{ label: string; confirmLabel?: string; cls?: string; armedCls?: string; disabled?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const armed = ref(false);
let t: ReturnType<typeof setTimeout> | null = null;
function click(): void {
  if (!armed.value) {
    armed.value = true;
    t = setTimeout(() => (armed.value = false), 4000);
    return;
  }
  if (t) clearTimeout(t);
  armed.value = false;
  emit('confirm');
}
onBeforeUnmount(() => t && clearTimeout(t));
</script>

<template>
  <button type="button" :class="armed ? (props.armedCls ?? 'delb') : (props.cls ?? 'btn')" :disabled="disabled" @click="click">
    <slot v-if="!armed">{{ label }}</slot>
    <template v-else>{{ confirmLabel ?? `确认${label}` }}</template>
  </button>
</template>
