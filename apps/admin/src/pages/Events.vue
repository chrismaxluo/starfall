<script setup lang="ts">
// 事件记录：每个事件一行（时间、观众、身份、事件、结果），不常用的操作收进「⋯」；没命中规则的可以一键隐藏
import EvIcon from '../components/EvIcon.vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import HonorMedal from '../components/HonorMedal.vue';
import IdTag from '../components/IdTag.vue';
import RowMenu from '../components/RowMenu.vue';
import type { MenuItem } from '../components/RowMenu.vue';
import Switch from '../components/Switch.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import Seg from '../components/Seg.vue';
import { del, get, post } from '../lib/api.ts';
import { PLAY_STATUS } from '@starfall/shared/labels';
import { go } from '../lib/route.ts';
import { STATUS_WHY, WHY_FILTERS, describe, statusCls, statusText } from '../lib/events.ts';
import { dateTime } from '../lib/format.ts';
import { onLiveEvent, onLiveEventStatus, onResync } from '../lib/live.ts';
import { effectById, state, ui } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
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
/** 只看命中规则的：去掉「未命中规则」（大部分观众本来就不触发特效，直播时会刷满整页）；记在这台电脑上 */
const HIT_KEY = 'starfall.logs.hitOnly';
const hitOnly = ref((() => {
  try {
    return localStorage.getItem(HIT_KEY) === '1';
  } catch {
    return false;
  }
})());
watch(hitOnly, (v) => {
  try {
    localStorage.setItem(HIT_KEY, v ? '1' : '0');
  } catch {
    // 浏览器不让存就算了，这次照样生效
  }
});
// 专门筛「未命中规则」时，关掉「只看命中规则的」，不然什么都看不到
watch(st, (v) => {
  if (v === 'no_rule') hitOnly.value = false;
});
/** 按状态筛选：返回要的状态列表，null 表示不限 */
function wanted(): string[] | null {
  let list = st.value === 'all' ? null : st.value === 'played' ? ['played'] : (st.value === 'skip' ? NOT_PLAYED : st.value).split(',');
  if (hitOnly.value) list = (list ?? Object.keys(PLAY_STATUS)).filter((x) => x !== 'no_rule');
  return list;
}

