<script setup lang="ts">
// 总览右侧面板「在线观众」：B 站高能榜（在线人数；名单只有这场投喂、点赞、发过弹幕的观众，按贡献排序），开着这一页时每 30 秒刷新
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PersonRow from './PersonRow.vue';
import Seg from './Seg.vue';
import { get } from '../lib/api.ts';
import { pageVisible, roleText, toViewer } from '../lib/audience.ts';
import { isOwnMedal } from '@starfall/shared';
import { state } from '../lib/store.ts';
import type { OnlineDto, Viewer } from '../lib/types.ts';

const emit = defineEmits<{ pick: [viewer: Viewer, x: number, y: number]; count: [n: number] }>();
const REFRESH_MS = 30_000;
const data = ref<OnlineDto | null>(null);
const error = ref('');
const loading = ref(false);
const filter = ref<'all' | 'guard' | 'fan'>('all');
let timer: ReturnType<typeof setInterval> | null = null;

const live = computed(() => Boolean(state.status?.live.live));
const anchorUid = computed(() => state.status?.room?.anchorUid);

async function load(): Promise<void> {
  if (!state.status?.room || loading.value) return;
  loading.value = true;
  try {
    data.value = await get<OnlineDto>('/api/online');
    error.value = '';
    if (data.value.live) emit('count', data.value.count);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => pageVisible() && void load(), REFRESH_MS);
});
onBeforeUnmount(() => timer && clearInterval(timer));
watch([live, () => state.status?.room?.roomId], () => void load());

const rows = computed(() =>
  (data.value?.items ?? [])
    .map((x) => ({ ...x, viewer: toViewer(x) }))
    .filter((x) => filter.value === 'all' || (filter.value === 'guard' ? x.guard > 0 : anchorUid.value !== undefined && isOwnMedal(x.viewer, anchorUid.value))),
);
</script>

<template>
  <div v-if="!state.status?.room" class="ov-qempty"><b>还没设置直播间</b>在设置里填好直播间号后显示</div>
  <div v-else-if="data && !data.live" class="ov-qempty"><b>开播后显示</b>在线观众来自 B 站的高能榜：这场投喂、点赞、发过弹幕的观众，按贡献排序</div>
  <template v-else>
    <div class="phead">
      <span v-if="data">在线 <b class="num">{{ data.count.toLocaleString('zh-CN') }}</b> 人 · 上榜 <b class="num">{{ data.items.length }}</b> 人 · 每 30 秒刷新</span>
      <span v-else>{{ error ? '' : '正在读取……' }}</span>
      <Seg v-model="filter" label="在线观众筛选" :options="[{ value: 'all', label: '全部' }, { value: 'guard', label: '大航海' }, { value: 'fan', label: '粉丝牌' }]" />
    </div>
    <div v-if="error" class="warnbox" style="margin-bottom: 10px">{{ error }}</div>
    <div class="plist">
      <PersonRow v-for="x in rows" :key="x.uid" :viewer="x.viewer" :rank="x.rank" :sub="roleText(x.viewer, anchorUid)" :value="`${x.score.toLocaleString('zh-CN')} 电池`" unit="贡献" @pick="(v, px, py) => emit('pick', v, px, py)" />
      <div v-if="data && !rows.length" class="pempty">{{ filter === 'all' ? '还没有人上榜：投喂、点赞、发弹幕的观众会出现在这里' : '没有符合的观众' }}</div>
    </div>
    <div class="pfoot">
      <span>B 站高能榜只列出这场投喂、点赞、发过弹幕的观众（B 站不提供完整的在线名单）</span>
      <span class="sp" /><span>点一行可设置专属特效</span>
    </div>
  </template>
</template>
