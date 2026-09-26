<script setup lang="ts">
// 预览小窗：点任意规则的 ▶ 弹出，用真实的特效页播放（只在这里播放，观众看不到）；可以发送到直播画面测试
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { post } from '../lib/api.ts';
import { route } from '../lib/route.ts';
import { effectById, ui } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import PreviewStage from './PreviewStage.vue';

const stage = ref<InstanceType<typeof PreviewStage> | null>(null);

function play(): void {
  const p = ui.preview;
  if (p?.effectId) void stage.value?.play(p.effectId, p.viewer, undefined, p.kind ?? 'enter', p.vars);
}
watch(() => ui.preview, () => void nextTick(play));
// 换了页面就关掉
watch(() => route.value.page, close);
function close(): void {
  ui.preview = null;
}
async function sendLive(): Promise<void> {
  if (!ui.preview?.effectId) return;
  await attempt(() => post('/api/playback/test', { effectId: ui.preview!.effectId }), '已发送到直播画面');
}
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
onMounted(() => {
  addEventListener('keydown', onKey);
  play();
});
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <div class="pv-scrim" @click.self="close">
    <div class="pv" role="dialog" aria-modal="true" :aria-label="`预览：${ui.preview?.label ?? ''}`">
      <div class="pv-h">
        <b>预览 · {{ effectById(ui.preview?.effectId)?.name ?? '' }}</b>
        <span>{{ ui.preview?.label }}</span>
        <button class="icon-btn" aria-label="关闭预览" @click="close"><Icon name="i-x" /></button>
      </div>
      <PreviewStage ref="stage" cls="pv-stage" label="直播画面" />
      <div class="pv-note">只在这里播放，观众看不到</div>
      <div class="pv-f">
        <button class="btn" @click="play"><Icon name="i-replay" />重播</button>
        <ConfirmButton label="发送到直播测试" confirm-label="确认？观众会看到" cls="btn live-send" armed-cls="btn live-send" @confirm="sendLive" />
      </div>
    </div>
  </div>
</template>
