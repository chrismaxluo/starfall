<script setup lang="ts">
// 总览右侧的切换面板：播放队列、在线观众、礼物榜、大航海。选过的标签记在这台电脑的浏览器里；有特效在播时不自动切换
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import PanelFleet from './PanelFleet.vue';
import PanelGifts from './PanelGifts.vue';
import PanelOnline from './PanelOnline.vue';
import PanelQueue from './PanelQueue.vue';
import { state } from '../lib/store.ts';
import type { Viewer } from '../lib/types.ts';

type Tab = 'queue' | 'online' | 'gift' | 'fleet';
const props = defineProps<{ scope: 'live' | 'today'; guardCame?: number | undefined }>();
const emit = defineEmits<{ pick: [viewer: Viewer, x: number, y: number] }>();
const KEY = 'sf-ov-tab';
const read = (): Tab => {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'online' || t === 'gift' || t === 'fleet' ? t : 'queue';
  } catch {
    return 'queue';
  }
};
const tab = ref<Tab>(read());
watch(tab, (t) => {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* 浏览器不让存就算了 */
  }
});

const queueSize = computed(() => (state.queue.playing ? 1 : 0) + state.queue.items.length);
const live = computed(() => Boolean(state.status?.live.live));
/** 在线人数：打开过「在线观众」用名单里的；否则用直播间信息里的高能榜人数 */
const onlineCount = ref<number | null>(null);
const online = computed(() => (live.value ? (onlineCount.value ?? state.roomInfo?.rankCount ?? null) : null));
const fleetTotal = ref<number | null>(null);
const fleetCame = ref<number | null>(null);
const came = computed(() => props.guardCame ?? fleetCame.value ?? null);

const TABS: Array<{ k: Tab; icon: string; name: string }> = [
  { k: 'queue', icon: 'i-queue', name: '播放队列' },
  { k: 'online', icon: 'i-users', name: '在线观众' },
  { k: 'gift', icon: 'i-trophy', name: '礼物榜' },
  { k: 'fleet', icon: 'i-anchor', name: '大航海' },
];
const pick = (v: Viewer, x: number, y: number) => emit('pick', v, x, y);
</script>

<template>
  <div class="ptabs" role="tablist" aria-label="总览右侧面板">
    <button v-for="t in TABS" :key="t.k" type="button" role="tab" :aria-selected="tab === t.k" @click="tab = t.k">
      <Icon :name="t.icon" />{{ t.name }}
      <template v-if="t.k === 'queue'"><span v-if="queueSize" class="dot" :class="{ play: state.queue.playing }" :title="state.queue.playing ? '正在播放' : '排队中'">{{ queueSize }}</span><span v-else class="cnt">空闲</span></template>
      <span v-else-if="t.k === 'online' && online !== null" class="cnt">{{ online.toLocaleString('zh-CN') }}</span>
      <span v-else-if="t.k === 'fleet' && came !== null" class="cnt">{{ fleetTotal !== null ? `${came}/${fleetTotal}` : came }}</span>
    </button>
  </div>
  <div class="pbody" role="tabpanel">
    <PanelQueue v-if="tab === 'queue'" />
    <PanelOnline v-else-if="tab === 'online'" @pick="pick" @count="(n) => (onlineCount = n)" />
    <PanelGifts v-else-if="tab === 'gift'" :scope="scope" @pick="pick" />
    <PanelFleet v-else :scope="scope" @pick="pick" @summary="(c, t) => ((fleetCame = c), (fleetTotal = t))" />
  </div>
</template>
