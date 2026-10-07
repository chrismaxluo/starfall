<script setup lang="ts">
// 触发规则：进场 / 专属用户 / 弹幕 / 礼物 / 上舰分标签设置；每条规则一行，开关、条件、特效、冷却各占一列对齐
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MEDAL_LEVEL_MAX } from '@starfall/shared';
import Avatar from '../components/Avatar.vue';
import CdPick from '../components/CdPick.vue';
import EffectPicker from '../components/EffectPicker.vue';
import Icon from '../components/Icon.vue';
import HonorMedal from '../components/HonorMedal.vue';
import IdTag from '../components/IdTag.vue';
import Medal from '../components/Medal.vue';
import RowMenu from '../components/RowMenu.vue';
import type { MenuItem } from '../components/RowMenu.vue';
import Seg from '../components/Seg.vue';
import SimDrawer from '../components/SimDrawer.vue';
import Switch from '../components/Switch.vue';
import RulesDanmu from '../components/RulesDanmu.vue';
import RulesGift from '../components/RulesGift.vue';
import RulesGuard from '../components/RulesGuard.vue';
import type { PreviewRequest } from '../lib/preview.ts';
import { ApiError, del, get, post, put } from '../lib/api.ts';
import { today } from '../lib/format.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity, SampleViewer } from '../lib/identity.ts';
import { go, route } from '../lib/route.ts';
import { effectById, refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { EnterBase, ExclusiveDto, MedalBand, Tier, TierRule, Viewer } from '../lib/types.ts';
import { pushEsc } from '../lib/esc.ts';

type Ev = 'enter' | 'exclusive' | 'danmu' | 'gift' | 'guard';
const EVS: Ev[] = ['enter', 'exclusive', 'danmu', 'gift', 'guard'];
const ev = ref<Ev>(EVS.includes(route.value.sub as Ev) ? (route.value.sub as Ev) : 'enter');
/** 每个标签的「怎么判断」展开了没有 */
const help = ref(false);
watch(ev, () => (help.value = false));
const simOpen = ref(false);
const flashKey = ref<string | null>(null);

const rules = computed(() => state.enter);
const once = computed(() => rules.value?.cooldownMode === 'oncePerLive');
const bands = computed(() => [...(rules.value?.bands ?? [])].sort((a, b) => b.fromLevel - a.fromLevel));
function bandLabel(i: number): string {
  const b = bands.value[i]!;
  if (i === 0) return `${b.fromLevel} 级及以上`;
  const to = bands.value[i - 1]!.fromLevel - 1;
  return to === b.fromLevel ? `${b.fromLevel} 级` : `${b.fromLevel} – ${to} 级`;
}

/** 保存档位、分档、冷却方式（每次修改立即保存） */
async function save(msg: string, undo?: () => Promise<unknown>): Promise<void> {
  if (!rules.value) return;
  try {
    state.enter = await put<EnterBase>('/api/rules/enter', rules.value);
    if (undo) undoable(msg, undo);
    else toast(msg);
    void refreshEffects();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
    await refreshRules();
  }
}
function flash(key: string): void {
  flashKey.value = key;
  setTimeout(() => flashKey.value === key && (flashKey.value = null), 1800);
}

/** 各表的列宽：开关 | 条件 | 特效 | 冷却 | 操作 */
const ENTER_COLS = '44px minmax(140px, 200px) minmax(190px, 300px) minmax(0, 1fr) 68px';
const EX_COLS = '44px minmax(150px, 1.2fr) minmax(110px, 1fr) minmax(180px, 260px) 120px 96px 68px';
const GUARDS: Array<{ tier: Tier; cond: string }> = [
  { tier: 'gov', cond: '总督' },
  { tier: 'adm', cond: '提督' },
  { tier: 'cap', cond: '舰长' },
];
function tierSample(t: Tier): SampleViewer {
  return SAMPLES[t as Identity];
}
function preview(effectId: number | null, viewer: SampleViewer, label: string, kind: PreviewRequest['kind'] = 'enter', vars?: PreviewRequest['vars']): void {
  if (!effectId) return toast('这条规则还没有选特效', 'info');
  ui.preview = { effectId, viewer, label, ...(kind ? { kind } : {}), ...(vars ? { vars } : {}) };
}
const onPreview = (p: PreviewRequest) => preview(p.effectId, p.viewer, p.label, p.kind, p.vars);
/** 打开素材设置调整这条规则用的特效 */
function editEffect(effectId: number | null): void {
  if (!effectId) return toast('这条规则还没有选特效', 'info');
  ui.editorId = effectId;
}
/** 进场每一行的「⋯」 */
const tierMenu = (effectId: number | null): MenuItem[] => [{ icon: 'i-pen', label: '调整这个特效（素材设置）', run: () => editEffect(effectId) }];

function onTierEffect(t: Tier, r: TierRule, label: string): void {
  flash(t);
  void save(`${label}进场改为播放「${effectById(r.effectId)?.name ?? ''}」`);
}
/** 冷却改了之后的提示 */
const cdMsg = (label: string, v: number) => (v === 0 ? `${label}：每次进场都播放` : `${label}：同一个人 ${v >= 60 && v % 60 === 0 ? `${v / 60} 小时` : `${v} 分钟`}内只播一次`);
const TIER_OFF: Record<string, string> = {
  gov: '已关闭：总督会按房管、粉丝牌或其他观众处理',
  adm: '已关闭：提督会按房管、粉丝牌或其他观众处理',
  cap: '已关闭：舰长会按房管、粉丝牌或其他观众处理',
  mod: '已关闭：房管会按粉丝牌或其他观众处理',
  nor: '已关闭：普通观众进场不播放特效。直播间人多时建议保持关闭，免得刷屏',
};

// ---------- 标签上的数量：开着几条 / 一共几条 ----------
const counts = computed<Record<Ev, string>>(() => {
  const r = rules.value;
  const tiers = r ? Object.values(r.tiers) : [];
  const enterAll = tiers.length + (r?.bands.length ?? 0);
  const enterOn = tiers.filter((t) => t.enabled).length + (r?.bands.filter((b) => b.enabled).length ?? 0);
  const g = state.gift;
  const giftAll = (g?.specific.length ?? 0) + (g?.bands.length ?? 0);
  const giftOn = (g?.specific.filter((x) => x.enabled).length ?? 0) + (g?.bands.filter((x) => x.enabled).length ?? 0);
  const guardOn = state.guard ? (['gov', 'adm', 'cap'] as const).filter((k) => state.guard![k].enabled).length : 0;
  return {
    enter: `${enterOn}/${enterAll}`,
    exclusive: String(state.exclusives.length),
    danmu: state.danmu.length ? `${state.danmu.filter((d) => d.enabled).length}/${state.danmu.length}` : '0',
    gift: `${giftOn}/${giftAll}`,
    guard: `${guardOn}/3`,
  };
});
const TABS: Array<{ v: Ev; icon: string; name: string }> = [
  { v: 'enter', icon: 'i-users', name: '进场' },
  { v: 'exclusive', icon: 'i-user', name: '专属用户' },
  { v: 'danmu', icon: 'i-chat', name: '弹幕' },
  { v: 'gift', icon: 'i-gift', name: '礼物' },
  { v: 'guard', icon: 'i-anchor', name: '上舰' },
];
/** 换标签时地址跟着变（刷新后停在同一个标签） */
function pick(t: Ev): void {
  ev.value = t;
  go('rules', t);
}

// ---------- 粉丝牌分档 ----------
const addLevel = ref<number | null>(null);
/** 「＋ 加一段」展开输入框 */
const adding = ref(false);
const addMsg = ref<{ text: string; err: boolean }>({ text: '分出来的新一段先沿用原来的特效', err: false });
function addBand(): void {
  const v = Number(addLevel.value);
  if (!rules.value) return;
  if (!(v >= 2 && v <= MEDAL_LEVEL_MAX) || !Number.isInteger(v)) return void (addMsg.value = { text: `请输入 2 – ${MEDAL_LEVEL_MAX} 之间的等级`, err: true });
  if (rules.value.bands.some((b) => b.fromLevel === v)) return void (addMsg.value = { text: `已经在 ${v} 级处分过段了`, err: true });
  const parent = bands.value.find((b) => b.fromLevel < v) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromLevel: v, effectId: parent.effectId, cooldownMin: parent.cooldownMin, enabled: parent.enabled });
  addLevel.value = null;
  adding.value = false;
  addMsg.value = { text: '分出来的新一段先沿用原来的特效', err: false };
  flash(`band${v}`);
  void save(`已在 ${v} 级处分出一段`);
}
function removeBand(b: MedalBand, i: number): void {
  if (!rules.value || rules.value.bands.length <= 1) return;
  const label = bandLabel(i);
  const before = rules.value.bands.map((x) => ({ ...x }));
  rules.value.bands = rules.value.bands.filter((x) => x.fromLevel !== b.fromLevel);
  void save(`已删除 ${label}这一段，这些等级并入相邻的一段`, async () => {
    if (!rules.value) return;
    rules.value.bands = before;
    await save(`已恢复 ${label}这一段`);
  });
}

