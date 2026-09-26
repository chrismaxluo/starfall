<script setup lang="ts">
// 触发规则：四类事件（进场 / 弹幕 / 礼物 / 上舰）分开设置，每条规则写成一句话：谁、做了什么时，播放哪个特效
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import CdPick from '../components/CdPick.vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import EffectPicker from '../components/EffectPicker.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import Medal from '../components/Medal.vue';
import Seg from '../components/Seg.vue';
import SimDrawer from '../components/SimDrawer.vue';
import Switch from '../components/Switch.vue';
import RulesDanmu from '../components/RulesDanmu.vue';
import RulesGift from '../components/RulesGift.vue';
import RulesGuard from '../components/RulesGuard.vue';
import type { PreviewRequest } from '../lib/preview.ts';
import { ApiError, del, get, post, put } from '../lib/api.ts';
import { today } from '../lib/format.ts';
import { SAMPLES, medalColors } from '../lib/identity.ts';
import type { Identity, SampleViewer } from '../lib/identity.ts';
import { route } from '../lib/route.ts';
import { effectById, refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { EnterBase, ExclusiveDto, MedalBand, Tier, TierRule, Viewer } from '../lib/types.ts';

type Ev = 'enter' | 'danmu' | 'gift' | 'guard';
const EVS: Ev[] = ['enter', 'danmu', 'gift', 'guard'];
const ev = ref<Ev>(EVS.includes(route.value.sub as Ev) ? (route.value.sub as Ev) : 'enter');
/** 专属用户列表展开（从别的页面跳过来添加时自动展开） */
const showEx = ref(route.value.sub === 'exclusive');
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
async function save(msg: string): Promise<void> {
  if (!rules.value) return;
  try {
    state.enter = await put<EnterBase>('/api/rules/enter', rules.value);
    toast(msg);
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

function onTierEffect(t: Tier, r: TierRule, label: string): void {
  flash(t);
  void save(`${label}进场改为播放「${effectById(r.effectId)?.name ?? ''}」`);
}
/** 冷却改了之后的提示 */
const cdMsg = (label: string, v: number) => (v === 0 ? `${label}：每次进场都播放` : `${label}：同一个人 ${v >= 60 && v % 60 === 0 ? `${v / 60} 小时` : `${v} 分钟`}内不重复`);
const TIER_OFF: Record<string, string> = {
  guard: '已关闭：TA 们会按房管、粉丝牌或其他观众处理',
  mod: '已关闭：房管会按粉丝牌或其他观众处理',
  nor: '已关闭：普通观众进场不播放特效。直播间人多时建议保持关闭，免得刷屏',
};

// ---------- 标签上的数量 ----------
const counts = computed(() => {
  const r = rules.value;
  const tiers = r ? Object.values(r.tiers) : [];
  const enterAll = tiers.length + (r?.bands.length ?? 0);
  const enterOn = tiers.filter((t) => t.enabled).length + (r?.bands.filter((b) => b.enabled).length ?? 0);
  const g = state.gift;
  const giftAll = (g?.specific.length ?? 0) + (g?.bands.length ?? 0);
  const giftOn = (g?.specific.filter((x) => x.enabled).length ?? 0) + (g?.bands.filter((x) => x.enabled).length ?? 0);
  const guardOn = state.guard ? (['gov', 'adm', 'cap'] as const).filter((k) => state.guard![k].enabled).length : 0;
  return {
    enter: `${enterAll} 条 · ${enterOn} 条开着${state.exclusives.length ? ` · 专属 ${state.exclusives.length} 人` : ''}`,
    danmu: state.danmu.length ? `${state.danmu.length} 条 · ${state.danmu.filter((d) => d.enabled).length} 条开着` : '还没有',
    gift: `${giftAll} 条 · ${giftOn} 条开着`,
    guard: `3 个等级 · ${guardOn} 个开着`,
  };
});
const TABS: Array<{ v: Ev; icon: string; name: string }> = [
  { v: 'enter', icon: 'i-users', name: '进场' },
  { v: 'danmu', icon: 'i-chat', name: '弹幕' },
  { v: 'gift', icon: 'i-gift', name: '礼物' },
  { v: 'guard', icon: 'i-star', name: '上舰' },
];

// ---------- 粉丝牌等级条 ----------
const levelBar = computed(() => {
  const asc = [...bands.value].reverse();
  return asc.map((b, i) => {
    const to = asc[i + 1] ? asc[i + 1]!.fromLevel - 1 : 60;
    const last = !asc[i + 1];
    return { b, from: b.fromLevel, to, label: last ? `${b.fromLevel} 级以上` : to === b.fromLevel ? `${b.fromLevel} 级` : `${b.fromLevel} – ${to} 级`, color: medalColors(b.fromLevel).level };
  });
});
function locateBand(level: number): void {
  flash(`band${level}`);
  document.getElementById(`band${level}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- 粉丝牌分档 ----------
const addLevel = ref<number | null>(null);
const addMsg = ref<{ text: string; err: boolean }>({ text: '分出来的新一段先沿用原来的特效', err: false });
function addBand(): void {
  const v = Number(addLevel.value);
  if (!rules.value) return;
  if (!(v >= 2 && v <= 60) || !Number.isInteger(v)) return void (addMsg.value = { text: '请输入 2 – 60 之间的等级', err: true });
  if (rules.value.bands.some((b) => b.fromLevel === v)) return void (addMsg.value = { text: `已经在 ${v} 级处分过段了`, err: true });
  const parent = bands.value.find((b) => b.fromLevel < v) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromLevel: v, effectId: parent.effectId, cooldownMin: parent.cooldownMin, enabled: parent.enabled });
  addLevel.value = null;
  addMsg.value = { text: '分出来的新一段先沿用原来的特效', err: false };
  flash(`band${v}`);
  void save(`已在 ${v} 级处分出一段`);
}
function removeBand(b: MedalBand, i: number): void {
  if (!rules.value || rules.value.bands.length <= 1) return;
  const label = bandLabel(i);
  rules.value.bands = rules.value.bands.filter((x) => x.fromLevel !== b.fromLevel);
  void save(`已删除 ${label}这一段，这些等级并入相邻的一段`);
}

// ---------- 专属用户 ----------
const exQ = ref('');
const exList = computed(() => state.exclusives.filter((x) => !exQ.value || (x.name ?? '').includes(exQ.value) || String(x.uid).includes(exQ.value)));
const flashUid = ref<number | null>(null);
const draft = ref<null | { uid: string; busy: boolean; msg: string; ok: boolean; found: { uid: number; name: string; face: string } | null; effectId: number | null; cooldownMin: number }>(null);
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
  showEx.value = true;
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
    // 查不到昵称也可以添加（例如 B 站接口暂时不可用）
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
async function removeEx(x: ExclusiveDto): Promise<void> {
  if (await attempt(() => del(`/api/rules/exclusive/${x.uid}`), `已移除：${x.name ?? x.uid}，之后按身份档位播放`)) {
    state.exclusives = state.exclusives.filter((y) => y.uid !== x.uid);
    void refreshEffects();
  }
}
// 有效期
const datePop = ref<{ x: ExclusiveDto; left: number; top: number; value: string } | null>(null);
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
    if (sub === 'exclusive') {
      ev.value = 'enter';
      showEx.value = true;
    }
    else if (EVS.includes(sub as Ev)) ev.value = sub as Ev;
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

    <div class="rl-tabs" role="tablist" aria-label="触发事件">
      <button v-for="t in TABS" :key="t.v" class="rl-tab" role="tab" :aria-selected="ev === t.v" @click="ev = t.v">
        <span class="ico"><Icon :name="t.icon" /></span><b>{{ t.name }}</b><span>{{ counts[t.v] }}</span>
      </button>
    </div>

    <template v-if="ev === 'enter' && rules">
      <div class="rl-flow">
        <span>有人进场时，按这个顺序找，用第一个符合的：</span>
        <span class="st"><Icon name="i-user" />专属用户</span><i>→</i><span class="st">大航海</span><i>→</i><span class="st">房管</span><i>→</i><span class="st">粉丝牌</span><i>→</i><span class="st">其他观众</span>
      </div>
      <div class="rl-bar">
        <Icon name="i-bolt" /><span>不重复播放的方式</span>
        <Seg :model-value="rules.cooldownMode" label="不重复播放的方式" :options="[{ value: 'minutes', label: '按时间' }, { value: 'oncePerLive', label: '每场直播只播一次' }]" @change="setMode" />
        <span class="hint">{{ once ? '同一个人这一场直播里只播一次，下一场重新算' : '每条规则可以单独设置多久内不重复' }}</span>
      </div>

      <div class="rl-sec"><h3>专属用户</h3><span>给某几位观众单独指定特效，永远最先用；只对进场有效</span></div>
      <div class="rl-bar">
        <span><b>{{ state.exclusives.length }} 人</b>有专属特效</span>
        <span class="hint">在总览的实时动态里点某个观众，也能直接设置</span>
        <span class="sp" />
        <button v-if="state.exclusives.length" class="btn" @click="showEx = !showEx">{{ showEx ? '收起列表' : '查看列表' }}</button>
        <button class="btn primary" @click="startAdd()"><Icon name="i-plus" />添加专属用户</button>
      </div>
      <!-- 专属用户 -->
      <div v-if="showEx || draft" class="rl-ex">
        <div class="toolbar">
          <div class="s"><Icon name="i-search" /><input v-model.trim="exQ" class="inp" placeholder="搜索昵称或 UID" aria-label="搜索专属用户" /></div>
          <span class="subhint">专属只对<b style="color: var(--t1); font-weight: 500">进场</b>生效，礼物、弹幕、上舰按各自的规则播放。</span>
        </div>
        <div v-if="draft" class="addbar">
          <div class="r1">
            <input id="exUid" v-model="draft.uid" class="inp num" inputmode="numeric" placeholder="输入 B 站 UID，回车查询" aria-label="B站 UID" @keydown.enter="lookup" />
            <button class="btn" :disabled="draft.busy" @click="lookup"><span v-if="draft.busy" class="spin" />{{ draft.busy ? '查询中' : '查询' }}</button>
            <span style="color: var(--t3); font-size: 12.5px">或</span>
            <button class="linkish" @click="showRecent = !showRecent">从最近进场的观众里选</button>
            <button class="icon-btn" style="margin-left: auto; box-shadow: none" aria-label="取消添加" @click="draft = null"><Icon name="i-x" /></button>
          </div>
          <div v-if="showRecent" class="picker">
            <label v-for="v in recentViewers" :key="v.uid" :style="state.exclusives.some((x) => x.uid === v.uid) ? 'opacity:.5' : ''">
              <input type="radio" name="expk" :disabled="state.exclusives.some((x) => x.uid === v.uid)" @change="((draft!.uid = String(v.uid)), (showRecent = false), lookup())" />
              <Avatar :name="v.name" :face="v.face" />{{ v.name }}<IdTag :viewer="v" /><span class="uid num">{{ state.exclusives.some((x) => x.uid === v.uid) ? '已是专属' : v.uid }}</span>
            </label>
            <div v-if="!recentViewers.length" style="padding: 10px; color: var(--t3); font-size: 12.5px">还没有进场记录，开播后这里会列出最近进场的观众</div>
          </div>
          <div v-if="draft.msg" class="lookup" :class="{ ok: draft.ok }">{{ draft.msg }}</div>
          <div v-if="draft.found" class="found">
            <span class="who"><Avatar :name="draft.found.name" :face="draft.found.face" />{{ draft.found.name }}</span>
            <span class="num" style="font-size: 12px; color: var(--t3)">UID {{ draft.found.uid }}</span>
            <EffectPicker v-model="draft.effectId" />
            <CdPick v-model="draft.cooldownMin" />
            <button class="btn primary" style="margin-left: auto" @click="addExclusive">添加</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="extable">
            <thead><tr><th>观众</th><th>身份</th><th>专属特效</th><th>多久内不重复</th><th>有效期</th><th>开关</th><th /></tr></thead>
            <tbody>
              <tr v-for="x in exList" :key="x.uid" :style="flashUid === x.uid ? 'outline: 2px solid var(--accent-ring)' : ''">
                <td><span class="who"><Avatar :name="x.name ?? String(x.uid)" :face="x.face" /><span><div>{{ x.name ?? '（昵称未知）' }}</div><div class="num" style="font-size: 11.5px; color: var(--t3); font-weight: 400">UID {{ x.uid }}</div></span></span></td>
                <td><IdTag v-if="viewerOf(x.uid)" :viewer="viewerOf(x.uid)!" /><span v-else style="color: var(--t3)">—</span></td>
                <td><EffectPicker v-model="x.effectId" @change="(id) => updateEx(x, { effectId: id }, `${x.name ?? x.uid} 的专属素材改为「${effectById(id)?.name}」`)" /></td>
                <td><CdPick v-if="!once" v-model="x.cooldownMin" @change="(v) => updateEx(x, { cooldownMin: v }, cdMsg(x.name ?? String(x.uid), v))" /><span v-else class="inline-hint">每场一次</span></td>
                <td>
                  <button class="untilb" :class="x.until ? (x.until < todayStr ? 'expired' : 'set') : ''" @click.stop="(e) => openDate(e, x)">{{ x.until ? `${x.until < todayStr ? '已过期 ' : '至 '}${x.until.slice(5)}` : '长期' }}</button>
                </td>
                <td><Switch v-model="x.enabled" :label="`启用 ${x.name ?? x.uid}`" @change="(v) => updateEx(x, { enabled: v }, v ? '已启用' : '已停用，TA 会按身份档位播放')" /></td>
                <td style="white-space: nowrap">
                  <button class="playmini" aria-label="预览" @click="preview(x.effectId, { name: x.name ?? '专属观众', guard: 0, isMod: false, medalLevel: null }, x.name ?? String(x.uid))"><svg><use href="#i-play" /></svg></button>
                  <ConfirmButton label="" confirm-label="确认移除" cls="moreb" :aria-label="`移除 ${x.name ?? x.uid}`" @confirm="removeEx(x)"><Icon name="i-x" /></ConfirmButton>
                </td>
              </tr>
              <tr v-if="!exList.length">
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--t3)">{{ state.exclusives.length ? '没有匹配的专属用户' : '还没有专属用户，点上面的「添加专属用户」' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="rl-sec"><h3>大航海</h3><span>只算本直播间的舰长、提督、总督</span></div>
      <div class="rl-list">
        <div v-for="g in GUARDS" :key="g.tier" class="rl" :class="{ off: !rules.tiers[g.tier].enabled, flash: flashKey === g.tier }">
          <span class="who"><IdTag :identity="g.tier" /></span>
          <span class="say">
            <b>{{ g.cond }}</b>进场时，播放 <EffectPicker v-model="rules.tiers[g.tier].effectId" @change="onTierEffect(g.tier, rules.tiers[g.tier], g.cond)" />
            <template v-if="!once">，同一个人 <CdPick v-model="rules.tiers[g.tier].cooldownMin" @change="(v) => save(cdMsg(g.cond, v))" /> 内不重复</template>
            <span v-if="!rules.tiers[g.tier].enabled" class="offnote">{{ TIER_OFF.guard }}</span>
          </span>
          <span class="acts">
            <button class="playmini" :aria-label="`预览${g.cond}进场`" @click="preview(rules.tiers[g.tier].effectId, tierSample(g.tier), `${g.cond}进场`)"><svg><use href="#i-play" /></svg></button>
            <Switch v-model="rules.tiers[g.tier].enabled" :label="`${g.cond}进场特效`" @change="(v) => save(v ? `已打开${g.cond}进场特效` : `已关闭${g.cond}进场特效，TA 们会按房管、粉丝牌或其他观众处理`)" />
          </span>
        </div>
      </div>

      <div class="rl-sec"><h3>房管</h3><span>本直播间的房管</span></div>
      <div class="rl-list">
        <div class="rl" :class="{ off: !rules.tiers.mod.enabled, flash: flashKey === 'mod' }">
          <span class="who"><IdTag identity="mod" /></span>
          <span class="say">
            <b>房管</b>进场时，播放 <EffectPicker v-model="rules.tiers.mod.effectId" @change="onTierEffect('mod', rules.tiers.mod, '房管')" />
            <template v-if="!once">，同一个人 <CdPick v-model="rules.tiers.mod.cooldownMin" @change="(v) => save(cdMsg('房管', v))" /> 内不重复</template>
            <span v-if="!rules.tiers.mod.enabled" class="offnote">{{ TIER_OFF.mod }}</span>
          </span>
          <span class="acts">
            <button class="playmini" aria-label="预览房管进场" @click="preview(rules.tiers.mod.effectId, SAMPLES.mod, '房管进场')"><svg><use href="#i-play" /></svg></button>
            <Switch v-model="rules.tiers.mod.enabled" label="房管进场特效" @change="(v) => save(v ? '已打开房管进场特效' : '已关闭房管进场特效')" />
          </span>
        </div>
      </div>

      <div class="rl-sec"><h3>粉丝牌</h3><span>只算本直播间的牌子，按等级分段，每一段放一种特效</span></div>
      <div class="rl-lv">
        <div class="lvbar">
          <button v-for="x in levelBar" :key="x.from" type="button" :class="{ off: !x.b.enabled }" :style="{ flex: x.to - x.from + 1, background: x.b.enabled ? x.color : undefined }" :title="`${x.label}：${effectById(x.b.effectId)?.name ?? '未选择'}`" @click="locateBand(x.from)">
            <span>{{ x.label }} · {{ x.b.enabled ? (effectById(x.b.effectId)?.name ?? '未选择') : '已关闭' }}</span>
          </button>
        </div>
        <div class="lvticks"><span v-for="x in levelBar" :key="x.from" :style="{ left: `${((x.from - 1) / 59) * 100}%` }">{{ x.from }}</span><span style="left: 100%">60</span></div>
        <div class="lvadd">
          <Icon name="i-plus" />在 <input v-model.number="addLevel" class="inp num" type="number" min="2" max="60" placeholder="31" aria-label="从几级开始分一段" @keydown.enter="addBand" /> 级处再分一段
          <button class="btn" @click="addBand">分段</button>
          <span class="hint" :style="{ color: addMsg.err ? '#D64545' : '' }">{{ addMsg.text }}</span>
        </div>
      </div>
      <div class="rl-list" style="margin-top: 8px">
        <div v-for="(b, i) in bands" :id="`band${b.fromLevel}`" :key="b.fromLevel" class="rl" :class="{ off: !b.enabled, flash: flashKey === `band${b.fromLevel}` }">
          <span class="who"><Medal :level="b.fromLevel" /></span>
          <span class="say">
            粉丝牌 <b>{{ bandLabel(i) }}</b> 进场时，播放 <EffectPicker v-model="b.effectId" @change="(flash(`band${b.fromLevel}`), save(`粉丝牌 ${bandLabel(i)}改为播放「${effectById(b.effectId)?.name ?? ''}」`))" />
            <template v-if="!once">，同一个人 <CdPick v-model="b.cooldownMin" @change="(v) => save(cdMsg(`粉丝牌 ${bandLabel(i)}`, v))" /> 内不重复</template>
            <span v-if="!b.enabled" class="offnote">已关闭：这些观众按其他观众处理</span>
          </span>
          <span class="acts">
            <ConfirmButton v-if="bands.length > 1" label="删除" confirm-label="确认删除" cls="playmini" :aria-label="`删除粉丝牌 ${bandLabel(i)}这一段`" title="删除这一段（并入相邻的一段），再点一次确认" @confirm="removeBand(b, i)"><Icon name="i-x" /></ConfirmButton>
            <button class="playmini" :aria-label="`预览粉丝牌 ${bandLabel(i)}进场`" @click="preview(b.effectId, { ...SAMPLES.fan, medalLevel: b.fromLevel }, `粉丝牌 ${bandLabel(i)}进场`)"><svg><use href="#i-play" /></svg></button>
            <Switch v-model="b.enabled" :label="`粉丝牌 ${bandLabel(i)}进场特效`" @change="(v) => save(v ? `已打开粉丝牌 ${bandLabel(i)}` : `已关闭粉丝牌 ${bandLabel(i)}，这些观众按其他观众处理`)" />
          </span>
        </div>
      </div>

      <div class="rl-sec"><h3>其他观众</h3><span>上面都不符合的人</span></div>
      <div class="rl-list">
        <div class="rl" :class="{ off: !rules.tiers.nor.enabled, flash: flashKey === 'nor' }">
          <span class="who"><IdTag identity="nor" /></span>
          <span class="say">
            <b>其他观众</b>进场时，播放 <EffectPicker v-model="rules.tiers.nor.effectId" @change="onTierEffect('nor', rules.tiers.nor, '其他观众')" />
            <template v-if="!once">，同一个人 <CdPick v-model="rules.tiers.nor.cooldownMin" @change="(v) => save(cdMsg('其他观众', v))" /> 内不重复</template>
            <span v-if="!rules.tiers.nor.enabled" class="offnote">{{ TIER_OFF.nor }}</span>
          </span>
          <span class="acts">
            <button class="playmini" aria-label="预览其他观众进场" @click="preview(rules.tiers.nor.effectId, SAMPLES.nor, '其他观众进场')"><svg><use href="#i-play" /></svg></button>
            <Switch v-model="rules.tiers.nor.enabled" label="其他观众进场特效" @change="(v) => save(v ? '已打开其他观众进场特效' : '已关闭其他观众进场特效')" />
          </span>
        </div>
      </div>
    </template>
    <RulesDanmu v-else-if="ev === 'danmu'" @preview="onPreview" />
    <RulesGift v-else-if="ev === 'gift'" @preview="onPreview" />
    <RulesGuard v-else-if="ev === 'guard'" @preview="onPreview" />

    <SimDrawer v-if="simOpen" :kind="ev" @close="simOpen = false" />

    <Teleport to="body">
      <template v-if="datePop">
        <div style="position: fixed; inset: 0; z-index: 45" @click="datePop = null" />
        <div class="datepop" :style="{ left: `${datePop.left}px`, top: `${datePop.top}px` }">
          <b style="font-weight: 500">有效期</b><span style="color: var(--t3); font-size: 12px">到期后自动停用，改回按身份档位播放（含当天）</span>
          <input v-model="datePop.value" class="inp" type="date" aria-label="截止日期" />
          <div class="row"><button class="btn" @click="setUntil(null)">设为长期</button><button class="btn primary" @click="setUntil(datePop.value)">确定</button></div>
        </div>
      </template>
    </Teleport>
  </section>
</template>
