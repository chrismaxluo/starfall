<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
function flip(): void {
  // 先算好新值再发出去：赋值后 model.value 要等父组件重新渲染才变，马上读到的还是旧值
  const next = !model.value;
  model.value = next;
  emit('change', next);
}
</script>

<template>
  <button class="switch" role="switch" type="button" :aria-checked="model" :aria-label="label" :disabled="disabled" @click="flip" />
</template>