// ---------- 专属用户 ----------
const exQ = ref('');
const exList = computed(() => state.exclusives.filter((x) => !exQ.value || (x.name ?? '').includes(exQ.value) || String(x.uid).includes(exQ.value)));
const flashUid = ref<number | null>(null);
const draft = ref<null | { uid: string; busy: boolean; msg: string; ok: boolean; found: { uid: number; name: string; face: string; guard?: number } | null; effectId: number | null; cooldownMin: number }>(null);
const showRecent = ref(false);
const recentViewers = computed(() => {
  const seen = new Set<number>();
  const out: Viewer[] = [];
  for (const e of state.feed) {
    if (e.kind !== 'enter' || e.uid <= 0 || seen.has(e.uid)) continue;
    seen.add(e.uid);
    out.push(e.viewer);
  }
  return out.slice(0, 20);
});
function viewerOf(uid: number): Viewer | undefined {
  return state.feed.find((e) => e.uid === uid)?.viewer;
}
function startAdd(uid?: number): void {
  ev.value = 'exclusive';
  draft.value = { uid: uid ? String(uid) : '', busy: false, msg: '', ok: false, found: null, effectId: rules.value?.tiers.gov.effectId ?? null, cooldownMin: 10 };
  showRecent.value = false;
  if (uid) void lookup();
  else void nextTick(() => document.getElementById('exUid')?.focus());
}
function locate(uid: number): void {
  flashUid.value = uid;
  setTimeout(() => flashUid.value === uid && (flashUid.value = null), 1800);
}
async function lookup(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const v = d.uid.trim();
  if (!/^\d{1,16}$/.test(v)) return void Object.assign(d, { msg: 'UID 只能是数字', ok: false, found: null });
  const uid = Number(v);
  if (state.exclusives.some((x) => x.uid === uid)) {
    draft.value = null;
    locate(uid);
    return toast('TA 已经在专属列表里了，已为你定位', 'info');
  }
  Object.assign(d, { busy: true, msg: '', found: null });
  try {
    const card = await get<{ uid: number; name: string; face: string }>(`/api/viewers/${uid}`);
    Object.assign(d, { found: card, msg: `找到用户：${card.name}`, ok: true });
  } catch (e) {
    // 查不到昵称也可以添加（例如 B站接口暂时不可用）
    Object.assign(d, { found: e instanceof ApiError && e.status === 404 ? null : { uid, name: `UID ${uid}`, face: '' }, msg: e instanceof Error ? e.message : String(e), ok: false });
  } finally {
    d.busy = false;
  }
}
async function addExclusive(): Promise<void> {
  const d = draft.value;
  if (!d?.found || !d.effectId) return toast('请先选择素材', 'info');
  const r = await attempt(() => post<ExclusiveDto>('/api/rules/exclusive', { uid: d.found!.uid, effectId: d.effectId, cooldownMin: d.cooldownMin, until: null, enabled: true }), `已添加专属用户：${d.found.name}`);
  if (!r) return;
  draft.value = null;
  await refreshRules();
  void refreshEffects();
  locate(r.uid);
}
async function updateEx(x: ExclusiveDto, patch: Partial<ExclusiveDto>, msg: string): Promise<void> {
  const r = await attempt(() => put<ExclusiveDto>(`/api/rules/exclusive/${x.uid}`, patch), msg);
  if (r) Object.assign(x, r);
  else await refreshRules();
  void refreshEffects();
}
async function copyUid(uid: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(String(uid));
    toast(`已复制 UID ${uid}`);
  } catch {
    toast(`UID：${uid}`, 'info');
  }
}
function showLogs(uid: number): void {
  ui.logQuery = String(uid);
  go('logs');
}
const exMenu = (x: ExclusiveDto): Array<MenuItem | null> => [
  { icon: 'i-list', label: '查看 TA 的事件记录', run: () => showLogs(x.uid) },
  { icon: 'i-copy', label: '复制 UID', run: () => void copyUid(x.uid) },
  { icon: 'i-pen', label: '调整这个特效（素材设置）', run: () => editEffect(x.effectId) },
  null,
  { icon: 'i-trash', label: '移除（可以撤销）', danger: true, run: () => void removeEx(x) },
];
async function removeEx(x: ExclusiveDto): Promise<void> {
  if (await attempt(() => del(`/api/rules/exclusive/${x.uid}`))) {
    state.exclusives = state.exclusives.filter((y) => y.uid !== x.uid);
    void refreshEffects();
    undoable(`已移除：${x.name ?? x.uid}，之后按身份的规则播放`, async () => {
      await post('/api/rules/exclusive', { uid: x.uid, effectId: x.effectId, cooldownMin: x.cooldownMin, until: x.until, enabled: x.enabled });
      await refreshRules();
      void refreshEffects();
      toast(`已恢复 ${x.name ?? x.uid} 的专属特效`);
    });
  }
}
// 有效期
const datePop = ref<{ x: ExclusiveDto; left: number; top: number; value: string } | null>(null);
let offDateEsc: (() => void) | null = null;
watch(
  () => datePop.value !== null,
  (on) => {
    offDateEsc?.();
    offDateEsc = on ? pushEsc(() => (datePop.value = null)) : null;
  },
);
function openDate(e: MouseEvent, x: ExclusiveDto): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  datePop.value = { x, left: Math.min(r.left, innerWidth - 272), top: Math.min(r.bottom + 6, innerHeight - 190), value: x.until ?? '' };
}
async function setUntil(v: string | null): Promise<void> {
  const p = datePop.value;
  datePop.value = null;
  if (!p) return;
  await updateEx(p.x, { until: v || null }, v ? `有效期至 ${v}` : '已设为长期');
}
// 每分钟更新一次：直播跨过零点后，"已过期"的标记跟着变
const todayStr = ref(today());
const todayTimer = setInterval(() => (todayStr.value = today()), 60_000);
onBeforeUnmount(() => clearInterval(todayTimer));

