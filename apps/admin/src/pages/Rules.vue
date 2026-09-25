<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import CdInput from '../components/CdInput.vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import EffectPicker from '../components/EffectPicker.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import Medal from '../components/Medal.vue';
import PreviewStage from '../components/PreviewStage.vue';
import Seg from '../components/Seg.vue';
import Switch from '../components/Switch.vue';
import { ApiError, del, get, post, put } from '../lib/api.ts';
import { today } from '../lib/format.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity, SampleViewer } from '../lib/identity.ts';
import { route } from '../lib/route.ts';
import { effectById, refreshEffects, refreshRules, refreshSettings, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { EnterBase, ExclusiveDto, MedalBand, SimulateResult, Tier, TierRule, Viewer } from '../lib/types.ts';

type Ev = 'enter' | 'danmu' | 'gift' | 'guard';
const ev = ref<Ev>('enter');
const tab = ref<'tiers' | 'excl'>(route.value.sub === 'exclusive' ? 'excl' : 'tiers');
const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
const prevLabel = ref('点任意一行的 ▶ 预览');
const prevEffect = ref<number | null>(null);
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
function preview(effectId: number | null, viewer: SampleViewer, label: string): void {
  if (!effectId) return toast('这条规则还没有选素材', 'info');
  prevEffect.value = effectId;
  prevLabel.value = `${label} · ${effectById(effectId)?.name ?? ''}`;
  void stage.value?.play(effectId, viewer);
}
async function sendLive(): Promise<void> {
  if (!prevEffect.value) return;
  await attempt(() => post('/api/playback/test', { effectId: prevEffect.value }), '已发送到直播画面');
}

function onTierEffect(t: Tier, r: TierRule): void {
  flash(t);
  void save(`已换成素材「${effectById(r.effectId)?.name ?? ''}」`);
  preview(r.effectId, tierSample(t), t);
}

// ---------- 粉丝牌分档 ----------
const addLevel = ref<number | null>(null);
const addMsg = ref<{ text: string; err: boolean }>({ text: '会从所在的档里切出来，沿用原来的素材', err: false });
function addBand(): void {
  const v = Number(addLevel.value);
  if (!rules.value) return;
  if (!(v >= 2 && v <= 60) || !Number.isInteger(v)) return void (addMsg.value = { text: '请输入 2 – 60 之间的等级', err: true });
  if (rules.value.bands.some((b) => b.fromLevel === v)) return void (addMsg.value = { text: `已经有从 ${v} 级开始的档了`, err: true });
  const parent = bands.value.find((b) => b.fromLevel < v) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromLevel: v, effectId: parent.effectId, cooldownMin: parent.cooldownMin, enabled: parent.enabled });
  addLevel.value = null;
  addMsg.value = { text: '会从所在的档里切出来，沿用原来的素材', err: false };
  flash(`band${v}`);
  void save(`已添加分档：${v} 级起`);
}
function removeBand(b: MedalBand, i: number): void {
  if (!rules.value || rules.value.bands.length <= 1) return;
  const label = bandLabel(i);
  rules.value.bands = rules.value.bands.filter((x) => x.fromLevel !== b.fromLevel);
  void save(`已删除分档：${label}，这些等级并入相邻档`);
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
  tab.value = 'excl';
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
const todayStr = today();

watch(
  () => route.value.sub,
  (sub) => sub === 'exclusive' && (tab.value = 'excl'),
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

// ---------- 模拟 ----------
const sim = ref({ identity: 'cap' as Identity, medal: 0, own: true });
const simRes = ref<SimulateResult | null>(null);
async function simulate(): Promise<void> {
  const s = sim.value;
  const viewer = { guard: s.identity === 'gov' ? 1 : s.identity === 'adm' ? 2 : s.identity === 'cap' ? 3 : 0, isMod: s.identity === 'mod', medal: s.medal > 0 ? { level: s.medal, own: s.own } : null };
  simRes.value = (await attempt(() => post<SimulateResult>('/api/simulate', { viewer }))) ?? null;
}

// ---------- 队列 ----------
async function saveSetting(patch: object, msg: string): Promise<void> {
  if (await attempt(() => put('/api/settings', patch), msg)) await refreshSettings();
}
async function setMode(v: 'minutes' | 'oncePerLive'): Promise<void> {
  if (!rules.value) return;
  rules.value.cooldownMode = v;
  await save(v === 'oncePerLive' ? '冷却方式：每场直播每人只播一次' : '冷却方式：按分钟');
}

onMounted(() => void refreshRules());
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>触发规则</h1>
        <p>按事件分开设置：谁、做了什么 → 放哪个素材。同一个素材可以在不同规则里复用。</p>
      </div>
      <div class="actions">
        <Seg v-model="ev" label="触发事件" :options="[{ value: 'enter', label: '进场' }, { value: 'danmu', label: '弹幕' }, { value: 'gift', label: '礼物' }, { value: 'guard', label: '上舰' }]" />
      </div>
    </div>

    <div class="rules-layout">
      <div>
        <template v-if="ev === 'enter' && rules">
          <div class="subbar">
            <div class="seg" role="tablist" aria-label="进场规则分类">
              <button role="tab" :aria-pressed="tab === 'tiers'" @click="tab = 'tiers'">身份档位</button>
              <button role="tab" :aria-pressed="tab === 'excl'" @click="tab = 'excl'">专属用户 <span class="num">{{ state.exclusives.length }}</span></button>
            </div>
            <span class="subhint">从上到下匹配，命中第一条就停止。专属用户永远最先匹配。</span>
            <span style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--t2)">冷却方式
              <Seg :model-value="rules.cooldownMode" label="进场冷却方式" :options="[{ value: 'minutes', label: '按分钟' }, { value: 'oncePerLive', label: '每场只播一次' }]" @change="setMode" />
            </span>
          </div>

          <!-- 身份档位 -->
          <div v-if="tab === 'tiers'" class="tlist">
            <div class="tgroup"><b>最先匹配</b></div>
            <div class="trow summary">
              <span class="prio">00</span>
              <span><span class="tag excl"><Icon name="i-user" />专属用户</span></span>
              <span class="cond"><b>{{ state.exclusives.length }} 人</b>有自己的专属素材，永远最先匹配</span>
              <button class="linkish" @click="tab = 'excl'">管理专属用户 →</button>
            </div>

            <div class="tgroup"><b>大航海</b><span>只算本直播间</span></div>
            <div v-for="(g, i) in GUARDS" :key="g.tier" class="trow" :class="{ off: !rules.tiers[g.tier].enabled, flash: flashKey === g.tier }">
              <span class="prio">{{ String(i + 1).padStart(2, '0') }}</span>
              <span><IdTag :identity="g.tier" /></span>
              <span class="cond">大航海 <b>{{ g.cond }}</b></span>
              <EffectPicker v-model="rules.tiers[g.tier].effectId" @change="onTierEffect(g.tier, rules.tiers[g.tier])" />
              <CdInput v-if="!once" v-model="rules.tiers[g.tier].cooldownMin" @change="(v) => save(`冷却已改为 ${v} 分钟`)" />
              <span v-else class="inline-hint">每场一次</span>
              <Switch v-model="rules.tiers[g.tier].enabled" :label="`启用${g.cond}`" @change="(v) => save(v ? `已启用${g.cond}进场特效` : `已停用${g.cond}，TA 们会按房管、粉丝牌或普通观众处理`)" />
              <button class="playmini" aria-label="在右侧预览" @click="preview(rules.tiers[g.tier].effectId, tierSample(g.tier), g.cond)"><svg><use href="#i-play" /></svg></button>
            </div>

            <div class="tgroup"><b>房管</b></div>
            <div class="trow" :class="{ off: !rules.tiers.mod.enabled, flash: flashKey === 'mod' }">
              <span class="prio">04</span>
              <span><IdTag identity="mod" /></span>
              <span class="cond">本直播间 <b>房管</b></span>
              <EffectPicker v-model="rules.tiers.mod.effectId" @change="onTierEffect('mod', rules.tiers.mod)" />
              <CdInput v-if="!once" v-model="rules.tiers.mod.cooldownMin" @change="(v) => save(`冷却已改为 ${v} 分钟`)" />
              <span v-else class="inline-hint">每场一次</span>
              <Switch v-model="rules.tiers.mod.enabled" label="启用房管" @change="(v) => save(v ? '已启用房管进场特效' : '已停用房管进场特效')" />
              <button class="playmini" aria-label="在右侧预览" @click="preview(rules.tiers.mod.effectId, SAMPLES.mod, '房管')"><svg><use href="#i-play" /></svg></button>
            </div>

            <div class="tgroup"><b>粉丝牌</b><span>按等级分档，高等级优先，不会重叠；只算本直播间的牌子</span></div>
            <div v-for="(b, i) in bands" :key="b.fromLevel" class="trow" :class="{ off: !b.enabled, flash: flashKey === `band${b.fromLevel}` }">
              <span class="prio">{{ String(5 + i).padStart(2, '0') }}</span>
              <span><Medal :level="b.fromLevel" /></span>
              <span class="cond">粉丝牌 <b>{{ bandLabel(i) }}</b>
                <button v-if="bands.length > 1" class="rm" aria-label="删除这一档" @click="removeBand(b, i)"><Icon name="i-x" style="width: 12px; height: 12px" /></button>
              </span>
              <EffectPicker v-model="b.effectId" @change="(flash(`band${b.fromLevel}`), save(`已换成素材「${effectById(b.effectId)?.name ?? ''}」`), preview(b.effectId, { ...SAMPLES.fan, medalLevel: b.fromLevel }, bandLabel(i)))" />
              <CdInput v-if="!once" v-model="b.cooldownMin" @change="(v) => save(`冷却已改为 ${v} 分钟`)" />
              <span v-else class="inline-hint">每场一次</span>
              <Switch v-model="b.enabled" :label="`启用粉丝牌 ${bandLabel(i)}`" @change="(v) => save(v ? `已启用粉丝牌 ${bandLabel(i)}` : `已停用粉丝牌 ${bandLabel(i)}，这些观众按普通观众处理`)" />
              <button class="playmini" aria-label="在右侧预览" @click="preview(b.effectId, { ...SAMPLES.fan, medalLevel: b.fromLevel }, `粉丝牌 ${bandLabel(i)}`)"><svg><use href="#i-play" /></svg></button>
            </div>
            <div class="addband">
              <Icon name="i-plus" />添加分档：从 <input v-model.number="addLevel" type="number" min="2" max="60" placeholder="31" aria-label="起始等级" @keydown.enter="addBand" /> 级起
              <button class="btn" style="height: 30px" @click="addBand">添加</button>
              <span class="msg" :style="{ color: addMsg.err ? '#D64545' : '' }">{{ addMsg.text }}</span>
            </div>

            <div class="tgroup"><b>其他</b><span>默认关闭</span></div>
            <div class="trow" :class="{ off: !rules.tiers.nor.enabled, flash: flashKey === 'nor' }">
              <span class="prio">{{ String(5 + bands.length).padStart(2, '0') }}</span>
              <span><IdTag identity="nor" /></span>
              <span class="cond"><b>其他所有观众</b></span>
              <EffectPicker v-model="rules.tiers.nor.effectId" @change="onTierEffect('nor', rules.tiers.nor)" />
              <CdInput v-if="!once" v-model="rules.tiers.nor.cooldownMin" @change="(v) => save(`冷却已改为 ${v} 分钟`)" />
              <span v-else class="inline-hint">每场一次</span>
              <Switch v-model="rules.tiers.nor.enabled" label="启用普通观众" @change="(v) => save(v ? '已启用普通观众进场特效' : '已停用普通观众进场特效')" />
              <button class="playmini" aria-label="在右侧预览" @click="preview(rules.tiers.nor.effectId, SAMPLES.nor, '普通观众')"><svg><use href="#i-play" /></svg></button>
            </div>
          </div>

          <!-- 专属用户 -->
          <div v-else>
            <div class="toolbar">
              <div class="s"><Icon name="i-search" /><input v-model.trim="exQ" class="inp" placeholder="搜索昵称或 UID" aria-label="搜索专属用户" /></div>
              <span class="subhint">专属只对<b style="color: var(--t1); font-weight: 500">进场</b>生效，礼物、弹幕、上舰按各自的规则播放。</span>
              <button class="btn primary" style="margin-left: auto" @click="startAdd()"><Icon name="i-plus" />添加专属用户</button>
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
                <CdInput v-model="draft.cooldownMin" />
                <button class="btn primary" style="margin-left: auto" @click="addExclusive">添加</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="extable">
                <thead><tr><th>观众</th><th>身份</th><th>专属素材</th><th>冷却</th><th>有效期</th><th>启用</th><th /></tr></thead>
                <tbody>
                  <tr v-for="x in exList" :key="x.uid" :style="flashUid === x.uid ? 'outline: 2px solid var(--accent-ring)' : ''">
                    <td><span class="who"><Avatar :name="x.name ?? String(x.uid)" :face="x.face" /><span><div>{{ x.name ?? '（昵称未知）' }}</div><div class="num" style="font-size: 11.5px; color: var(--t3); font-weight: 400">UID {{ x.uid }}</div></span></span></td>
                    <td><IdTag v-if="viewerOf(x.uid)" :viewer="viewerOf(x.uid)!" /><span v-else style="color: var(--t3)">—</span></td>
                    <td><EffectPicker v-model="x.effectId" @change="(id) => updateEx(x, { effectId: id }, `${x.name ?? x.uid} 的专属素材改为「${effectById(id)?.name}」`)" /></td>
                    <td><CdInput v-if="!once" v-model="x.cooldownMin" @change="(v) => updateEx(x, { cooldownMin: v }, `冷却已改为 ${v} 分钟`)" /><span v-else class="inline-hint">每场一次</span></td>
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
                    <td colspan="7" style="text-align: center; padding: 40px; color: var(--t3)">{{ state.exclusives.length ? '没有匹配的专属用户' : '还没有专属用户，点右上角「添加专属用户」' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        <div v-else-if="ev !== 'enter'" class="soon-box"><b>{{ { danmu: '弹幕', gift: '礼物', guard: '上舰' }[ev] }}规则在下一个版本（v0.2.0）开放</b>事件已经在记录了，可以在「事件记录」里看到</div>
      </div>

      <aside class="side-prev">
        <div class="card">
          <div class="card-h"><h2>预览</h2><span class="aside">只在这里播放，不上直播</span></div>
          <PreviewStage ref="stage" :label="prevLabel" />
          <ConfirmButton label="发送到直播测试" confirm-label="确认？观众会看到" cls="btn live-send" armed-cls="btn live-send" style="width: 100%; justify-content: center; margin-top: 12px" :disabled="!prevEffect" @confirm="sendLive" />
        </div>
        <div class="card" style="margin-top: 16px">
          <div class="card-h"><h2>模拟一次进场</h2><span class="aside">看看会命中哪条规则</span></div>
          <div id="simBox">
            <div class="row">
              <select v-model="sim.identity" class="sel" aria-label="身份">
                <option value="gov">总督</option><option value="adm">提督</option><option value="cap">舰长</option><option value="mod">房管</option><option value="nor">普通观众</option>
              </select>
              <div class="suffix"><input v-model.number="sim.medal" class="inp num" type="number" min="0" max="60" aria-label="粉丝牌等级" /><span>级牌子</span></div>
            </div>
            <label class="toggle-line" style="font-size: 12.5px"><input v-model="sim.own" type="checkbox" style="accent-color: var(--accent)" />牌子是本直播间的（0 级表示没戴牌子）</label>
            <button class="btn primary" style="justify-content: center" @click="simulate">模拟进场</button>
          </div>
          <div class="simres">
            <template v-if="simRes">
              <template v-if="simRes.rule">命中 <b>{{ simRes.rule }}</b> → {{ simRes.effect?.name }}<br /></template>
              <span v-else class="miss">没有命中任何规则<br /></span>
              结果：{{ simRes.status === 'played' ? '会播放' : `不会播放（${simRes.statusText}）` }}
            </template>
          </div>
        </div>
        <div v-if="state.settings" class="card" style="margin-top: 16px">
          <div class="card-h"><h2>播放队列</h2><span class="aside">所有事件共用</span></div>
          <ol class="qorder"><li><b>上舰</b></li><li><b>礼物</b></li><li><b>进场</b></li><li><b>弹幕</b></li></ol>
          <div class="toggle-line" style="margin-top: 12px">高价值插队 <span class="hint">上舰和 ≥ 100 元礼物立即播放（v0.2.0 生效）</span>
            <Switch v-model="state.settings.queueJump" label="高价值插队" @change="(v) => saveSetting({ queueJump: v }, v ? '已开启高价值插队' : '已关闭高价值插队')" />
          </div>
          <div class="slider-row" style="margin-top: 10px">
            <label for="qMax">最多排队</label>
            <input id="qMax" v-model.number="state.settings.queueMax" type="range" min="3" max="30" @change="saveSetting({ queueMax: state.settings!.queueMax }, `最多排队 ${state.settings!.queueMax} 个`)" />
            <output>{{ state.settings.queueMax }} 个</output>
          </div>
          <span class="hint" style="font-size: 12px; color: var(--t3)">排满后，先丢弃优先级最低、最早进来的特效。</span>
        </div>
      </aside>
    </div>

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
