<script setup lang="ts">
import EvIcon from '../components/EvIcon.vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import HonorMedal from '../components/HonorMedal.vue';
import IdTag from '../components/IdTag.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import Seg from '../components/Seg.vue';
import { del, get } from '../lib/api.ts';
import { go } from '../lib/route.ts';
import { STATUS_WHY, WHY_FILTERS, describe, statusCls, statusText } from '../lib/events.ts';
import { dateTime } from '../lib/format.ts';
import { onLiveEvent, onLiveEventStatus, onResync } from '../lib/live.ts';
import { effectById, state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { EventDto, Viewer } from '../lib/types.ts';

type Kind = 'all' | EventDto['kind'];
const kind = ref<Kind>('all');
// 从观众菜单「查看 TA 的记录」跳过来时，带着 UID 搜索
const q = ref(ui.logQuery ?? '');
ui.logQuery = null;
/** 状态筛选：全部 / 已播放 / 未播放（所有原因）/ 某一种没播的原因（逗号分隔的状态） */
const st = ref<string>('all');
/** 时间范围：全部 / 今天 / 本场 / 最近 7 天 */
const range = ref<'all' | 'today' | 'live' | '7d'>('all');
const failed = ref(false);
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
  else if (st.value === 'skip') p.set('status', NOT_PLAYED);
  else if (st.value !== 'all') p.set('status', st.value);
  if (range.value !== 'all') p.set('range', range.value);
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
    failed.value = false;
  } catch (e) {
    if (my !== seq) return;
    if (!more) failed.value = true;
    toast(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    if (my === seq) loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout> | null = null;
watch([kind, st, range], () => void load());
watch(q, () => {
  if (t) clearTimeout(t);
  t = setTimeout(() => void load(), 300);
});

// 实时追加：没有搜索时，符合当前筛选的新事件直接插到最上面
function matches(e: EventDto): boolean {
  if (q.value || range.value === '7d' || (range.value === 'live' && !state.status?.live.live)) return false;
  if (kind.value !== 'all' && e.kind !== kind.value) return false;
  if (st.value === 'played') return e.status === 'played';
  if (st.value === 'skip') return NOT_PLAYED.split(',').includes(e.status);
  if (st.value !== 'all') return st.value.split(',').includes(e.status);
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
/** 每种没播的原因，一键去处理 */
function fixOf(e: EventDto): { label: string; run: () => void } | null {
  switch (e.status) {
    case 'no_rule':
      return e.kind === 'sc' ? null : { label: '去看规则', run: () => go('rules', e.kind === 'enter' ? undefined : e.kind) };
    case 'no_overlay':
      return { label: '去检查特效页', run: () => go('obs') };
    case 'cooldown':
    case 'once':
      return { label: '去改', run: () => go('rules', e.kind === 'enter' ? undefined : e.kind) };
    case 'offline':
      return { label: '去设置', run: () => go('settings') };
    case 'dropped':
      return { label: '排队设置', run: () => go('overview') };
    case 'blacklist':
      return {
        label: '移出黑名单',
        run: () => void attempt(() => del(`/api/blacklist/${e.uid}`), `已把 ${e.uname} 移出黑名单，之后照常触发`),
      };
    default:
      return null;
  }
}
const hasFilter = () => Boolean(q.value || kind.value !== 'all' || st.value !== 'all' || range.value !== 'all');
function clearFilters(): void {
  q.value = '';
  kind.value = 'all';
  st.value = 'all';
  range.value = 'all';
}
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
      <Seg v-model="kind" label="事件类型" :options="[{ value: 'all', label: '全部' }, { value: 'enter', label: '进场' }, { value: 'danmu', label: '弹幕' }, { value: 'gift', label: '礼物' }, { value: 'guard', label: '上舰' }, { value: 'sc', label: '醒目留言' }]" />
      <div class="s"><Icon name="i-search" /><input v-model.trim="q" class="inp" maxlength="40" placeholder="搜索昵称或 UID" aria-label="搜索昵称或 UID" /></div>
      <select v-model="st" class="sel" style="width: 170px" aria-label="播放状态">
        <option value="all">全部状态</option><option value="played">已播放</option><option value="skip">未播放（所有原因）</option>
        <optgroup label="没播的原因"><option v-for="w in WHY_FILTERS" :key="w.value" :value="w.value">{{ w.label }}</option></optgroup>
      </select>
      <select v-model="range" class="sel" style="width: 130px" aria-label="时间范围">
        <option value="all">全部时间</option><option value="today">今天</option><option value="live">{{ state.status?.live.live ? '本场' : '上一场' }}</option><option value="7d">最近 7 天</option>
      </select>
      <button v-if="hasFilter()" class="linkish" type="button" @click="clearFilters">清除筛选</button>
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
                <span class="ids"><HonorMedal :level="e.viewer.honor" /><IdTag :viewer="e.viewer" /></span>
              </span>
            </td>
            <td><span class="evchip"><EvIcon :kind="e.kind" :img="e.payload?.icon" />{{ describe(e) }}</span></td>
            <td><template v-if="e.rule">{{ e.rule }}<template v-if="e.effectId"> → {{ effectById(e.effectId)?.name ?? '（素材已删除）' }}</template></template><span v-else style="color: var(--t3)">—</span></td>
            <td>
              <span v-if="e.kind === 'sc'" class="st skip" title="醒目留言现在只记录，不触发特效">只记录</span>
              <template v-else>
                <span class="st" :class="statusCls(e.status)" :title="STATUS_WHY[e.status]">{{ statusText(e.status) }}</span>
                <button v-if="fixOf(e)" type="button" class="linkish st-fix" :title="STATUS_WHY[e.status]" @click="fixOf(e)!.run()">{{ fixOf(e)!.label }}</button>
              </template>
            </td>
            <td class="row-act" style="white-space: nowrap"><button v-if="e.kind === 'enter' && e.uid > 0" class="btn" @click="setExclusive(e)">{{ isExcl(e.uid) ? '修改专属' : '设为专属' }}</button></td>
          </tr>
          <tr v-if="loading && !rows.length">
            <td colspan="6" style="text-align: center; padding: 40px; color: var(--t3)">正在读取…</td>
          </tr>
          <tr v-else-if="failed && !rows.length">
            <td colspan="6" style="text-align: center; padding: 40px; color: var(--t3)">没读到事件记录（可能是和星临的连接断了）。<button class="linkish" type="button" @click="load()">重试</button></td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="6" style="text-align: center; padding: 40px; color: var(--t3)">
              <template v-if="hasFilter()">没有符合条件的记录。<button class="linkish" type="button" @click="clearFilters">清除筛选</button></template>
              <template v-else>还没有记录，开播后观众的进场、弹幕、礼物都会记在这里</template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="cursor" class="more-row"><button class="btn" :disabled="loading" @click="load(true)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
    </div>
    <ViewerMenu v-if="menu" :viewer="menu.viewer" :x="menu.x" :y="menu.y" @close="menu = null" />
  </section>
</template>
