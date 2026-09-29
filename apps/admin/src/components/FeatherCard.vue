<script setup lang="ts">
// 设置 → 素材显示：全局上下羽化（只对没有透明通道的素材生效，素材里可以单独设置），右边用素材库里的视频演示
import { computed, ref, watch } from 'vue';
import { FEATHER_DEFAULT, FEATHER_MAX } from '@starfall/shared';
import { put } from '../lib/api.ts';
import { refreshSettings, state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import type { Settings } from '../lib/types.ts';
import Icon from './Icon.vue';
import PreviewStage from './PreviewStage.vue';
import Switch from './Switch.vue';

const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
const pct = ref(state.settings?.featherPct ?? FEATHER_DEFAULT);
watch(
  () => state.settings?.featherPct,
  (v) => v !== undefined && (pct.value = v),
);

/** 跟随全局、没有透明通道的素材（全局设置管的就是这些） */
const followers = computed(() => state.effects.filter((e) => !e.builtin && e.asset && !e.asset.hasAlpha && e.feather === 'global'));
/** 演示用的素材：优先用视频 */
const sample = computed(() => followers.value.find((e) => e.asset?.kind === 'video') ?? followers.value[0] ?? null);

function replay(): void {
  if (sample.value) void stage.value?.play(sample.value.id);
}
async function save(patch: Partial<Settings>, msg: string): Promise<void> {
  await attempt(() => put('/api/settings', patch), msg);
  await refreshSettings().catch(() => undefined);
}
async function toggle(on: boolean): Promise<void> {
  await save({ featherOn: on }, on ? `已打开上下羽化（${pct.value}%）` : '已关闭上下羽化');
  replay();
}
/** 拖滑块时直接改正在播放的演示，松手再保存 */
function onInput(): void {
  if (state.settings?.featherOn) stage.value?.feather(pct.value);
}
async function onChange(): Promise<void> {
  const v = Math.min(FEATHER_MAX, Math.max(0, Math.round(pct.value)));
  await save({ featherPct: v }, `上下羽化宽度：${v}%`);
  if (!stage.value?.feather(v)) replay();
}
// 素材列表可能还没加载好：有了演示素材再播
watch(
  () => sample.value?.id,
  (id) => id && setTimeout(replay, 300),
  { immediate: true },
);
</script>

<template>
  <div v-if="state.settings" class="card">
    <div class="card-h"><h2>素材显示</h2><span class="aside">对所有上传的素材生效，单个素材可以在素材设置里另外设置</span></div>
    <div class="fc">
      <div class="fc-set">
        <div class="toggle-line">视频上下羽化 <span class="hint">边缘慢慢变透明，不再一刀切</span><Switch v-model="state.settings.featherOn" label="视频上下羽化" @change="toggle" /></div>
        <div v-if="state.settings.featherOn" class="slider-row off"><label for="fcPct">羽化宽度</label><input id="fcPct" v-model.number="pct" type="range" min="0" :max="FEATHER_MAX" step="1" @input="onInput" @change="onChange" /><output>{{ pct }}%</output></div>
        <span class="hint">按素材高度算。只对没有透明通道的视频和图片生效（MP4、JPG 等）；透明 WebM 本身边缘就是透明的，不受影响。</span>
        <span class="hint">现在有 {{ followers.length }} 个素材跟随这里的设置。</span>
        <button v-if="sample" class="btn" type="button" style="align-self: flex-start" @click="replay"><Icon name="i-replay" />重播演示</button>
      </div>
      <PreviewStage v-if="sample" ref="stage" :label="`演示 · ${sample.name}`" :safe="false" />
      <div v-else class="fc-empty">上传一个 MP4 视频后，这里可以看到效果</div>
    </div>
  </div>
</template>
