<script setup lang="ts">
// 总览右侧面板「播放队列」：正在播的、排队的、排队设置
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import EvIcon from './EvIcon.vue';
import Icon from './Icon.vue';
import Switch from './Switch.vue';
import { del, post, put } from '../lib/api.ts';
import { refreshSettings, state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';

const PLAY_GAP_MS = 300;
const Q_SHOW = 5;
const now = ref(Date.now());
const showQueueSet = ref(false);
let tick: ReturnType<typeof setInterval> | null = null;
onMounted(() => (tick = setInterval(() => (now.value = Date.now()), 1000)));
onBeforeUnmount(() => tick && clearInterval(tick));

const playing = computed(() => state.queue.playing);
const left = computed(() => (playing.value ? Math.max(0, playing.value.startedAt + playing.value.durationMs - now.value) : 0));
const progress = computed(() => (playing.value ? Math.min(100, ((now.value - playing.value.startedAt) / playing.value.durationMs) * 100) : 0));
/** 每一项大约多久后开始播 */
const upcoming = computed(() => {
  let t = playing.value ? left.value + PLAY_GAP_MS : 0;
  return state.queue.items.map((q) => {
    const eta = t;
    t += q.durationMs + PLAY_GAP_MS;
    return { ...q, eta };
  });
});
const eta = (ms: number) => (ms < 1000 ? '马上' : `约 ${Math.round(ms / 1000)} 秒后`);
async function skip(): Promise<void> {
  await attempt(() => post('/api/playback/skip'), '已跳过，开始播下一个');
}
async function clearQueue(): Promise<void> {
  await attempt(() => post<{ cleared: number }>('/api/playback/clear'), '已清空排队');
}
async function removeItem(id: string, name: string): Promise<void> {
  await attempt(() => del(`/api/playback/queue/${encodeURIComponent(id)}`), `已移出队列：${name}，这次不播放`);
}
async function saveSetting(patch: object, msg: string): Promise<void> {
  // 成功失败都重新读取：失败时开关要回到原来的状态
  await attempt(() => put('/api/settings', patch), msg);
  await refreshSettings().catch(() => undefined);
}
</script>

<template>
  <div v-if="playing" class="ov-now">
    <Avatar :name="playing.viewerName" :face="playing.viewerFace" :guard="playing.viewerGuard" />
    <div style="min-width: 0">
      <b>{{ playing.viewerName }}</b>
      <div class="what"><EvIcon v-if="playing.kind !== 'enter'" :kind="playing.kind" :img="playing.giftImg" />{{ playing.detail }} · 播放 <b>{{ playing.effectName }}</b></div>
    </div>
    <span class="left num">还剩 {{ (left / 1000).toFixed(1) }} 秒</span>
    <div class="bar"><i :style="{ width: `${progress}%` }" /></div>
  </div>
  <div v-if="upcoming.length" class="ov-q">
    <div v-for="(q, i) in upcoming.slice(0, Q_SHOW)" :key="q.id" class="qrow">
      <span class="n num">{{ i + 1 }}</span>
      <Avatar :name="q.viewerName" :face="q.viewerFace" :guard="q.viewerGuard" />
      <span class="who"><b>{{ q.viewerName }}</b><span><EvIcon v-if="q.kind !== 'enter'" :kind="q.kind" :img="q.giftImg" />{{ q.detail }} · {{ q.effectName }}</span></span>
      <span class="eta num">{{ eta(q.eta) }}</span>
      <button class="x" :aria-label="`把 ${q.viewerName} 移出队列`" title="移出队列（这次不播）" @click="removeItem(q.id, q.viewerName)"><Icon name="i-x" /></button>
    </div>
  </div>
  <div v-if="!playing && !upcoming.length" class="ov-qempty"><b>现在没有排队</b>观众进场、送礼时会出现在这里，按顺序一个一个播放</div>
  <div class="ov-qfoot">
    <span v-if="upcoming.length > Q_SHOW">后面还有 <b class="num">{{ upcoming.length - Q_SHOW }}</b> 条</span>
    <button class="linkish" :aria-expanded="showQueueSet" @click="showQueueSet = !showQueueSet">排队设置</button>
    <span class="sp" />
    <button v-if="playing" class="btn" @click="skip">跳过当前</button>
    <ConfirmButton v-if="upcoming.length" label="清空排队" confirm-label="确认清空" cls="btn" @confirm="clearQueue" />
  </div>
  <div v-if="showQueueSet && state.settings" class="ov-qset">
    <div class="toggle-line">高价值插队 <span class="hint">上舰和 1000 电池（100 元）以上的礼物排到最前面</span>
      <Switch v-model="state.settings.queueJump" label="高价值插队" @change="(v) => saveSetting({ queueJump: v }, v ? '已开启高价值插队' : '已关闭高价值插队')" />
    </div>
    <div class="slider-row">
      <label for="qMax">最多排队</label>
      <input id="qMax" v-model.number="state.settings.queueMax" type="range" min="3" max="30" @change="saveSetting({ queueMax: state.settings!.queueMax }, `最多排队 ${state.settings!.queueMax} 条`)" />
      <output>{{ state.settings.queueMax }} 条</output>
    </div>
    <span class="hint">播放顺序：上舰 → 礼物 → 进场 → 弹幕。排满后，先挤掉顺序最靠后、最早进来的一条。</span>
  </div>
</template>
