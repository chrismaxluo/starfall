<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import Seg from '../components/Seg.vue';
import { get } from '../lib/api.ts';
import { EV_ICON, describe, statusCls, statusText } from '../lib/events.ts';
import { dateTime } from '../lib/format.ts';
import { onLiveEvent, onLiveEventStatus } from '../lib/live.ts';
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
async function load(more = false): Promise<void> {
  loading.value = true;
  try {
    const r = await get<{ events: EventDto[]; nextCursor: number | null }>(query(more ? (cursor.value ?? undefined) : undefined));
    rows.value = more ? [...rows.value, ...r.events] : r.events;
    cursor.value = r.nextCursor;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    loading.value = false;
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
const off1 = onLiveEvent((e) => matches(e) && rows.value.unshift(e));
const off2 = onLiveEventStatus((id, s) => {
  const r = rows.value.find((x) => x.id === id);
  if (r) r.status = s;
});
onMounted(() => void load());
onBeforeUnmount(() => (off1(), off2()));

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
      <div class="s"><Icon name="i-search" /><input v-model.trim="q" class="inp" placeholder="搜索昵称或 UID" aria-label="搜索昵称或 UID" /></div>
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
                <Avatar :name="e.uname" :face="e.viewer.face" />
                <span><div>{{ e.uname }}<span v-if="isExcl(e.uid)" class="excl">专属</span></div><div class="num" style="font-size: 11.5px; color: var(--t3); font-weight: 400">{{ e.uid }}</div></span>
                <IdTag :viewer="e.viewer" />
              </span>
            </td>
            <td><span class="evchip"><span class="ev" :style="{ background: EV_ICON[e.kind].bg }">{{ EV_ICON[e.kind].text }}</span>{{ describe(e) }}</span></td>
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
