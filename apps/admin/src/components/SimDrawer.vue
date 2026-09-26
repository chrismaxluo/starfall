<script setup lang="ts">
// 模拟一下：假装发生一件事，看会用哪条规则、播放什么（不真的播放，也不记录）
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ui } from '../lib/store.ts';
import type { TriggerKind } from '../lib/types.ts';
import Icon from './Icon.vue';
import Seg from './Seg.vue';
import Simulate from './Simulate.vue';

const props = defineProps<{ kind: TriggerKind }>();
const emit = defineEmits<{ close: [] }>();
const kind = ref<TriggerKind>(props.kind);
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !ui.preview && emit('close');
onMounted(() => addEventListener('keydown', onKey));
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="drawer-scrim" @click="emit('close')" />
    <aside class="drawer sim-drawer" role="dialog" aria-modal="true" aria-label="模拟一下">
      <div class="drawer-h">
        <div><h2>模拟一下</h2><div class="sub">假装发生一件事，看会用哪条规则、播放什么。不会真的播放，也不记录</div></div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button>
      </div>
      <div class="drawer-b">
        <div class="field"><span class="sim-lbl">发生了什么</span>
          <Seg v-model="kind" label="事件" :options="[{ value: 'enter', label: '进场' }, { value: 'danmu', label: '弹幕' }, { value: 'gift', label: '送礼' }, { value: 'guard', label: '上舰' }]" />
        </div>
        <Simulate :key="kind" :kind="kind" @preview="(p) => (ui.preview = p)" />
      </div>
    </aside>
  </Teleport>
</template>
