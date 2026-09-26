<script setup lang="ts">
// 观众菜单：设置专属、复制 UID、加入黑名单（总览实时动态、事件记录）
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { post } from '../lib/api.ts';
import { state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { Viewer } from '../lib/types.ts';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';
import IdTag from './IdTag.vue';

const props = defineProps<{ viewer: Viewer; x: number; y: number }>();
const emit = defineEmits<{ close: [] }>();
const el = ref<HTMLDivElement | null>(null);
const pos = ref({ left: props.x, top: props.y });
const isExcl = state.exclusives.some((x) => x.uid === props.viewer.uid);

function outside(e: MouseEvent): void {
  if (!el.value?.contains(e.target as Node)) emit('close');
}
onMounted(async () => {
  await nextTick();
  const w = el.value?.offsetWidth ?? 220;
  const h = el.value?.offsetHeight ?? 180;
  pos.value = { left: Math.min(props.x, innerWidth - w - 12), top: Math.min(props.y, innerHeight - h - 12) };
  addEventListener('mousedown', outside, true);
  addEventListener('scroll', () => emit('close'), { capture: true, once: true });
});
onBeforeUnmount(() => removeEventListener('mousedown', outside, true));

function exclusive(): void {
  ui.quick = { uid: props.viewer.uid, name: props.viewer.name, face: props.viewer.face, viewer: props.viewer };
  emit('close');
}
async function copy(): Promise<void> {
  emit('close');
  try {
    await navigator.clipboard.writeText(String(props.viewer.uid));
    toast(`已复制 UID ${props.viewer.uid}`);
  } catch {
    toast(`UID：${props.viewer.uid}`, 'info');
  }
}
async function block(): Promise<void> {
  emit('close');
  await attempt(() => post('/api/blacklist', { uid: props.viewer.uid, name: props.viewer.name }), `已把 ${props.viewer.name} 加入黑名单，TA 不会再触发特效`);
}
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="menu" role="menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <div class="mh">
        <Avatar :name="viewer.name" :face="viewer.face" />
        <div><b>{{ viewer.name }}</b><span class="num">UID {{ viewer.uid }}</span></div>
        <span style="margin-left: auto"><IdTag :viewer="viewer" /></span>
      </div>
      <button :disabled="viewer.uid <= 0" @click="exclusive"><Icon name="i-spark" />{{ isExcl ? '修改 TA 的专属特效' : '为 TA 设置专属特效' }}</button>
      <button :disabled="viewer.uid <= 0" @click="copy"><Icon name="i-copy" />复制 UID</button>
      <button :disabled="viewer.uid <= 0" @click="block"><Icon name="i-ban" />加入黑名单</button>
      <button disabled><Icon name="i-user" />查看观众档案<span class="soon">第二期</span></button>
    </div>
  </Teleport>
</template>
