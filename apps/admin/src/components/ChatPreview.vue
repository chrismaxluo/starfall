<script setup lang="ts">
// 弹幕列表预览：在 iframe 里运行真正的弹幕列表页面（预览模式，不连服务端），弹幕从后台的实时连接转过去。
// 「测试弹幕」只在这里显示，不上直播
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CHAT_WIDTH, chatHeight } from '@starfall/shared/overlay';
import type { ChatItem, OverlayConfig } from '@starfall/shared/overlay';
import { onChat } from '../lib/live.ts';
import { state } from '../lib/store.ts';

const props = defineProps<{ config: OverlayConfig; alpha?: boolean }>();
const frame = ref<HTMLIFrameElement | null>(null);
/** 按建议的浏览器源大小（600 宽，高度随条数、字号变）缩小显示，最高 520 */
const H = computed(() => chatHeight(props.config.chatMax, props.config.chatSize));
const K = computed(() => Math.min(0.5, 520 / H.value));
let ready = false;

function send(msg: unknown): void {
  if (ready) frame.value?.contentWindow?.postMessage(msg, location.origin);
}

function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || e.source !== frame.value?.contentWindow) return;
  if ((e.data as { type?: string })?.type !== 'starfall-preview-ready') return;
  ready = true;
  send({ type: 'hello', config: { ...props.config }, preload: [], build: null, chat: JSON.parse(JSON.stringify(state.chat)) });
}

watch(() => props.config, (c) => send({ type: 'config', config: { ...c } }), { deep: true });
const off = onChat((item) => send(item ? { type: 'chat', item: JSON.parse(JSON.stringify(item)) } : { type: 'chat_clear' }));

onMounted(() => addEventListener('message', onMessage));
onBeforeUnmount(() => {
  removeEventListener('message', onMessage);
  off();
});

let n = 0;
/** 预览里有没有弹幕（真实的或者测试的）：一条都没有时提示怎么看效果 */
const tested = ref(false);
const honor = (lv: number) => ({ level: lv, ...(state.honorMedals[lv] ? { url: state.honorMedals[lv] } : {}) });
/** 测试弹幕：编的观众，只在预览里显示 */
function test(kind: 'normal' | 'guard'): void {
  // 粉丝牌名字用最近弹幕里本直播间的牌子，没有时写「粉丝牌」
  const mn = state.chat.find((c) => c.viewer.medal?.own)?.viewer.medal?.name ?? '粉丝牌';
  const item: ChatItem =
    kind === 'guard'
      ? { id: `t${++n}`, ts: Date.now(), viewer: { uid: 0, name: '长夜未央', guard: 1, isMod: true, anchor: false, medal: { name: mn, level: 44, own: true }, honor: honor(68) }, text: '晚上好，来陪主播了' }
      : { id: `t${++n}`, ts: Date.now(), viewer: { uid: 0, name: '测试观众', guard: 0, isMod: false, anchor: false, medal: { name: mn, level: 12, own: true }, honor: honor(21) }, text: '这是一条测试弹幕，只在这里显示' };
  send({ type: 'chat', item });
  tested.value = true;
}
defineExpose({ test });
</script>

<template>
  <div class="chatpv" :class="{ alpha }" :style="{ width: `${CHAT_WIDTH * K}px`, height: `${H * K}px` }">
    <iframe ref="frame" src="/overlay/?preview=1&chat=1" title="弹幕列表预览" :style="{ width: `${CHAT_WIDTH}px`, height: `${H}px`, transform: `scale(${K})` }" />
    <div v-if="!config.chatEnabled" class="chatpv-off">弹幕列表已关闭</div>
    <div v-else-if="!state.chat.length && !tested" class="chatpv-empty">还没有弹幕<br />点下面的「测试弹幕」看看效果</div>
  </div>
</template>
