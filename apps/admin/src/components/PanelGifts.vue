<script setup lang="ts">
// 总览右侧面板「礼物榜」：这段时间（本场 / 今天，跟着总览的数据范围）每人花的钱：付费礼物 + 上舰 + 醒目留言
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PersonRow from './PersonRow.vue';
import { get } from '../lib/api.ts';
import { pageVisible } from '../lib/audience.ts';
import { onLiveEvent } from '../lib/live.ts';
import { state } from '../lib/store.ts';
import type { GiftRankDto, Viewer } from '../lib/types.ts';

const props = defineProps<{ scope: 'live' | 'today' }>();
const emit = defineEmits<{ pick: [viewer: Viewer, x: number, y: number] }>();
const data = ref<GiftRankDto | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  data.value = await get<GiftRankDto>(`/api/stats/gifts?scope=${props.scope}`).catch(() => data.value);
}
watch(() => [props.scope, state.status?.room?.roomId, state.status?.live.liveSince], () => void load());
// 有人送礼时稍后刷新（连击合并完才记录，不用每条都请求）
const off = onLiveEvent((e) => {
  if ((e.kind === 'gift' || e.kind === 'guard' || e.kind === 'sc') && !timer) timer = setTimeout(() => ((timer = null), void load()), 3000);
});
onMounted(() => {
  void load();
  poll = setInterval(() => pageVisible() && void load(), 60_000);
});
onBeforeUnmount(() => {
  off();
  if (timer) clearTimeout(timer);
  if (poll) clearInterval(poll);
});

const num = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
/** 1 电池 = 100 金瓜子，10 电池 = 1 元 */
const battery = (gold: number) => `${num(gold / 100)} 电池`;
const yuan = (gold: number) => `${num(gold / 1000)} 元`;
const rows = computed(() => data.value?.rows ?? []);
/** 一行说明：送了几次、最贵的一件，含上舰、醒目留言 */
function sub(r: GiftRankDto['rows'][number]): string {
  const parts: string[] = [];
  if (r.times) parts.push(`送了 ${r.times} 次${r.topGift ? ` · 最贵：${r.topGift}` : ''}`);
  if (r.guards) parts.push(`含上舰 ×${r.guards}`);
  if (r.scs) parts.push(`含醒目留言 ×${r.scs}`);
  return parts.join(' · ');
}
</script>

<template>
  <div v-if="!state.status?.room" class="ov-qempty"><b>还没设置直播间</b>在设置里填好直播间号后显示</div>
  <template v-else>
    <div class="phead">
      <span v-if="data">{{ scope === 'live' ? '本场' : '今天' }}送礼 <b class="num">{{ data.people }}</b> 人 · 合计 <b class="num">{{ battery(data.gold) }}</b>（{{ yuan(data.gold) }}）</span>
      <span v-else>正在读取……</span>
    </div>
    <div class="plist">
      <PersonRow v-for="(r, i) in rows" :key="r.uid" :viewer="r.viewer" :rank="i + 1" :sub="sub(r)" :value="battery(r.gold)" :unit="yuan(r.gold)" @pick="(v, px, py) => emit('pick', v, px, py)" />
      <div v-if="data && !rows.length" class="pempty">{{ scope === 'live' ? '这场' : '今天' }}还没有人送付费礼物、上舰或发醒目留言</div>
    </div>
    <div class="pfoot"><span>付费礼物（盲盒按开出的礼物算）+ 上舰（实付价格）+ 醒目留言，10 电池 = 1 元</span><span class="sp" /><span>本场 / 今天跟着上面的数据范围</span></div>
  </template>
</template>
