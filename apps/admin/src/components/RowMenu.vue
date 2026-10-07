<script lang="ts">
export interface MenuItem {
  icon: string;
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
// 规则表每行右边的「⋯」：不常用的操作（上下移动、删除、调整特效……）收在这里；删除都可以在提示里撤销
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { pushEsc } from '../lib/esc.ts';
import Icon from './Icon.vue';

defineProps<{ items: Array<MenuItem | null>; label: string }>();
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const open = ref(false);
const pos = ref({ right: 0, top: 0 });
let offEsc: (() => void) | null = null;

function close(): void {
  open.value = false;
  offEsc?.();
  offEsc = null;
  removeEventListener('mousedown', outside, true);
  removeEventListener('scroll', close, true);
}
function outside(e: MouseEvent): void {
  if (!pop.value?.contains(e.target as Node) && !btn.value?.contains(e.target as Node)) close();
}
async function toggle(): Promise<void> {
  if (open.value) return close();
  const r = btn.value!.getBoundingClientRect();
  pos.value = { right: Math.max(8, innerWidth - r.right), top: r.bottom + 4 };
  open.value = true;
  await nextTick();
  // 下面放不下就往上开
  const h = pop.value?.offsetHeight ?? 0;
  if (r.bottom + 4 + h > innerHeight - 8) pos.value = { ...pos.value, top: Math.max(8, r.top - h - 4) };
  addEventListener('mousedown', outside, true);
  addEventListener('scroll', close, true);
  offEsc = pushEsc(close);
}
function run(item: MenuItem): void {
  close();
  item.run();
}
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" type="button" class="icon-btn" :aria-label="label" :title="label" :aria-expanded="open" aria-haspopup="menu" @click.stop="toggle"><Icon name="i-more" /></button>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="rmenu" role="menu" :style="{ right: `${pos.right}px`, top: `${pos.top}px` }">
      <template v-for="(it, i) in items" :key="i">
        <hr v-if="!it" />
        <button v-else type="button" role="menuitem" :class="{ danger: it.danger }" :disabled="it.disabled" @click="run(it)"><Icon :name="it.icon" />{{ it.label }}</button>
      </template>
    </div>
  </Teleport>
</template>
