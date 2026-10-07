<script setup lang="ts">
// 送礼名单预览：在 iframe 里运行真正的送礼名单页面（预览模式，不连服务端），礼物从后台的实时连接转过去。
// 「测试」只在这里显示，不上直播
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GIFTS_WIDTH, giftsHeight } from '@starfall/shared/overlay';
import type { GiftListItem, OverlayConfig } from '@starfall/shared/overlay';
import { onGiftItem } from '../lib/live.ts';
import { state } from '../lib/store.ts';

const props = defineProps<{ config: OverlayConfig; alpha?: boolean }>();
const frame = ref<HTMLIFrameElement | null>(null);
/** 按建议的浏览器源大小（640 宽，高度随条数、字号变）缩小显示，最高 520 */
const H = computed(() => giftsHeight(props.config.giftsMax, props.config.giftsSize));
const K = computed(() => Math.min(0.5, 520 / H.value));
let ready = false;

function send(msg: unknown): void {
  if (ready) frame.value?.contentWindow?.postMessage(msg, location.origin);
}

function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || e.source !== frame.value?.contentWindow) return;
  if ((e.data as { type?: string })?.type !== 'starfall-preview-ready') return;
  ready = true;
  send({ type: 'hello', config: JSON.parse(JSON.stringify(props.config)), preload: [], build: null, gifts: JSON.parse(JSON.stringify(state.gifts)) });
}

watch(() => props.config, (c) => send({ type: 'config', config: JSON.parse(JSON.stringify(c)) }), { deep: true });
const off = onGiftItem((item) => send(item ? { type: 'gift_item', item: JSON.parse(JSON.stringify(item)) } : { type: 'gifts_clear' }));

onMounted(() => addEventListener('message', onMessage));
onBeforeUnmount(() => {
  removeEventListener('message', onMessage);
  off();
});

/** 测试用的几条：礼物图用直播间礼物面板里的真礼物（读不到时没有图） */
const W = (u: string) => `https://i0.hdslb.com/bfs/live/${u}.webp`;
const SAMPLES: Array<Omit<GiftListItem, 'id' | 'ts'>> = [
  { kind: 'gift', viewer: { name: '测试观众', guard: 0 }, value: 20_000, gift: { id: 31037, name: '送花花', count: 20, img: W('a9945884c0a7c0cac33192a38624086cb69a84d4') } },
  { kind: 'guard', viewer: { name: '长夜未央', guard: 3 }, value: 198_000, guard: { level: 3, months: 1, op: 'open' } },
  { kind: 'sc', viewer: { name: '路过的猫', guard: 0 }, value: 30_000, sc: { text: '这是一条测试醒目留言，只在这里显示', price: 30 } },
  { kind: 'gift', viewer: { name: '晚风与星河漫步', guard: 1 }, value: 100_000, gift: { id: 32089, name: '极速超跑', count: 1, img: W('cb1f5d7663a2a3edb2012263b70282c6e5001953') } },
];
let n = 0;
/** 预览里有没有内容（真实的或者测试的）：一条都没有时提示怎么看效果 */
const tested = ref(false);
function test(): void {
  const s = SAMPLES[n % SAMPLES.length]!;
  n++;
  send({ type: 'gift_item', item: { ...s, id: `t${n}`, ts: Date.now() } });
  tested.value = true;
}
defineExpose({ test });
</script>

<template>
  <div class="chatpv" :class="{ alpha }" :style="{ width: `${GIFTS_WIDTH * K}px`, height: `${H * K}px` }">
    <iframe ref="frame" src="/overlay/?preview=1&gifts=1" title="送礼名单预览" :style="{ width: `${GIFTS_WIDTH}px`, height: `${H}px`, transform: `scale(${K})` }" />
    <div v-if="!config.giftsEnabled" class="chatpv-off">送礼名单已关闭</div>
    <div v-else-if="!state.gifts.length && !tested" class="chatpv-empty">本场还没有收到礼物<br />点下面的「测试」看看效果</div>
  </div>
</template>
