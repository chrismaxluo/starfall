<script setup lang="ts">
import EvIcon from '../components/EvIcon.vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import Seg from '../components/Seg.vue';
import { get } from '../lib/api.ts';
import { describe, statusCls, statusText } from '../lib/events.ts';
import { dateTime } from '../lib/format.ts';
import { onLiveEvent, onLiveEventStatus, onResync } from '../lib/live.ts';
import { effectById, state } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import type { EventDto, Viewer } from '../lib/types.ts';

type Kind = 'all' | EventDto['kind'];
const kind = ref<Kind>('all');
const q = ref('');
const st = ref<'all' | 'played' | 'skip'>('all');
const rows = ref<EventDto[]>([]);
const cursor = ref<number | null>(null);
const loading = ref(false);
const menu = ref<{ viewer: Viewer; x: number; y: number } | null>(null);
const NOT_PLAYED = 'no_rule,blacklist,paused,offline,cooldown,once,no_overlay,dropped,cleared';

function query(c?: number): string {
  const p = new URLSearchParams({ limit: '50' });
  if (kind.value !== 'all') p.set('kind', kind.value);
  if (q.value) p.set('q', q.value);
  if (st.value === 'played') p.set('status', 'played');
  if (st.value === 'skip') p.set('status', NOT_PLAYED);
  if (c) p.set('cursor', String(c));
  return `/api/events?${p}`;
}
// 每次请求编号：只采用最新一次的结果（连续切换筛选、打字搜索时，慢返回的旧请求不会把列表盖掉）
let seq = 0;
async function load(more = false): Promise<void> {
  const my = ++seq;
  loading.value = true;
  try {
    const r = await get<{ events: EventDto[]; nextCursor: number | null }>(query(more ? (cursor.value ?? undefined) : undefined));
    if (my !== seq) return;
    rows.value = more ? [...rows.value, ...r.events] : r.events;
    cursor.value = r.nextCursor;
  } catch (e) {
    if (my === seq) toast(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    if (my === seq) loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout> | null = null;
watch([kind, st], () => void load());
watch(q, () => {
  if (t) clearTimeout(t);
  t = setTimeout(() => void load(), 300);
});

// 实时追加：没有搜索时，符合当前筛选的新事件直接插到最上面
function matches(e: EventDto): boolean {
  if (q.value) return false;
  if (kind.value !== 'all' && e.kind !== kind.value) return false;
  if (st.value === 'played') return e.status === 'played';
  if (st.value === 'skip') return NOT_PLAYED.split(',').includes(e.status);
  return true;
}
// 实时插入的最多保留这么多条（开几个小时也不会越积越多）；想看更早的点"加载更多"
const LIVE_MAX = 300;
function insert(e: EventDto): void {
  if (rows.value.some((x) => x.id === e.id)) return;
  // 按编号倒序放到正确的位置（晚一点才符合筛选的事件不会跑到更新的事件上面）
  const i = rows.value.findIndex((x) => x.id < e.id);
  if (i < 0 && cursor.value !== null) return;
  rows.value.splice(i < 0 ? rows.value.length : i, 0, e);
  if (rows.value.length > LIVE_MAX) {
    rows.value.length = LIVE_MAX;
    cursor.value = rows.value[LIVE_MAX - 1]!.id;
  }
}
// 新事件刚进来时可能还是"排队中"，之后才变成"已播放"：先记下来，状态符合筛选时再插入
const waiting = new Map<number, EventDto>();
const off1 = onLiveEvent((e) => {
  if (matches(e)) insert(e);
  else if (e.status === 'queued') {
    waiting.set(e.id, e);
    if (waiting.size > 100) waiting.delete(waiting.keys().next().value!);
  }
});
const off2 = onLiveEventStatus((id, s) => {
  const r = rows.value.find((x) => x.id === id);
  if (r) r.status = s;
  const w = waiting.get(id);
  if (w) {
    waiting.delete(id);
    w.status = s;
    if (!r && matches(w)) insert(w);
  }
});
// 断线重连后，断开期间的事件从头加载
const off3 = onResync(() => void load());
onMounted(() => void load());
onBeforeUnmount(() => (off1(), off2(), off3()));

const isExcl = (uid: number) => state.exclusives.some((x) => x.uid === uid && x.enabled);
function setExclusive(e: EventDto): void {
  state.pendingExclusive = e.uid;
  location.hash = 'rules/exclusive';
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>事件记录</h1>
        <p>进场、弹幕、礼物、上舰都会记录，包括命中了哪条规则、有没有播放、没播的原因。保留期可以在设置里修改。</p>
      </div>
    </div>
    <div class="toolbar">
      <Seg v-model="kind" label="事件类型" :options="[{ value: 'all', label: '全部' }, { value: 'enter', label: '进场' }, { value: 'danmu', label: '弹幕' }, { value: 'gift', label: '礼物' }, { value: 'guard', label: '上舰' }]" />
      <div class="s"><Icon name="i-search" /><input v-model.trim="q" class="inp" maxlength="40" placeholder="搜索昵称或 UID" aria-label="搜索昵称或 UID" /></div>
      <select v-model="st" class="sel" style="width: 140px" aria-label="播放状态">
        <option value="all">全部状态</option><option value="played">已播放</option><option value="skip">未播放</option>
      </select>
    </div>
    <div class="table-wrap">
      <table class="logtable">
        <thead><tr><th>时间</th><th>观众</th><th>事件</th><th>命中规则</th><th>播放</th><th /></tr></thead>
        <tbody>
          <tr v-for="e in rows" :key="e.id">
            <td>{{ dateTime(e.ts) }}</td>
            <td>
              <span class="who" style="cursor: pointer" @click="(ev) => (menu = { viewer: e.viewer, x: ev.clientX, y: ev.clientY })">
                <Avatar :name="e.uname" :face="e.viewer.face" :guard="e.viewer.guard" />
                <span><div>{{ e.uname }}<span v-if="isExcl(e.uid)" class="excl">专属</span></div><div class="num" style="font-size: 11.5px; color: var(--t3); font-weight: 400">{{ e.uid }}</div></span>
                <IdTag :viewer="e.viewer" />
              </span>
            </td>
            <td><span class="evchip"><EvIcon :kind="e.kind" :img="e.payload?.icon" />{{ describe(e) }}</span></td>
            <td><template v-if="e.rule">{{ e.rule }}<template v-if="e.effectId"> → {{ effectById(e.effectId)?.name ?? '（素材已删除）' }}</template></template><span v-else style="color: var(--t3)">—</span></td>
            <td><span class="st" :class="statusCls(e.status)">{{ statusText(e.status) }}</span></td>
            <td class="row-act" style="white-space: nowrap"><button v-if="e.kind === 'enter' && e.uid > 0" class="btn" @click="setExclusive(e)">{{ isExcl(e.uid) ? '修改专属' : '设为专属' }}</button></td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td colspan="6" style="text-align: center; padding: 40px; color: var(--t3)">{{ q || kind !== 'all' || st !== 'all' ? '没有符合条件的记录' : '还没有记录，开播后观众的进场、弹幕、礼物都会记在这里' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="cursor" class="more-row"><button class="btn" :disabled="loading" @click="load(true)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
    </div>
    <ViewerMenu v-if="menu" :viewer="menu.viewer" :x="menu.x" :y="menu.y" @close="menu = null" />
  </section>
</template>
