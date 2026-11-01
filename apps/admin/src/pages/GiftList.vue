<script setup lang="ts">
// 送礼名单：先选「名单放什么」（自动：收到的礼物，可以选时间范围、一份一条还是按人合计 / 手动：我挑的记录），一行大白话写出画面上现在会显示什么；
// 右边是预览和外观（样式、滚法、标题、速度、对齐、字号、条数）；选了手动或者自动里打开了置顶时，左边接着出现挑好的记录（可以拖动排顺序）和送礼记录（按场次，从这里挑）。
// 开关、复制地址也在这里，不用跳到「直播软件输出」页
import { computed, onMounted, ref, watch } from 'vue';
import { GIFTS_ALPHA_MAX, GIFTS_ALPHA_MIN, GIFTS_KEEP, GIFTS_MAX_LIMIT, GIFTS_MIN_OPTIONS, GIFTS_PAGE_HOLD, GIFTS_STEP_HOLD, GIFTS_TITLE_MAX, giftsRange, giftsSourceSize, giftsView } from '@starfall/shared/overlay';
import type { GiftListItem, GiftsFilter, GiftsLook, GiftsMotion, GiftsRange, GiftsSpeed } from '@starfall/shared/overlay';
import Avatar from '../components/Avatar.vue';
import Empty from '../components/Empty.vue';
import DraftBar from '../components/DraftBar.vue';
import GiftsFilterPick from '../components/GiftsFilterPick.vue';
import GiftsPreview from '../components/GiftsPreview.vue';
import Icon from '../components/Icon.vue';
import SourceCard from '../components/SourceCard.vue';
import Switch from '../components/Switch.vue';
import { del, get, post, put } from '../lib/api.ts';
import { useDraft } from '../lib/draft.ts';
import { clock, dateTime, inputDateTime, parseInputDateTime } from '../lib/format.ts';
import { battery } from '../lib/preview.ts';
import { confirmLeave } from '../lib/route.ts';
import { overlayConfigOf, refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import { pinLeaving, useListMotion } from '../lib/motion.ts';
import type { OutputDto } from '../lib/types.ts';

// ---------- 输出（只有一个输出时不显示切换） ----------
const selId = ref<number | null>(null);
const o = computed(() => state.outputs.find((x) => x.id === selId.value) ?? state.outputs[0]);
// 外观（样式、滚法、透明度、标题、速度、对齐、字号、条数）先改草稿，点「保存」才到直播画面；预览照着草稿显示
const look = useDraft(() => o.value, ['giftsLook', 'giftsMotion', 'giftsAlpha', 'giftsTitle', 'giftsSpeed', 'giftsSide', 'giftsSize', 'giftsMax'] as const, (p): Promise<boolean> =>
  save(p, whOf({ ...o.value!, ...p }) !== whOf(o.value!) ? `已保存：浏览器源宽高建议填 ${whOf({ ...o.value!, ...p })}` : '已保存，直播画面已更新'),
);
/** 已保存 + 外观草稿（模板里只在有输出时用） */
const v = computed(() => ({ ...o.value!, ...look.pending.value }));
const cfg = computed(() => (o.value ? overlayConfigOf(v.value) : null));
const online = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && x.role === 'gifts').length);
const pv = ref<InstanceType<typeof GiftsPreview> | null>(null);
const whOf = (x: OutputDto) => {
  const s = giftsSourceSize(x);
  return `${s.w} × ${s.h}`;
};
const wh = computed(() => (o.value ? whOf(o.value) : ''));
const srcWh = computed(() => (o.value ? giftsSourceSize(o.value) : { w: 0, h: 0 }));
/** 换输出：草稿是上一个输出的，先问再丢掉 */
function pickOutput(e: Event): void {
  const el = e.target as HTMLSelectElement;
  if (confirmLeave()) selId.value = Number(el.value);
  else el.value = String(o.value?.id);
}
watch(() => o.value?.id, () => look.reset());

