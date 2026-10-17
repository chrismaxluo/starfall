<script setup lang="ts">
// 送礼名单预览：在 iframe 里运行真正的送礼名单页面（预览模式，不连服务端），礼物从后台的实时连接转过去。
// 「测试」只在这里显示，不上直播
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GIFTS_WIDTH, giftsHeight, giftsView } from '@starfall/shared/overlay';
import type { GiftListItem, GiftRankRow, OverlayConfig } from '@starfall/shared/overlay';
import { onGiftRow } from '../lib/live.ts';
import { state } from '../lib/store.ts';

const props = defineProps<{ config: OverlayConfig; alpha?: boolean }>();
const frame = ref<HTMLIFrameElement | null>(null);
/** 按建议的浏览器源大小（640 宽，高度随条数、字号变）缩小显示，最高 520 */
const H = computed(() => giftsHeight(props.config.giftsMax, props.config.giftsSize, Boolean(props.config.giftsTitle)));
/** 这个输出现在的名单 */
const board = computed(() => state.giftBoards[props.config.outputId] ?? []);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const K = computed(() => Math.min(0.5, 520 / H.value));
let ready = false;

function send(msg: unknown): void {
  if (ready) frame.value?.contentWindow?.postMessage(msg, location.origin);
}

function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || e.source !== frame.value?.contentWindow) return;
  if ((e.data as { type?: string })?.type !== 'starfall-preview-ready') return;
  ready = true;
  send({ type: 'hello', config: clone(props.config), preload: [], build: null, gifts: clone(board.value), pins: clone(state.giftPins) });
}

watch(() => props.config, (c) => send({ type: 'config', config: clone(c) }), { deep: true });
const off = onGiftRow((id, row) => {
  if (id === props.config.outputId) send(row ? { type: 'gift_row', row: clone(row) } : { type: 'gifts_set', rows: clone(board.value) });
});
// 挂上的记录变了：整份发过去
watch(() => state.giftPins, (items) => send({ type: 'gift_pins', items: clone(items) }), { deep: true });

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
/** 按人合计时的测试：几位观众轮流送，总数往上涨、名次会变 */
const RANK_SAMPLES: Array<Omit<GiftRankRow, 'id' | 'ts' | 'value' | 'times'> & { step: number }> = [
  { kind: 'viewer', viewer: { name: '测试观众', guard: 0 }, scs: 0, top: { name: '送花花', img: W('a9945884c0a7c0cac33192a38624086cb69a84d4'), price: 1000 }, step: 20_000 },
  { kind: 'viewer', viewer: { name: '长夜未央', guard: 3 }, scs: 0, guard: 3, step: 198_000 },
  { kind: 'viewer', viewer: { name: '路过的猫', guard: 0 }, scs: 1, step: 30_000 },
  { kind: 'viewer', viewer: { name: '晚风与星河漫步', guard: 1 }, scs: 0, top: { name: '极速超跑', img: W('cb1f5d7663a2a3edb2012263b70282c6e5001953'), price: 100_000 }, step: 100_000 },
];
const rankTotals = new Map<number, number>();
let n = 0;
/** 预览里有没有内容（真实的或者测试的）：一条都没有时提示怎么看效果 */
const tested = ref(false);
function test(): void {
  const i = n % SAMPLES.length;
  n++;
  if (giftsView(props.config.giftsFilter) === 'viewer') {
    const { step, ...s } = RANK_SAMPLES[i]!;
    const times = (rankTotals.get(i) ?? 0) + 1;
    rankTotals.set(i, times);
    send({ type: 'gift_row', row: { ...s, id: `tv${i}`, ts: Date.now(), value: step * times, times: s.scs ? 0 : times } });
  } else send({ type: 'gift_row', row: { ...SAMPLES[i]!, id: `t${n}`, ts: Date.now() } });
  tested.value = true;
}
defineExpose({ test });
</script>

<template>
  <div class="chatpv" :class="{ alpha }" :style="{ width: `${GIFTS_WIDTH * K}px`, height: `${H * K}px` }">
    <iframe ref="frame" src="/overlay/?preview=1&gifts=1" title="送礼名单预览" :style="{ width: `${GIFTS_WIDTH}px`, height: `${H}px`, transform: `scale(${K})` }" />
    <div v-if="!config.giftsEnabled" class="chatpv-off">送礼名单已关闭</div>
    <div v-else-if="config.giftsFilter.mode === 'pinned' && !state.giftPins.length" class="chatpv-empty">名单是空的<br />在下面的送礼记录里点「加入名单」</div>
    <div v-else-if="config.giftsFilter.mode !== 'pinned' && !board.length && !tested && !(config.giftsFilter.pinTop && state.giftPins.length)" class="chatpv-empty">这段时间还没有收到礼物<br />点下面的「测试」看看效果</div>
  </div>
</template>
