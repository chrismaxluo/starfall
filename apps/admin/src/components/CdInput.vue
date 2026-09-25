<script setup lang="ts">
// 冷却分钟输入框：改完（失去焦点或回车）才触发 change
const model = defineModel<number>({ required: true });
const emit = defineEmits<{ change: [value: number] }>();
function commit(e: Event): void {
  const el = e.target as HTMLInputElement;
  const v = Math.max(0, Math.min(1440, Math.round(Number(el.value) || 0)));
  el.value = String(v);
  if (v === model.value) return;
  model.value = v;
  emit('change', v);
}
</script>

<template>
  <span class="cdin"><input type="number" min="0" max="1440" :value="model" aria-label="冷却分钟" @change="commit" /><span>分钟</span></span>
</template>