watch(
  () => route.value.sub,
  (sub) => {
    if (EVS.includes(sub as Ev)) ev.value = sub as Ev;
  },
);

// 从其他页面跳过来添加（例如事件记录里的"设为专属"）
watch(
  () => state.pendingExclusive,
  (uid) => {
    if (uid === null) return;
    state.pendingExclusive = null;
    startAdd(uid);
  },
  { immediate: true },
);

async function setMode(v: 'minutes' | 'oncePerLive'): Promise<void> {
  if (!rules.value) return;
  rules.value.cooldownMode = v;
  await save(v === 'oncePerLive' ? '已改为：每场直播每人只播一次' : '已改为：按时间，每条规则单独设置');
}

onMounted(() => void refreshRules());
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>触发规则</h1>
        <p>谁、做了什么时，播放哪个特效。改完马上生效</p>
      </div>
      <div class="actions"><button class="btn" @click="simOpen = true"><Icon name="i-bolt" />模拟一下</button></div>
    </div>

    <div class="rtabs" role="tablist" aria-label="触发事件">
      <button v-for="t in TABS" :key="t.v" class="rtab" role="tab" :aria-selected="ev === t.v" @click="pick(t.v)"><Icon :name="t.icon" />{{ t.name }}<span class="cnt">{{ counts[t.v] }}</span></button>
    </div>

    <!-- ================= 进场 ================= -->
    <template v-if="ev === 'enter' && rules">
      <div class="rtool">
        <span class="say">观众进场时，从上往下找第一条符合的，播放对应的特效。<button class="linkish" :aria-expanded="help" @click="help = !help"><Icon name="i-info" />怎么判断</button></span>
        <span class="sp" />
        <span class="set">不重复播放<Seg :model-value="rules.cooldownMode" label="不重复播放的方式" :options="[{ value: 'minutes', label: '按时间' }, { value: 'oncePerLive', label: '每场只播一次' }]" @change="setMode" /></span>
      </div>
      <div v-if="help" class="rhelp">
        判断顺序：<span class="flow"><span>专属用户</span>→<span>大航海</span>→<span>房管</span>→<span>粉丝牌</span>→<span>其他观众</span></span>，用第一个符合的。<br />
        一个人同时是舰长和房管，按<b>舰长</b>算；粉丝牌只算<b>本直播间</b>的牌子。关掉某一条，这些人会往下按后面的规则处理。<br />
        <b>不重复播放</b>：「按时间」时每条规则自己设多久内只播一次；「每场只播一次」时同一个人一场直播只播一次，下一场重新算。
      </div>

      <div class="rt">
        <div class="excl-row"><Icon name="i-user" /><span v-if="state.exclusives.length"><b>专属用户 {{ state.exclusives.length }} 人</b>最优先，各自用自己的特效</span><span v-else>想给某几位观众单独指定特效？用<b>专属用户</b></span><button class="linkish" @click="pick('exclusive')">{{ state.exclusives.length ? '去设置 →' : '去添加 →' }}</button></div>
        <div class="rt-h" :style="{ gridTemplateColumns: ENTER_COLS }"><span>开关</span><span>身份</span><span>播放的特效</span><span>{{ once ? '不重复播放' : '同一个人多久内只播一次' }}</span><span>操作</span></div>

        <div class="rt-g"><b>大航海</b><span>本直播间的总督、提督、舰长</span></div>
        <div v-for="g in GUARDS" :key="g.tier" class="rt-r" :class="{ off: !rules.tiers[g.tier].enabled, flash: flashKey === g.tier }" :style="{ gridTemplateColumns: ENTER_COLS }" :title="rules.tiers[g.tier].enabled ? undefined : TIER_OFF[g.tier]">
          <div class="c-sw"><Switch v-model="rules.tiers[g.tier].enabled" :label="`${g.cond}进场特效`" @change="(v) => save(v ? `已打开${g.cond}进场特效` : `已关闭${g.cond}进场特效，TA 们会按房管、粉丝牌或其他观众处理`)" /></div>
          <div class="c-who"><IdTag :identity="g.tier" /></div>
          <div class="c-eff"><EffectPicker v-model="rules.tiers[g.tier].effectId" @change="onTierEffect(g.tier, rules.tiers[g.tier], g.cond)" /></div>
          <div class="c-cd"><CdPick v-if="!once" v-model="rules.tiers[g.tier].cooldownMin" @change="(v) => save(cdMsg(g.cond, v))" /><template v-else>每场只播一次</template></div>
          <div class="c-act"><button class="icon-btn play" :aria-label="`预览${g.cond}进场`" :title="`预览${g.cond}进场`" @click="preview(rules.tiers[g.tier].effectId, tierSample(g.tier), `${g.cond}进场`)"><svg><use href="#i-play" /></svg></button><RowMenu :items="tierMenu(rules.tiers[g.tier].effectId)" :label="`${g.cond}进场：更多操作`" /></div>
        </div>

        <div class="rt-g"><b>房管</b><span>本直播间的房管</span></div>
        <div class="rt-r" :class="{ off: !rules.tiers.mod.enabled, flash: flashKey === 'mod' }" :style="{ gridTemplateColumns: ENTER_COLS }" :title="rules.tiers.mod.enabled ? undefined : TIER_OFF.mod">
          <div class="c-sw"><Switch v-model="rules.tiers.mod.enabled" label="房管进场特效" @change="(v) => save(v ? '已打开房管进场特效' : '已关闭房管进场特效，房管会按粉丝牌或其他观众处理')" /></div>
          <div class="c-who"><IdTag identity="mod" /></div>
          <div class="c-eff"><EffectPicker v-model="rules.tiers.mod.effectId" @change="onTierEffect('mod', rules.tiers.mod, '房管')" /></div>
          <div class="c-cd"><CdPick v-if="!once" v-model="rules.tiers.mod.cooldownMin" @change="(v) => save(cdMsg('房管', v))" /><template v-else>每场只播一次</template></div>
          <div class="c-act"><button class="icon-btn play" aria-label="预览房管进场" title="预览房管进场" @click="preview(rules.tiers.mod.effectId, SAMPLES.mod, '房管进场')"><svg><use href="#i-play" /></svg></button><RowMenu :items="tierMenu(rules.tiers.mod.effectId)" label="房管进场：更多操作" /></div>
        </div>

        <div class="rt-g">
          <b>粉丝牌</b><span>只算本直播间的牌子，按等级分段，每一段放一种特效</span>
          <span class="r">
            <span v-if="adding" class="lvadd">在 <input v-model.number="addLevel" class="inp num" type="number" min="2" :max="MEDAL_LEVEL_MAX" placeholder="31" aria-label="从几级开始分一段" @keydown.enter="addBand" @keydown.esc="adding = false" /> 级处再分一段 <button class="btn" @click="addBand">分段</button><button class="linkish" style="color: var(--t3)" @click="adding = false">取消</button><span class="hint" :style="{ color: addMsg.err ? '#D64545' : '' }">{{ addMsg.text }}</span></span>
            <button v-else class="linkish" @click="adding = true"><Icon name="i-plus" style="width: 12px; height: 12px; vertical-align: -1px" /> 加一段</button>
          </span>
        </div>
        <div v-for="(b, i) in bands" :id="`band${b.fromLevel}`" :key="b.fromLevel" class="rt-r" :class="{ off: !b.enabled, flash: flashKey === `band${b.fromLevel}` }" :style="{ gridTemplateColumns: ENTER_COLS }" :title="b.enabled ? undefined : '已关闭：这些观众按其他观众处理'">
          <div class="c-sw"><Switch v-model="b.enabled" :label="`粉丝牌 ${bandLabel(i)}进场特效`" @change="(v) => save(v ? `已打开粉丝牌 ${bandLabel(i)}` : `已关闭粉丝牌 ${bandLabel(i)}，这些观众按其他观众处理`)" /></div>
          <div class="c-who"><Medal :level="b.fromLevel" /><span class="sub">{{ bandLabel(i) }}</span></div>
          <div class="c-eff"><EffectPicker v-model="b.effectId" @change="(flash(`band${b.fromLevel}`), save(`粉丝牌 ${bandLabel(i)}改为播放「${effectById(b.effectId)?.name ?? ''}」`))" /></div>
          <div class="c-cd"><CdPick v-if="!once" v-model="b.cooldownMin" @change="(v) => save(cdMsg(`粉丝牌 ${bandLabel(i)}`, v))" /><template v-else>每场只播一次</template></div>
          <div class="c-act">
            <button class="icon-btn play" :aria-label="`预览粉丝牌 ${bandLabel(i)}进场`" :title="`预览粉丝牌 ${bandLabel(i)}进场`" @click="preview(b.effectId, { ...SAMPLES.fan, medalLevel: b.fromLevel }, `粉丝牌 ${bandLabel(i)}进场`)"><svg><use href="#i-play" /></svg></button>
            <RowMenu :items="[...tierMenu(b.effectId), null, { icon: 'i-trash', label: '删掉这一段（并入相邻的一段）', danger: true, disabled: bands.length <= 1, run: () => removeBand(b, i) }]" :label="`粉丝牌 ${bandLabel(i)}：更多操作`" />
          </div>
        </div>

        <div class="rt-g"><b>其他观众</b><span>上面都不符合的人。直播间人多时建议关着，免得刷屏</span></div>
        <div class="rt-r" :class="{ off: !rules.tiers.nor.enabled, flash: flashKey === 'nor' }" :style="{ gridTemplateColumns: ENTER_COLS }" :title="rules.tiers.nor.enabled ? undefined : TIER_OFF.nor">
          <div class="c-sw"><Switch v-model="rules.tiers.nor.enabled" label="其他观众进场特效" @change="(v) => save(v ? '已打开其他观众进场特效' : '已关闭其他观众进场特效')" /></div>
          <div class="c-who"><IdTag identity="nor" /></div>
          <div class="c-eff"><EffectPicker v-model="rules.tiers.nor.effectId" @change="onTierEffect('nor', rules.tiers.nor, '其他观众')" /></div>
          <div class="c-cd"><CdPick v-if="!once" v-model="rules.tiers.nor.cooldownMin" @change="(v) => save(cdMsg('其他观众', v))" /><template v-else>每场只播一次</template></div>
          <div class="c-act"><button class="icon-btn play" aria-label="预览其他观众进场" title="预览其他观众进场" @click="preview(rules.tiers.nor.effectId, SAMPLES.nor, '其他观众进场')"><svg><use href="#i-play" /></svg></button><RowMenu :items="tierMenu(rules.tiers.nor.effectId)" label="其他观众进场：更多操作" /></div>
        </div>
      </div>
    </template>

    <!-- ================= 专属用户 ================= -->
    <template v-else-if="ev === 'exclusive'">
      <div class="rtool">
        <span class="say"><span>给某几位观众单独指定进场特效，比按身份的规则优先。只对<b style="color: var(--t1); font-weight: 500">进场</b>有效，礼物、弹幕、上舰按各自的规则。</span></span>
        <span class="sp" />
        <span v-if="state.exclusives.length > 5" class="s"><Icon name="i-search" /><input v-model.trim="exQ" class="inp" placeholder="搜索昵称或 UID" aria-label="搜索专属用户" /></span>
        <button class="btn primary" :disabled="!!draft" @click="startAdd()"><Icon name="i-plus" />添加专属用户</button>
      </div>
      <div v-if="draft" class="addbar">
        <div class="r1">
          <input id="exUid" v-model="draft.uid" class="inp num" inputmode="numeric" placeholder="输入 B站 UID，回车查询" aria-label="B站 UID" @keydown.enter="lookup" />
          <button class="btn" :disabled="draft.busy" @click="lookup"><span v-if="draft.busy" class="spin" />{{ draft.busy ? '查询中' : '查询' }}</button>
          <span style="color: var(--t3); font-size: 12.5px">或</span>
          <button class="linkish" @click="showRecent = !showRecent">从最近进场的观众里选</button>
          <button class="icon-btn" style="margin-left: auto; box-shadow: none" aria-label="取消添加" @click="draft = null"><Icon name="i-x" /></button>
        </div>
        <div v-if="showRecent" class="picker">
          <label v-for="v in recentViewers" :key="v.uid" :style="state.exclusives.some((x) => x.uid === v.uid) ? 'opacity:.5' : ''">
            <input type="radio" name="expk" :disabled="state.exclusives.some((x) => x.uid === v.uid)" @change="((draft!.uid = String(v.uid)), (showRecent = false), lookup())" />
            <Avatar :name="v.name" :face="v.face" :guard="v.guard" />{{ v.name }}<span class="ids"><HonorMedal :level="v.honor" /><IdTag :viewer="v" /></span><span class="uid num">{{ state.exclusives.some((x) => x.uid === v.uid) ? '已是专属' : v.uid }}</span>
          </label>
          <div v-if="!recentViewers.length" style="padding: 10px; color: var(--t3); font-size: 12.5px">还没有进场记录，开播后这里会列出最近进场的观众</div>
        </div>
        <div v-if="draft.msg" class="lookup" :class="{ ok: draft.ok }">{{ draft.msg }}</div>
        <div v-if="draft.found" class="found">
          <span class="who"><Avatar :name="draft.found.name" :face="draft.found.face" :guard="draft.found.guard" />{{ draft.found.name }}</span>
          <span class="num" style="font-size: 12px; color: var(--t3)">UID {{ draft.found.uid }}</span>
          <EffectPicker v-model="draft.effectId" />
          <CdPick v-model="draft.cooldownMin" />
          <button class="btn primary" style="margin-left: auto" @click="addExclusive">添加</button>
        </div>
      </div>
      <div class="rt">
        <div class="rt-h" :style="{ gridTemplateColumns: EX_COLS }"><span>开关</span><span>观众</span><span>身份</span><span>专属特效</span><span>{{ once ? '不重复播放' : '多久内只播一次' }}</span><span>有效期</span><span>操作</span></div>
        <div v-for="x in exList" :key="x.uid" class="rt-r" :class="{ off: !x.enabled, flash: flashUid === x.uid }" :style="{ gridTemplateColumns: EX_COLS }">
          <div class="c-sw"><Switch v-model="x.enabled" :label="`启用 ${x.name ?? x.uid}`" @change="(v) => updateEx(x, { enabled: v }, v ? '已启用' : '已停用，TA 会按身份的规则播放')" /></div>
          <div class="c-who"><Avatar :name="x.name ?? String(x.uid)" :face="x.face" :guard="x.guard" /><span class="nm"><b>{{ x.name ?? '（昵称未知）' }}</b><span class="uid">UID {{ x.uid }}</span></span></div>
          <div class="c-who"><template v-if="viewerOf(x.uid) || x.honor"><HonorMedal :level="viewerOf(x.uid)?.honor || x.honor" /><IdTag v-if="viewerOf(x.uid)" :viewer="viewerOf(x.uid)!" /></template><span v-else class="sub">—</span></div>
          <div class="c-eff"><EffectPicker v-model="x.effectId" @change="(id) => updateEx(x, { effectId: id }, `${x.name ?? x.uid} 的专属特效改为「${effectById(id)?.name}」`)" /></div>
          <div class="c-cd"><CdPick v-if="!once" v-model="x.cooldownMin" @change="(v) => updateEx(x, { cooldownMin: v }, cdMsg(x.name ?? String(x.uid), v))" /><template v-else>每场只播一次</template></div>
          <div class="c-cd"><button class="untilb" :class="x.until ? (x.until < todayStr ? 'expired' : 'set') : ''" :title="x.until ? '到期后自动停用' : '一直有效'" @click.stop="(e) => openDate(e, x)">{{ x.until ? `${x.until < todayStr ? '已过期 ' : '至 '}${x.until.slice(5)}` : '长期' }}</button></div>
          <div class="c-act"><button class="icon-btn play" aria-label="预览" title="预览" @click="preview(x.effectId, { name: x.name ?? '专属观众', guard: 0, isMod: false, medalLevel: null }, x.name ?? String(x.uid))"><svg><use href="#i-play" /></svg></button><RowMenu :items="exMenu(x)" :label="`${x.name ?? x.uid}：更多操作`" /></div>
        </div>
        <div v-if="!exList.length" class="rt-empty">{{ state.exclusives.length ? '没有匹配的专属用户' : '还没有专属用户。点右上角「添加专属用户」，或者在总览的实时动态里点某个观众' }}</div>
      </div>
      <p v-if="state.exclusives.length" class="rt-note">在总览的实时动态里点某个观众，也能直接设置专属特效。</p>
    </template>

    <RulesDanmu v-else-if="ev === 'danmu'" v-model:help="help" @preview="onPreview" />
    <RulesGift v-else-if="ev === 'gift'" v-model:help="help" @preview="onPreview" />
    <RulesGuard v-else-if="ev === 'guard'" @preview="onPreview" />

    <SimDrawer v-if="simOpen" :kind="ev === 'exclusive' ? 'enter' : ev" @close="simOpen = false" />

    <Teleport to="body">
      <template v-if="datePop">
        <div style="position: fixed; inset: 0; z-index: 45" @click="datePop = null" />
        <div class="datepop" :style="{ left: `${datePop.left}px`, top: `${datePop.top}px` }">
          <b style="font-weight: 500">有效期</b><span style="color: var(--t3); font-size: 12px">到期后自动停用，改回按身份的规则播放（含当天）</span>
          <input v-model="datePop.value" class="inp" type="date" aria-label="截止日期" />
          <div class="row"><button class="btn" @click="setUntil(null)">设为长期</button><button class="btn primary" @click="setUntil(datePop.value)">确定</button></div>
        </div>
      </template>
    </Teleport>
  </section>
</template>
