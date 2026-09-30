<script setup lang="ts">
// 总览右侧面板「大航海」：这段时间来了哪些舰长、提督、总督（进场几次、最后一次什么时候），舰队名单里还有谁没来
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from './Avatar.vue';
import PersonRow from './PersonRow.vue';
import { get } from '../lib/api.ts';
import { GUARD_TEXT, pageVisible } from '../lib/audience.ts';
import { clock } from '../lib/format.ts';
import { onLiveEvent } from '../lib/live.ts';
import { state } from '../lib/store.ts';
import type { FleetDto, Viewer } from '../lib/types.ts';

const props = defineProps<{ scope: 'live' | 'today' }>();
const emit = defineEmits<{ pick: [viewer: Viewer, x: number, y: number]; summary: [came: number, total: number | null] }>();
const MISSING_SHOW = 40;
const data = ref<FleetDto | null>(null);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  data.value = await get<FleetDto>(`/api/stats/fleet?scope=${props.scope}`).catch(() => data.value);
  loading.value = false;
  if (data.value) emit('summary', data.value.came.length, data.value.fleet?.total ?? null);
}
watch(() => [props.scope, state.status?.room?.roomId, state.status?.live.liveSince], () => void load());
// 大航海进场时稍后刷新
const off = onLiveEvent((e) => {
  if (e.kind === 'enter' && Number((e.viewer as Viewer).guard) > 0 && !timer) timer = setTimeout(() => ((timer = null), void load()), 3000);
});
onMounted(() => {
  void load();
  poll = setInterval(() => pageVisible() && void load(), 5 * 60_000);
});
onBeforeUnmount(() => {
  off();
  if (timer) clearTimeout(timer);
  if (poll) clearInterval(poll);
});

const came = computed(() => data.value?.came ?? []);
const fleet = computed(() => data.value?.fleet ?? null);
const cameIds = computed(() => new Set(came.value.map((c) => c.uid)));
const missing = computed(() => (fleet.value?.members ?? []).filter((m) => !cameIds.value.has(m.uid)));
/** 舰队名单读全了才分等级数（人特别多时只读了前面一部分） */
const levels = computed(() => {
  const f = fleet.value;
  if (!f || f.members.length < f.total) return '';
  const n = (g: number) => f.members.filter((m) => m.guard === g).length;
  return [1, 2, 3].filter((g) => n(g)).map((g) => `${GUARD_TEXT[g]} ${n(g)}`).join(' · ');
});
const pct = computed(() => (fleet.value?.total ? Math.min(100, Math.round((came.value.length / fleet.value.total) * 100)) : 0));
const asViewer = (m: { uid: number; name: string; face: string; guard: number }): Viewer => ({ uid: m.uid, name: m.name, ...(m.face ? { face: m.face } : {}), guard: m.guard as Viewer['guard'], isMod: false, mystery: false });
const where = computed(() => (props.scope === 'live' ? '本场' : '今天'));
</script>

<template>
  <div v-if="!state.status?.room" class="ov-qempty"><b>还没设置直播间</b>在设置里填好直播间号后显示</div>
  <template v-else>
    <div class="fleet">
      <span class="ring" :style="{ '--p': pct }"><span class="num">{{ fleet ? `${pct}%` : '—' }}</span></span>
      <div>
        <b v-if="fleet">舰队 {{ fleet.total }} 人，{{ where }}来了 {{ came.length }} 人</b>
        <b v-else>{{ where }}来了 {{ came.length }} 位大航海</b>
        <small v-if="fleet">{{ levels ? `${levels}（来自 B 站的大航海名单）` : '来自 B 站的大航海名单' }}</small>
        <small v-else-if="data?.fleetError">舰队名单暂时读不到：{{ data.fleetError }}</small>
        <small v-else>正在读取舰队名单……</small>
      </div>
    </div>
    <div class="plist" style="max-height: 220px">
      <PersonRow v-for="c in came" :key="c.uid" :viewer="c.viewer" :sub="`${GUARD_TEXT[c.viewer.guard] ?? '大航海'} · 最后一次 ${clock(c.lastTs).slice(0, 5)}`" :value="String(c.times)" unit="次进场" @pick="(v, px, py) => emit('pick', v, px, py)" />
      <div v-if="data && !came.length" class="pempty">{{ where }}还没有大航海进场</div>
    </div>
    <details v-if="missing.length" class="missing">
      <summary>还没来的 {{ fleet && fleet.members.length < fleet.total ? `${fleet.total - came.length} 人（名单只读了前 ${fleet.members.length} 人）` : `${missing.length} 人` }}（点开看）</summary>
      <div class="chips">
        <button v-for="m in missing.slice(0, MISSING_SHOW)" :key="m.uid" type="button" @click="(e) => emit('pick', asViewer(m), e.clientX, e.clientY)"><Avatar :name="m.name" :face="m.face" :guard="m.guard" />{{ m.name }}</button>
        <span v-if="missing.length > MISSING_SHOW">… 还有 {{ missing.length - MISSING_SHOW }} 人</span>
      </div>
    </details>
  </template>
</template>
