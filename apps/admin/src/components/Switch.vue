<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
function flip(): void {
  model.value = !model.value;
  emit('change', model.value);
}
</script>

<template>
  <button class="switch" role="switch" type="button" :aria-checked="model" :aria-label="label" :disabled="disabled" @click="flip" />
</template>