function query(c?: number): string {
  const p = new URLSearchParams({ limit: '50' });
  if (kind.value !== 'all') p.set('kind', kind.value);
  if (q.value) p.set('q', q.value);
  const w = wanted();
  if (w) p.set('status', w.join(','));
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
watch([kind, st, range, hitOnly], () => void load());
watch(q, () => {
  if (t) clearTimeout(t);
  t = setTimeout(() => void load(), 300);
});

// 实时追加：没有搜索时，符合当前筛选的新事件直接插到最上面
function matches(e: EventDto): boolean {
  if (q.value || range.value === '7d' || (range.value === 'live' && !state.status?.live.live)) return false;
  if (kind.value !== 'all' && e.kind !== kind.value) return false;
  const w = wanted();
  return !w || w.includes(e.status);
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
async function copyUid(uid: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(String(uid));
    toast(`已复制 UID ${uid}`);
  } catch {
    toast(`UID：${uid}`, 'info');
  }
}
async function block(e: EventDto): Promise<void> {
  if (!(await attempt(() => post('/api/blacklist', { uid: e.uid, name: e.uname })))) return;
  undoable(`已把 ${e.uname} 加入黑名单，TA 不会再触发特效`, async () => {
    await del(`/api/blacklist/${e.uid}`);
    toast(`已把 ${e.uname} 移出黑名单`);
  });
}
const rowMenu = (e: EventDto): Array<MenuItem | null> => [
  ...(e.kind === 'enter' && e.uid > 0 ? [{ icon: 'i-user', label: isExcl(e.uid) ? '修改专属特效' : '设为专属', run: () => setExclusive(e) }] : []),
  { icon: 'i-list', label: '只看 TA 的记录', run: () => (q.value = String(e.uid)) },
  { icon: 'i-copy', label: '复制 UID', run: () => void copyUid(e.uid) },
  null,
  { icon: 'i-ban', label: '加入黑名单', danger: true, disabled: e.uid <= 0 || e.status === 'blacklist', run: () => void block(e) },
];
/** 时间分成两行：时分秒 + 日期 */
const timeOf = (ts: number) => {
  const [d, t] = dateTime(ts).split(' ');
  return { d: d ?? '', t: t ?? '' };
};
/** 列宽：时间 | 观众 | 身份 | 事件 | 结果 | ⋯ */
const COLS = '78px minmax(140px, 1fr) minmax(120px, 1fr) minmax(160px, 1.3fr) minmax(180px, 1.4fr) 36px';
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
      <span class="sp" />
      <label class="logs-hit" title="大部分观众本来就不触发特效，隐藏掉这些，只看命中了规则的（醒目留言也会隐藏）">只看命中规则的<Switch v-model="hitOnly" label="只看命中规则的" /></label>
    </div>
    <div class="rt logt">
      <div class="rt-h" :style="{ gridTemplateColumns: COLS }"><span>时间</span><span>观众</span><span>身份</span><span>事件</span><span>结果</span><span /></div>
      <div v-for="e in rows" :key="e.id" class="rt-r" :class="{ quiet: e.kind === 'sc' || statusCls(e.status) === 'skip' }" :style="{ gridTemplateColumns: COLS }">
        <div class="c-time"><b>{{ timeOf(e.ts).t }}</b>{{ timeOf(e.ts).d }}</div>
        <div class="c-who" style="cursor: pointer" :title="`${e.uname}：点一下设专属、复制 UID、拉黑`" @click="(ev) => (menu = { viewer: e.viewer, x: ev.clientX, y: ev.clientY })">
          <Avatar :name="e.uname" :face="e.viewer.face" :guard="e.viewer.guard" />
          <span class="nm"><span class="n1"><b>{{ e.uname }}</b><span v-if="isExcl(e.uid)" class="excl-tag">专属</span></span><span class="uid">UID {{ e.uid }}</span></span>
        </div>
        <div class="c-who"><HonorMedal :level="e.viewer.honor" /><IdTag :viewer="e.viewer" /></div>
        <div class="c-ev evchip"><EvIcon :kind="e.kind" :img="e.payload?.icon" /><span class="t" :title="describe(e)">{{ describe(e) }}</span></div>
        <div class="res">
          <template v-if="e.kind === 'sc'">
            <span class="l1"><i class="dot skip" /><span class="muted">只记录</span></span>
            <span class="l2">醒目留言现在只记录，不触发特效</span>
          </template>
          <template v-else>
            <span class="l1" :title="STATUS_WHY[e.status]">
              <i class="dot" :class="statusCls(e.status)" /><b v-if="statusCls(e.status) === 'ok'">{{ statusText(e.status) }}</b><span v-else :class="{ muted: statusCls(e.status) === 'skip' }">{{ statusText(e.status) }}</span>
              <button v-if="fixOf(e)" type="button" class="linkish fix" :title="STATUS_WHY[e.status]" @click="fixOf(e)!.run()">{{ fixOf(e)!.label }} →</button>
            </span>
            <span v-if="e.rule" class="l2" :title="`${e.rule}${e.effectId ? ` → ${effectById(e.effectId)?.name ?? '（素材已删除）'}` : ''}`">{{ e.rule }}<template v-if="e.effectId"> → {{ effectById(e.effectId)?.name ?? '（素材已删除）' }}</template></span>
          </template>
        </div>
        <div class="c-act"><RowMenu :items="rowMenu(e)" :label="`${e.uname}：更多操作`" /></div>
      </div>
      <div v-if="loading && !rows.length" class="rt-empty">正在读取…</div>
      <div v-else-if="failed && !rows.length" class="rt-empty">没读到事件记录（可能是和星临的连接断了）。<button class="linkish" type="button" @click="load()">重试</button></div>
      <div v-else-if="!rows.length" class="rt-empty">
        <template v-if="hasFilter() || hitOnly">没有符合条件的记录。<button v-if="hasFilter()" class="linkish" type="button" @click="clearFilters">清除筛选</button><button v-else class="linkish" type="button" @click="hitOnly = false">显示没命中规则的</button></template>
        <template v-else>还没有记录，开播后观众的进场、弹幕、礼物都会记在这里</template>
      </div>
      <div v-if="cursor" class="rt-foot" style="justify-content: center"><button class="btn" :disabled="loading" @click="load(true)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
    </div>
    <ViewerMenu v-if="menu" :viewer="menu.viewer" :x="menu.x" :y="menu.y" @close="menu = null" />
  </section>
</template>
