<script setup lang="ts" generic="T extends string | number">
const model = defineModel<T>({ required: true });
defineProps<{ options: Array<{ value: T; label: string; disabled?: boolean }>; label: string }>();
const emit = defineEmits<{ change: [value: T] }>();
function pick(v: T): void {
  if (v === model.value) return;
  model.value = v;
  emit('change', v);
}
</script>

<template>
  <div class="seg" role="group" :aria-label="label">
    <button v-for="o in options" :key="String(o.value)" type="button" :aria-pressed="o.value === model" :disabled="o.disabled" @click="pick(o.value)">
      <slot :name="`opt-${o.value}`">{{ o.label }}</slot>
    </button>
  </div>
</template>
