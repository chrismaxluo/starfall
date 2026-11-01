<script setup lang="ts">
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
import { quietNext } from '../lib/toast.ts';

const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
// 拨了马上保存的开关（有 @change）：保存成功的提示不弹在右下角，在开关上方轻轻说一声「已保存」
const saves = Boolean(getCurrentInstance()?.vnode.props?.onChange);
const saved = ref(0);
let t: ReturnType<typeof setTimeout> | null = null;
function showSaved(): void {
  saved.value++;
  if (t) clearTimeout(t);
  t = setTimeout(() => (saved.value = 0), 1600);
}
onBeforeUnmount(() => t && clearTimeout(t));
function flip(): void {
  // 先算好新值再发出去：赋值后 model.value 要等父组件重新渲染才变，马上读到的还是旧值
  const next = !model.value;
  model.value = next;
  if (saves) quietNext(showSaved);
  emit('change', next);
}
</script>

<template>
  <button class="switch" role="switch" type="button" :aria-checked="model" :aria-label="label" :disabled="disabled" @click="flip">
    <span v-if="saved" :key="saved" class="sw-ok" role="status"><Icon name="i-check" />已保存</span>
  </button>
</template>