async function save(patch: Partial<OutputDto>, msg?: string): Promise<boolean> {
  const target = o.value;
  if (!target) return false;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${target.id}`, patch), msg);
  if (r) Object.assign(target, r);
  else await refreshOutputs();
  return Boolean(r);
}
async function copyUrl(): Promise<void> {
  if (!o.value) return;
  try {
    await navigator.clipboard.writeText(`${location.origin}${o.value.giftsPath}`);
    toast(`已复制送礼名单地址：在直播软件里加一个浏览器源，宽高填 ${wh.value}`);
  } catch {
    toast('浏览器不允许自动复制，请到「直播软件输出」页手动复制', 'info');
  }
}

// ---------- 名单放什么 ----------
const f = computed(() => o.value!.giftsFilter);
const manual = computed(() => f.value.mode === 'pinned');
/** 最后一次改的名单设置（还在保存中时）：前面几次的保存回来得晚，页面上也还是显示这一次的 */
let filterNext: { id: number; f: GiftsFilter } | null = null;
/** 先在页面上改好再保存：连着点几项时，后一项在前一项的基础上改，不会被还没保存完的旧设置盖掉（保存失败时 save 会取回原来的） */
function setFilter(patch: Partial<GiftsFilter>, msg: string): void {
  const target = o.value!;
  const giftsFilter = { ...f.value, ...patch };
  const mine = (filterNext = { id: target.id, f: giftsFilter });
  target.giftsFilter = giftsFilter;
  void save({ giftsFilter }, msg).then((ok) => {
    if (filterNext === mine) filterNext = null;
    else if (ok && filterNext && filterNext.id === target.id) target.giftsFilter = filterNext.f;
  });
}
/** 全部礼物时的最低金额（金瓜子；0 为不限） */
const listMin = computed(() => f.value.minGold ?? 0);
const yuanOf = (gold: number) => `${gold / 1000} 元`;
function setMin(gold: number): void {
  setFilter({ minGold: gold }, gold ? `名单只显示 ${yuanOf(gold)}以上的礼物（连击合起来算）` : '名单显示所有付费礼物，金额不限');
}
function pickAuto(): void {
  if (!manual.value) return;
  // 回到自动：选过礼物种类就接着用，没选过就是全部礼物
  setFilter({ mode: f.value.gifts.length ? 'only' : 'all' }, '名单改为自动显示收到的礼物');
}

// 时间范围
const range = computed(() => giftsRange(f.value));
const RANGES: Array<{ value: GiftsRange; label: string; hint: string }> = [
  { value: 'live', label: '本场直播', hint: '下次开播时清空；没开播时显示上一场的' },
  { value: 'today', label: '今天', hint: '每天 0 点清空，一天播几场都算在一起' },
  { value: 'week', label: '本周', hint: '每周一 0 点清空' },
  { value: 'month', label: '本月', hint: '每月 1 号 0 点清空' },
  { value: 'since', label: '从某个时间起', hint: '从指定的时间开始一直累积，适合生日会、周年、活动' },
];
const rangeName = (r: GiftsRange) => RANGES.find((x) => x.value === r)!.label;
function setRange(r: GiftsRange): void {
  if (r === range.value) return;
  // 第一次选「从某个时间起」：从现在开始算
  if (r === 'since') return setFilter({ range: r, since: f.value.since ?? Date.now() }, `名单改为从 ${dateTime(f.value.since ?? Date.now())} 起收到的`);
  setFilter({ range: r }, `名单改为${rangeName(r)}收到的`);
}
const sinceValue = computed(() => (f.value.since ? inputDateTime(f.value.since) : ''));
function setSince(v: string): void {
  const t = parseInputDateTime(v);
  if (!Number.isFinite(t)) return;
  if (t > Date.now()) return toast('开始时间不能晚于现在', 'err');
  setFilter({ since: t }, `名单改为从 ${dateTime(t)} 起收到的`);
}
const sinceNow = () => setFilter({ since: Date.now() }, '名单从现在开始重新算');
/** 事件记录只保留几天：开始时间比这还早时提醒更早的礼物算不进来 */
const tooOld = computed(() => {
  const days = state.settings?.retentionDays ?? 0;
  return range.value === 'since' && days > 0 && (f.value.since ?? 0) < Date.now() - days * 86_400_000 ? days : 0;
});

// 显示方式
const view = computed(() => giftsView(f.value));
function setView(v: 'item' | 'viewer'): void {
  if (v !== view.value) setFilter({ view: v }, v === 'viewer' ? '名单改为按人合计：每人一条，送得多的在上面' : '名单改为一份礼物一条');
}

// 置顶：自动名单的最上面固定显示挑好的记录
const showRecords = computed(() => manual.value || Boolean(f.value.pinTop));
/** 名单里的记录这一块叫什么：手动时是名单本身，自动时是置顶的 */
const pinsTitle = computed(() => (manual.value ? '名单里的记录' : '置顶的记录'));
function pickManual(): void {
  if (!manual.value) setFilter({ mode: 'pinned' }, '名单改为只显示你挑的记录');
}

/** 画面上现在会显示什么（大白话）；bad 为会显示空名单 */
const summary = computed<{ text: string; bad: boolean }>(() => {
  const x = o.value!;
  if (!x.giftsEnabled) return { text: '送礼名单关着，直播画面上不显示。打开右上角的开关。', bad: true };
  if (manual.value) return pins.value.length ? { text: `你挑的 ${pins.value.length} 条记录，按下面「名单里的记录」的顺序`, bad: false } : { text: '名单是空的：在下面的送礼记录里点「加入名单」', bad: true };
  const parts: string[] = [];
  if (f.value.mode === 'all') parts.push(listMin.value ? `${yuanOf(listMin.value)}以上的礼物` : '所有付费礼物');
  else if (f.value.gifts.length) parts.push(f.value.gifts.map((g) => `「${g.name}」`).join('、'));
  if (f.value.guard) parts.push('上舰');
  if (f.value.sc) parts.push('醒目留言');
  if (!parts.length) return { text: f.value.mode === 'only' ? '什么都不会显示：还没选礼物，上舰、醒目留言也关着' : '什么都不会显示', bad: true };
  const when = range.value === 'since' ? `${dateTime(f.value.since ?? 0)} 起` : range.value === 'live' ? '本场' : rangeName(range.value);
  const pre = f.value.mode === 'only' && !f.value.gifts.length ? '（还没选礼物）只有' : '';
  const n = (state.giftBoards[x.id] ?? []).length;
  const how = view.value === 'viewer' ? `按人合计，${n >= GIFTS_KEEP ? `名单里放送得最多的 ${GIFTS_KEEP} 人` : `现在有 ${n} 人`}` : `${f.value.sort === 'value' ? '大的在上，' : ''}${f.value.merge ? '同一个人的同一种礼物合成一条，' : ''}${n >= GIFTS_KEEP ? `名单里放${f.value.sort === 'value' ? '最大' : '最新'}的 ${GIFTS_KEEP} 条` : `现在有 ${n} 条`}`;
  const top = f.value.pinTop ? (pins.value.length ? `；最上面固定 ${Math.min(pins.value.length, Math.max(0, x.giftsMax - 1))} 条你挑的记录` : '；置顶还没挑记录（在下面挑）') : '';
  return { text: `${when}的${pre}${parts.join('、')}，${how}${top}`, bad: false };
});

// ---------- 外观 ----------
/** 标题建议：手动时是一直挂着的记录；自动时按时间范围和显示方式 */
const titleIdeas = computed(() => {
  if (manual.value) return ['感谢墙', '荣誉榜'];
  const rank = view.value === 'viewer';
  return [{ live: rank ? '本场感谢榜' : '本场礼物', today: rank ? '今日感谢榜' : '今日礼物', week: rank ? '本周榜单' : '本周礼物', month: rank ? '本月榜单' : '本月礼物', since: rank ? '活动榜单' : '活动礼物' }[range.value]];
});
function setMax(x: number): void {
  if (!o.value) return;
  const n = Math.round(x);
  if (!(n >= 1 && n <= GIFTS_MAX_LIMIT)) return toast(`条数要在 1 – ${GIFTS_MAX_LIMIT} 之间`, 'err');
  look.set({ giftsMax: n });
}
const LOOKS: Array<{ value: GiftsLook; label: string; hint: string }> = [
  { value: 'jingcai', label: '晶彩', hint: '彩色横条，和礼物特效同一套，颜色按礼物价值分档' },
  { value: 'glass', label: '流光', hint: '深色毛玻璃，礼物的颜色化成背后一团光；和点歌窗口「流光」是一套' },
  { value: 'journal', label: '手帐', hint: '点点纸条、和纸胶带、手写字，数量用彩笔圈出来；和点歌窗口「手帐」是一套' },
  { value: 'island', label: '灵动岛', hint: '黑色胶囊，一行写完，最省地方；和点歌窗口「灵动岛」是一套' },
  { value: 'esports', label: '电竞', hint: '比赛直播的记分牌：碳纤维纹面板、青色比分框，每条一样' },
  { value: 'diffuse', label: '弥散', hint: '半透明的雾面卡片，里面有淡淡的柔光，每条一样；透明度可以调' },
  { value: 'pixel', label: '像素', hint: '复古游戏对话框、像素字，新礼物一个字一个字打出来' },
];
const MOTIONS: Array<{ value: GiftsMotion; label: string; hint: string }> = [
  { value: 'credits', label: '片尾字幕', hint: '一直慢慢往上走，像片尾字幕' },
  { value: 'step', label: '逐条上移', hint: '停一会儿往上挪一条，每条都看得清' },
  { value: 'page', label: '翻页', hint: '一屏停几秒，整屏换成下一屏' },
  { value: 'marquee', label: '横向跑马灯', hint: '排成一行从右往左走，放在画面最上面或最下面' },
];
const SPEED: Array<{ value: GiftsSpeed; label: string }> = [
  { value: 'off', label: '不滚动' },
  { value: 'slow', label: '慢' },
  { value: 'normal', label: '中' },
  { value: 'fast', label: '快' },
];
/** 速度的说明：每种滚法的「快慢」说法不一样 */
function speedHint(m: GiftsMotion, s: GiftsSpeed): string {
  if (s === 'off') return m === 'marquee' ? '固定挂着，一行放不下时只留最新的几条' : '固定挂着，放不下时只留最新的几条';
  if (m === 'step') return `一屏放不下时每条停 ${GIFTS_STEP_HOLD[s]} 秒，再往上挪一条`;
  if (m === 'page') return `一屏放不下时每页停 ${GIFTS_PAGE_HOLD[s]} 秒，再换下一页`;
  if (m === 'marquee') return `一行放不下时从右往左循环走（${s === 'slow' ? '慢慢走' : s === 'normal' ? '正常' : '走得快'}）`;
  return `一屏放不下时从下往上循环滚动，约 ${s === 'slow' ? 5 : s === 'normal' ? 3 : 2} 秒一条`;
}

// ---------- 送礼记录（按场次，手动时用） ----------
type Rec = GiftListItem & { eventId: number };
interface Sess {
  id: number;
  startedAt: number;
  endedAt: number | null;
  gifts: number;
}
const sessions = ref<Sess[]>([]);
const current = ref<number | null>(null);
/** 某一场，或 'all' 全部场次 */
const sessId = ref<number | 'all' | null>(null);
const records = ref<Rec[]>([]);
const loading = ref(false);
const q = ref('');
/** 总价值下限（金瓜子）：不限 / 1 / 10 / 50 / 100 / 500 元以上 */
const minGold = ref(0);
const MIN_OPTIONS = [0, 1000, 10_000, 50_000, 100_000, 500_000];
const more = ref(false);
const sessLabel = (s: Sess) => `${s.id === current.value ? '本场（直播中）' : dateTime(s.startedAt)}${s.endedAt ? ` – ${clock(s.endedAt)}` : ''} · ${s.gifts} 条`;

async function loadSessions(): Promise<void> {
  const r = await attempt(() => get<{ current: number | null; sessions: Sess[] }>('/api/gift-list/sessions'));
  if (!r) return;
  sessions.value = r.sessions;
  current.value = r.current;
  // 默认全部场次一起找；之前选的那一场没有了也回到全部场次
  if (sessId.value === null || (sessId.value !== 'all' && !r.sessions.some((s) => s.id === sessId.value))) sessId.value = 'all';
}
// 请求序号：快速换场次、金额或打字时，只用最后一次的结果（晚到的旧结果不会盖掉新的）
let recordsSeq = 0;
async function loadRecords(): Promise<void> {
  const seq = ++recordsSeq;
  if (sessId.value === null) return void (records.value = []);
  loading.value = true;
  const qs = new URLSearchParams({ session: String(sessId.value), q: q.value, min: String(minGold.value) });
  const r = await attempt(() => get<{ items: Rec[]; more: boolean }>(`/api/gift-list/records?${qs}`));
  if (seq !== recordsSeq) return;
  loading.value = false;
  records.value = r?.items ?? [];
  more.value = r?.more ?? false;
}
watch([sessId, minGold], () => void loadRecords());
// 打字停下 0.3 秒后再搜
let qTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => void loadRecords(), 300);
});
onMounted(async () => {
  await Promise.all([loadSessions(), loadPins()]);
});

// ---------- 名单里的记录 ----------
interface Pin {
  id: number;
  eventId: number;
  item: GiftListItem;
}
const pins = ref<Pin[]>([]);
// 移出的那一行收起来，撤销时展开
const listMotion = useListMotion();
const pinMax = ref(50);
const inList = computed(() => new Map(pins.value.map((p) => [p.eventId, p.id])));
async function loadPins(): Promise<void> {
  const r = await attempt(() => get<{ pins: Pin[]; max: number }>('/api/gift-list/pins'));
  if (r) {
    pins.value = r.pins;
    pinMax.value = r.max;
  }
}
// 别处（另一个后台窗口、事件记录页）加入或移出时跟着刷新
watch(() => state.giftPins, () => void loadPins(), { deep: true });

const GUARD = { 1: '总督', 2: '提督', 3: '舰长' } as const;
/** 一条记录写成一句话 */
function what(it: GiftListItem): string {
  if (it.kind === 'guard' && it.guard) return `${it.guard.op === 'renew' ? '续费' : '开通'}${GUARD[it.guard.level]} ×${it.guard.months}个月`;
  if (it.kind === 'sc' && it.sc) return `醒目留言 ${Math.round(it.sc.price)} 元：${it.sc.text}`;
  return `送出 ${it.gift?.name ?? ''} ×${it.gift?.count ?? 1}`;
}

async function add(r: Rec): Promise<void> {
  const res = await attempt(() => post<{ pins: Pin[] }>('/api/gift-list/pins', { eventId: r.eventId }), `已加入名单：${r.viewer.name} ${what(r)}`);
  if (res) pins.value = res.pins;
}
/** 移出名单：8 秒内可以撤销（放回原来的位置） */
async function remove(id: number, name: string): Promise<void> {
  const at = pins.value.findIndex((x) => x.id === id);
  const old = pins.value[at];
  const res = await attempt(() => del<{ pins: Pin[] }>(`/api/gift-list/pins/${id}`));
  if (!res) return;
  pins.value = res.pins;
  if (!old) return;
  undoable(`已移出名单：${name}`, async () => {
    const r = await post<{ pins: Pin[] }>('/api/gift-list/pins', { eventId: old.eventId });
    const ids = r.pins.map((x) => x.id);
    const back = r.pins.find((x) => x.eventId === old.eventId)?.id;
    if (back !== undefined && ids.indexOf(back) !== at) {
      ids.splice(ids.indexOf(back), 1);
      ids.splice(Math.min(at, ids.length), 0, back);
      pins.value = (await put<{ pins: Pin[] }>('/api/gift-list/pins/order', { ids })).pins;
    } else pins.value = r.pins;
  });
}
/** 把第 from 条挪到第 to 个位置：页面上先挪好再保存，保存失败时取回原来的顺序 */
async function reorder(from: number, to: number): Promise<void> {
  if (from === to || to < 0 || to >= pins.value.length) return;
  const next = [...pins.value];
  const [p] = next.splice(from, 1);
  next.splice(to, 0, p!);
  pins.value = next;
  const res = await attempt(() => put<{ pins: Pin[] }>('/api/gift-list/pins/order', { ids: next.map((x) => x.id) }));
  if (res) pins.value = res.pins;
  else await loadPins();
}
const move = (i: number, d: -1 | 1) => void reorder(i, i + d);

// 拖动排序
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i;
  e.dataTransfer?.setData('text/plain', String(i));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDrop(to: number): void {
  const from = dragFrom.value;
  dragFrom.value = dragOver.value = null;
  if (from !== null) void reorder(from, to);
}
</script>

<template>
  <section v-if="o && cfg" class="page">
    <div class="page-head">
      <div><h1>送礼名单</h1><p>收到的礼物、上舰和醒目留言排成一列，显示在直播画面上。</p></div>
      <div class="wp-head-r">
        <select v-if="state.outputs.length > 1" class="sel" aria-label="输出" :value="o.id" @change="pickOutput"><option v-for="x in state.outputs" :key="x.id" :value="x.id">{{ x.name }}</option></select>
        <span class="live" :class="o.giftsEnabled && online ? '' : 'off'"><i />{{ !o.giftsEnabled ? '已关闭' : online ? '直播软件里已加上' : '直播软件里还没加' }}</span>
        <button class="btn" :title="`在直播软件里加一个浏览器源，宽高填 ${wh}`" @click="copyUrl"><Icon name="i-copy" />复制地址</button>
        <Switch :model-value="o.giftsEnabled" label="送礼名单开关" @change="(v) => save({ giftsEnabled: v }, v ? '已打开送礼名单' : '已关闭送礼名单：直播画面上不再显示')" />
      </div>
    </div>

    <div class="wp-grid">
      <div class="wp-col">
        <!-- 名单放什么 -->
        <div class="card">
          <div class="card-h"><h2><span class="hicon"><Icon name="i-todo" /></span>名单放什么</h2></div>
          <div class="gl-modes" role="radiogroup" aria-label="名单放什么">
            <button type="button" class="gl-mode" role="radio" :aria-checked="!manual" @click="pickAuto">
              <b><Icon name="i-bolt" />自动：收到的礼物</b>
              <span>收到的礼物自动加进来，可以选本场、今天、本周、本月或者从某个时间起</span>
            </button>
            <button type="button" class="gl-mode" role="radio" :aria-checked="manual" @click="pickManual">
              <b><Icon name="i-pin" />手动：我挑的记录</b>
              <span>从本场或以前的送礼记录里挑几条，一直挂着，直到你移出</span>
            </button>
          </div>

          <div v-if="!manual" class="srows">
            <div class="srow">
              <span class="lb">时间范围</span>
              <div class="ctl">
                <span class="seg wrap" role="group" aria-label="时间范围">
                  <button v-for="r in RANGES" :key="r.value" :aria-pressed="range === r.value" @click="setRange(r.value)">{{ r.label }}</button>
                </span>
                <div v-if="range === 'since'" class="line">
                  <input class="inp dt" type="datetime-local" aria-label="开始时间" :value="sinceValue" :max="inputDateTime(Date.now())" @change="setSince(($event.target as HTMLInputElement).value)" />
                  <button class="btn sm" type="button" @click="sinceNow">从现在开始算</button>
                </div>
                <span class="hint">{{ RANGES.find((r) => r.value === range)?.hint }}</span>
                <span v-if="tooOld" class="hint warn">事件记录只保留 {{ tooOld }} 天，更早的礼物算不进来</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">显示方式</span>
              <div class="ctl">
                <span class="seg" role="group" aria-label="显示方式">
                  <button :aria-pressed="view === 'item'" @click="setView('item')">一份一条</button>
                  <button :aria-pressed="view === 'viewer'" @click="setView('viewer')">按人合计（感谢榜）</button>
                </span>
                <div v-if="view === 'item'" class="line">
                  <span class="seg" role="group" aria-label="排序">
                    <button :aria-pressed="f.sort !== 'value'" @click="f.sort === 'value' && setFilter({ sort: 'time' }, '名单按时间先后排')">按时间</button>
                    <button :aria-pressed="f.sort === 'value'" @click="f.sort !== 'value' && setFilter({ sort: 'value' }, '名单按金额排，大的在上面')">按金额</button>
                  </span>
                  <span class="gap" />
                  <Switch :model-value="Boolean(f.merge)" label="合并同一个人的同一种礼物" @change="(v) => setFilter({ merge: v }, v ? '同一个人的同一种礼物合成一条' : '每送一次一条')" /><span>合并同一个人的同一种礼物</span>
                </div>
                <div v-else class="line">
                  <Switch :model-value="f.amount !== false" label="显示总金额" @change="(v) => setFilter({ amount: v }, v ? '名单显示每人的总金额（电池）' : '名单不显示金额，只排名次')" /><span>显示总金额（电池）</span>
                </div>
                <span class="hint">{{ view === 'viewer' ? '每人一条，按送出的总价值排名，前三名有金银铜标记' : f.sort === 'value' ? '大礼物排在上面' : '旧的在上、新的在下' }}{{ view === 'item' && f.merge ? '；同一个人送的同一种礼物合成一条' : '' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">哪些礼物</span>
              <div class="ctl">
                <div class="line">
                  <span class="seg" role="group" aria-label="哪些礼物">
                    <button :aria-pressed="f.mode === 'all'" @click="setFilter({ mode: 'all' }, '名单显示本场所有付费礼物')">全部礼物</button>
                    <button :aria-pressed="f.mode === 'only'" @click="setFilter({ mode: 'only' }, '名单只显示选中的几种礼物')">只要这几种</button>
                  </span>
                  <select v-if="f.mode === 'all'" class="sel" aria-label="最低金额" :value="listMin" @change="setMin(Number(($event.target as HTMLSelectElement).value))"><option v-for="g in GIFTS_MIN_OPTIONS" :key="g" :value="g">{{ g ? `${yuanOf(g)}以上` : '金额不限' }}</option></select>
                  <span class="hint">{{ f.mode === 'all' ? (listMin ? `一次送出满 ${yuanOf(listMin)}才显示（连击合起来算）` : '所有付费礼物都显示') : '只显示下面选中的礼物，谁送的都算' }}</span>
                </div>
                <GiftsFilterPick v-if="f.mode === 'only'" :model-value="f.gifts" @change="(gifts, msg) => setFilter({ gifts }, msg)" />
              </div>
            </div>
            <div class="srow">
              <span class="lb">也显示</span>
              <div class="ctl"><div class="line">
                <Switch :model-value="f.guard" label="也显示上舰" @change="(v) => setFilter({ guard: v }, v ? '名单也显示上舰' : '名单不再显示上舰')" /><span>上舰（开通、续费大航海）</span>
                <span class="gap" />
                <Switch :model-value="f.sc" label="也显示醒目留言" @change="(v) => setFilter({ sc: v }, v ? '名单也显示醒目留言' : '名单不再显示醒目留言')" /><span>醒目留言</span>
              </div></div>
            </div>
            <div class="srow">
              <span class="lb">置顶</span>
              <div class="ctl">
                <div class="line"><Switch :model-value="Boolean(f.pinTop)" label="置顶我挑的记录" @change="(v) => setFilter({ pinTop: v }, v ? '挑好的记录固定在名单最上面' : '不再置顶')" /><span>把我挑的记录固定在最上面</span></div>
                <span class="hint">从下面的送礼记录里挑，固定在名单最上面</span>
              </div>
            </div>
          </div>

          <div class="gl-sum" :class="{ bad: summary.bad }"><Icon :name="summary.bad ? 'i-info' : 'i-check'" /><span><b>现在画面上显示：</b>{{ summary.text }}</span></div>
        </div>
        <template v-if="showRecords">
        <div class="card">
          <div class="card-h"><h2><span class="hicon"><Icon name="i-pin" /></span>{{ pinsTitle }} {{ pins.length }} 条</h2><span class="aside">{{ manual ? `拖动排顺序 · 最多 ${pinMax} 条` : `拖动排顺序 · 一屏最多置顶 ${Math.max(0, v.giftsMax - 1)} 条` }} · 一直保留到移出</span></div>
          <Empty v-if="!pins.length" compact icon="i-pin" title="还没有挑选的记录" desc="在下面的送礼记录里点「加入名单」，或者在「事件记录」里点一条礼物的「⋯」→「加入送礼名单」" />
          <TransitionGroup v-else tag="div" class="gl-recs lst-box" :name="listMotion()" @before-leave="pinLeaving">
            <div
              v-for="(p, i) in pins"
              :key="p.id"
              class="gl-rec pin"
              :class="{ dragging: dragFrom === i, dropto: dragOver === i && dragFrom !== i }"
              @dragover.prevent="dragFrom !== null && (dragOver = i)"
              @dragleave="dragOver === i && (dragOver = null)"
              @drop.prevent="onDrop(i)"
            >
              <span class="rl-no grab" draggable="true" title="按住拖动调整顺序" @dragstart="(e) => onDragStart(e, i)" @dragend="(dragFrom = null), (dragOver = null)"><Icon name="i-grip" class="grip" />{{ i + 1 }}</span>
              <span class="t num">{{ dateTime(p.item.ts) }}</span>
              <Avatar :name="p.item.viewer.name" :face="p.item.viewer.face" :guard="p.item.viewer.guard" :size="30" />
              <span class="who"><b>{{ p.item.viewer.name }}</b><span>{{ what(p.item) }}</span></span>
              <img v-if="p.item.gift?.img" class="gimg" :src="p.item.gift.img" alt="" referrerpolicy="no-referrer" /><span v-else class="gimg" />
              <span class="ord">
                <button class="icon-btn" type="button" aria-label="往上挪" :disabled="i === 0" @click="move(i, -1)"><Icon name="i-chev" style="transform: rotate(180deg)" /></button>
                <button class="icon-btn" type="button" aria-label="往下挪" :disabled="i === pins.length - 1" @click="move(i, 1)"><Icon name="i-chev" /></button>
              </span>
              <button class="btn sm" type="button" @click="remove(p.id, p.item.viewer.name)"><Icon name="i-x" />移出</button>
            </div>
          </TransitionGroup>
        </div>

        <div class="card">
          <div class="card-h"><h2><span class="hicon"><Icon name="i-gift" /></span>送礼记录</h2><span class="aside">{{ manual ? '点「加入名单」' : '点「加入名单」就会置顶' }}</span></div>
          <div class="gl-tools">
            <select v-model="sessId" class="sel" aria-label="场次"><option value="all">全部场次</option><option v-for="s in sessions" :key="s.id" :value="s.id">{{ sessLabel(s) }}</option></select>
            <input v-model.trim="q" class="inp" placeholder="观众名、UID、礼物名" aria-label="搜观众名、UID、礼物名" />
            <select v-model.number="minGold" class="sel amt" aria-label="金额"><option v-for="g in MIN_OPTIONS" :key="g" :value="g">{{ g ? `${g / 1000} 元以上` : '金额不限' }}</option></select>
          </div>
          <div v-if="!sessions.length" class="inline-hint">还没有直播记录</div>
          <div v-else-if="loading && !records.length" class="inline-hint">读取中…</div>
          <div v-else-if="!records.length" class="inline-hint">{{ q || minGold ? '没有符合的记录' : sessId === 'all' ? '还没有收到付费礼物、上舰或醒目留言' : '这一场没有收到付费礼物、上舰或醒目留言' }}</div>
          <div v-else class="gl-recs" :class="{ all: sessId === 'all' }">
            <div v-for="r in records" :key="r.eventId" class="gl-rec" :class="{ on: inList.has(r.eventId) }">
              <span class="t num">{{ sessId === 'all' ? dateTime(r.ts) : clock(r.ts) }}</span>
              <Avatar :name="r.viewer.name" :face="r.viewer.face" :guard="r.viewer.guard" :size="30" />
              <span class="who"><b>{{ r.viewer.name }}</b><span>{{ what(r) }}</span></span>
              <img v-if="r.gift?.img" class="gimg" :src="r.gift.img" alt="" referrerpolicy="no-referrer" /><span v-else class="gimg" />
              <span class="v num">{{ battery(r.value) }}</span>
              <button v-if="inList.has(r.eventId)" class="btn sm on" type="button" title="已在名单里，点一下移出" @click="remove(inList.get(r.eventId)!, r.viewer.name)"><Icon name="i-check" />在名单里</button>
              <button v-else class="btn sm" type="button" :disabled="pins.length >= pinMax" @click="add(r)"><Icon name="i-plus" />加入名单</button>
            </div>
          </div>
          <p v-if="more" class="inline-hint" style="margin: 10px 0 0">只列出了最新的 {{ records.length }} 条，更早的请加上观众名或金额缩小范围。</p>
        </div>
        </template>
        <SourceCard name="送礼名单" :path="o.giftsPath" :secret="o.key" :w="srcWh.w" :h="srcWh.h" />
      </div>

      <!-- 预览和外观 -->
      <div class="card">
        <div class="card-h"><h2><span class="hicon"><Icon name="i-eye" /></span>预览</h2><span class="aside">只在这里显示</span></div>
        <div class="wp-pv"><GiftsPreview ref="pv" :key="`g${o.id}`" :config="cfg" /></div>
        <div class="prev-tools"><button class="btn" :disabled="!o.giftsEnabled" :title="manual ? '在名单最后加一条测试记录，看看新加一条时的样子' : ''" @click="pv?.test()"><i style="background: #FF9D00" />测试一条（只在这里显示）</button></div>
        <h3 class="wp-sub">外观</h3>
        <div class="srows">
          <div class="srow">
            <span class="lb">样式</span>
            <div class="ctl">
              <span class="seg wrap" role="group" aria-label="样式">
                <button v-for="x in LOOKS" :key="x.value" :aria-pressed="v.giftsLook === x.value" @click="look.set({ giftsLook: x.value })">{{ x.label }}</button>
              </span>
              <span class="hint">{{ LOOKS.find((x) => x.value === v.giftsLook)?.hint }}</span>
            </div>
          </div>
          <div v-if="v.giftsLook === 'diffuse'" class="srow">
            <span class="lb">透明度</span>
            <div class="ctl">
              <div class="line">
                <input id="gl-alpha" class="alpha" type="range" :min="GIFTS_ALPHA_MIN" :max="GIFTS_ALPHA_MAX" step="5" :value="v.giftsAlpha" aria-label="弥散卡片的透明度" @input="look.set({ giftsAlpha: Number(($event.target as HTMLInputElement).value) })" />
                <output for="gl-alpha" class="alpha-v">{{ v.giftsAlpha }}%</output>
              </div>
              <span class="hint">画面很亮或很花时调低一点，字更清楚</span>
            </div>
          </div>
          <div class="srow">
            <span class="lb">滚法</span>
            <div class="ctl">
              <span class="seg wrap" role="group" aria-label="滚法">
                <button v-for="x in MOTIONS" :key="x.value" :aria-pressed="v.giftsMotion === x.value" @click="look.set({ giftsMotion: x.value })">{{ x.label }}</button>
              </span>
              <span class="hint">{{ MOTIONS.find((x) => x.value === v.giftsMotion)?.hint }}<template v-if="v.giftsMotion === 'marquee'">；浏览器源宽高填 {{ whOf(v) }}</template></span>
              <span v-if="v.giftsMotion === 'marquee' && f.pinTop && !manual" class="hint warn">跑马灯只有一行：置顶的记录不会单独固定在前面</span>
            </div>
          </div>
          <div class="srow">
            <span class="lb">标题</span>
            <div class="ctl">
              <div class="line">
                <input :key="`t${o.id}`" class="inp title" :value="v.giftsTitle" :maxlength="GIFTS_TITLE_MAX" placeholder="不加标题就留空" aria-label="名单标题" @input="look.set({ giftsTitle: ($event.target as HTMLInputElement).value })" />
                <button v-for="t in titleIdeas.filter((x) => x !== v.giftsTitle)" :key="t" class="btn sm" type="button" @click="look.set({ giftsTitle: t })">用「{{ t }}」</button>
              </div>
            </div>
          </div>
          <div class="srow">
            <span class="lb">速度</span>
            <div class="ctl">
              <span class="seg" role="group" aria-label="速度">
                <button v-for="s in SPEED" :key="s.value" :aria-pressed="v.giftsSpeed === s.value" @click="look.set({ giftsSpeed: s.value })">{{ s.label }}</button>
              </span>
              <span class="hint">{{ speedHint(v.giftsMotion, v.giftsSpeed) }}</span>
            </div>
          </div>
          <div class="srow">
            <span class="lb">对齐</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="对齐">
                <button :aria-pressed="v.giftsSide === 'left'" @click="look.set({ giftsSide: 'left' })">靠左</button>
                <button :aria-pressed="v.giftsSide === 'right'" @click="look.set({ giftsSide: 'right' })">靠右</button>
              </span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">字号</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="字号">
                <button :aria-pressed="v.giftsSize === 'normal'" @click="look.set({ giftsSize: 'normal' })">标准</button>
                <button :aria-pressed="v.giftsSize === 'large'" @click="look.set({ giftsSize: 'large' })">大</button>
              </span>
            </div></div>
          </div>
          <div v-if="v.giftsMotion !== 'marquee'" class="srow">
            <span class="lb">一屏几条</span>
            <div class="ctl"><div class="line">
              <span class="stepper">
                <button type="button" aria-label="少一条" :disabled="v.giftsMax <= 1" @click="setMax(v.giftsMax - 1)">−</button>
                <input :key="`${o.id}-${v.giftsMax}`" class="inp num" type="number" min="1" :max="GIFTS_MAX_LIMIT" :value="v.giftsMax" aria-label="一屏显示几条" @change="(e) => setMax(Number((e.target as HTMLInputElement).value))" />
                <button type="button" aria-label="多一条" :disabled="v.giftsMax >= GIFTS_MAX_LIMIT" @click="setMax(v.giftsMax + 1)">+</button>
              </span>
              <span class="hint">浏览器源宽高填 {{ whOf(v) }}</span>
            </div></div>
          </div>
        </div>
        <DraftBar :dirty="look.dirty.value" :saving="look.saving.value" @save="look.commit" @discard="look.reset" />
      </div>
    </div>
  </section>
</template>

<style scoped>

/* 名单放什么：两个大选项 */
.gl-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 6px; }
@media (max-width: 640px) { .gl-modes { grid-template-columns: 1fr; } }
.gl-mode { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 16px; border-radius: var(--r-md); border: 1.5px solid var(--line); background: var(--l2); color: var(--t1); font: inherit; text-align: left; cursor: pointer; }
.gl-mode:hover { border-color: var(--line-strong); }
.gl-mode[aria-checked='true'] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-ring); }
.gl-mode b { display: flex; align-items: center; gap: 8px; font-size: var(--fs-body); font-weight: 600; }
.gl-mode b svg { width: 16px; height: 16px; color: var(--accent); }
.gl-mode span { font-size: var(--fs-sec); color: var(--t2); line-height: 1.6; }
.srow .line .gap { width: 12px; }
.srow .line > span:not(.seg):not(.hint):not(.gap) { font-size: var(--fs-sec); color: var(--t2); }

/* 现在画面上显示 */
.gl-sum { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--ok-soft, rgba(52, 199, 123, .1)); color: var(--t1); font-size: var(--fs-sec); line-height: 1.6; }
.gl-sum svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: var(--ok, #34C77B); }
.gl-sum b { font-weight: 600; }
.gl-sum.bad { background: rgba(214, 69, 69, .1); }
.gl-sum.bad svg { color: #D64545; }

.gl-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.gl-tools .inp { width: 180px; height: 32px; }
.gl-tools .sel { height: 32px; min-width: 240px; max-width: 100%; }
.gl-tools .sel.amt { min-width: 0; width: 120px; }
.alpha { width: min(240px, 100%); accent-color: var(--accent); }
.alpha-v { min-width: 3em; font-variant-numeric: tabular-nums; font-size: var(--fs-sec); color: var(--t1); }
.inp.dt { width: 200px; height: 32px; }
/* 手动时有两个标题建议：输入框先缩一点，一行放得下 */
.inp.title { flex: 1 1 120px; max-width: 200px; height: 32px; }
.hint.warn { color: var(--gov); }
.gl-recs.all .gl-rec { grid-template-columns: 112px 30px minmax(0, 1fr) 34px 96px 100px; }
.gl-recs { display: flex; flex-direction: column; max-height: 560px; overflow: auto; margin: 0 -6px; }
.gl-rec { display: grid; grid-template-columns: 62px 30px minmax(0, 1fr) 34px 96px 100px; align-items: center; gap: 10px; padding: 8px 6px; border-radius: var(--r-sm); font-size: var(--fs-sec); }
.gl-rec + .gl-rec { border-top: 1px solid var(--line); }
.gl-rec:hover { background: var(--hover); }
.gl-rec.on { background: var(--accent-soft); }
.gl-rec .t { color: var(--t3); font-size: var(--fs-cap); }
.gl-rec .who { display: flex; flex-direction: column; min-width: 0; }
.gl-rec .who b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-rec .who span { color: var(--t2); font-size: var(--fs-cap); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-rec .gimg { width: 32px; height: 32px; object-fit: contain; }
.gl-rec .v { color: var(--t2); font-size: var(--fs-cap); text-align: right; white-space: nowrap; }
.gl-rec .ord { display: flex; gap: 2px; }
.gl-rec .btn.sm { height: 28px; padding: 0 10px; font-size: var(--fs-sec); justify-content: center; }
.gl-rec .btn.on { color: var(--accent); }
.gl-recs .gl-rec.pin { grid-template-columns: 44px 112px 30px minmax(0, 1fr) 34px 64px 72px; }
.gl-rec.pin.dragging { opacity: .45; }
.gl-rec.pin.dropto { box-shadow: inset 0 2px 0 0 var(--accent); }
</style>
