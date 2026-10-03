<script setup lang="ts">
// 礼物规则（F-GF-01 ~ 05）：指定礼物（按礼物 ID，从本直播间礼物面板选）→ 按单次价值分档；免费礼物不触发；连击合并
import { computed, onMounted, ref } from 'vue';
import { JUMP_GOLD } from '@starfall/shared/labels';
import { get, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import { battery, batteryYuan, yuan } from '../lib/preview.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, state } from '../lib/store.ts';
import { attempt, undoable } from '../lib/toast.ts';
import type { GiftBand, GiftConfig, GiftRules } from '../lib/types.ts';
import CdPick from './CdPick.vue';
import ConfirmButton from './ConfirmButton.vue';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
const catalog = ref<GiftConfig[]>([]);
const catalogErr = ref('');
const picking = ref(false);
const giftQ = ref('');
const addBattery = ref<number | null>(null);
const bandMsg = ref<{ text: string; err: boolean }>({ text: '分出来的新一段先沿用原来的特效', err: false });

const rules = computed(() => state.gift);
const bands = computed(() => [...(rules.value?.bands ?? [])].sort((a, b) => b.fromGold - a.fromGold));
const giftOf = (id: number) => catalog.value.find((g) => g.id === id);
const available = computed(() => catalog.value.filter((g) => g.paid && !rules.value?.specific.some((s) => s.giftId === g.id) && (!giftQ.value || g.name.includes(giftQ.value))));
// 按礼物面板分页（礼物、粉丝团、航海……）、页内顺序列出；不在面板上显示的（包裹、活动等）按价格排在最后
const groups = computed(() => {
  const tabs = new Map<string, GiftConfig[]>();
  const off: GiftConfig[] = [];
  for (const g of catalog.value) if (g.tab && !tabs.has(g.tab)) tabs.set(g.tab, []);
  for (const g of available.value) (g.tab ? tabs.get(g.tab)! : off).push(g);
  const out = [...tabs].filter(([, list]) => list.length).map(([tab, list]) => ({ title: `${tab}（${list.length}）`, list: list.sort((a, b) => a.panel! - b.panel!) }));
  if (off.length) out.push({ title: `面板上不显示的礼物（包裹、活动、特效版本等，${off.length}），按价格从低到高`, list: off.sort((a, b) => a.price - b.price) });
  return out;
});

/** 价值范围：「1000电池以上」「100 – 1000电池」 */
function range(lo: number, hi?: number): string {
  return hi === undefined ? `${battery(lo)}以上` : `${battery(lo).replace('电池', '')} – ${battery(hi)}`;
}
/** 同一范围折合的金额：「100 元以上」「10 – 100 元」 */
function yuanRange(lo: number, hi?: number): string {
  return hi === undefined ? `${yuan(lo)}以上` : `${yuan(lo).replace(' 元', '')} – ${yuan(hi)}`;
}
const bandHi = (i: number) => (i === 0 ? undefined : bands.value[i - 1]!.fromGold);
/** 第 i 档（从高到低）的价值范围 */
const bandLabel = (i: number) => range(bands.value[i]!.fromGold, bandHi(i));
const bandYuan = (i: number) => yuanRange(bands.value[i]!.fromGold, bandHi(i));
const BAR_COLORS = ['#C8612A', '#E0568F', '#6E6BF2', '#3FB4F6', '#4FD1BC', '#6C7080'];
/** 价值刻度条：从低到高，最左边一段是「不播放」 */
const valueBar = computed(() => {
  const asc = [...bands.value].reverse();
  if (!asc.length) return [];
  const segs: Array<{ key: string; range: string; name: string; color: string | null; off: boolean }> = [{ key: 'none', range: `${battery(asc[0]!.fromGold)}以下`, name: '不播放', color: null, off: true }];
  asc.forEach((b, i) => {
    const hi = asc[i + 1];
    const e = effectById(b.effectId);
    segs.push({ key: String(b.fromGold), range: range(b.fromGold, hi?.fromGold), name: b.enabled ? (e?.name ?? '未选择') : '已关闭', color: b.enabled ? BAR_COLORS[(asc.length - 1 - i) % BAR_COLORS.length]! : null, off: !b.enabled });
  });
  return segs;
});
const ticks = computed(() => [...bands.value].reverse().map((b, i, arr) => ({ key: b.fromGold, text: battery(b.fromGold), note: yuan(b.fromGold), left: ((i + 1) / (arr.length + 1)) * 100 })));

async function save(msg?: string, undo?: () => Promise<unknown>): Promise<void> {
  if (!rules.value) return;
  const r = await attempt(() => put<GiftRules>('/api/rules/gift', rules.value), undo ? undefined : msg);
  if (r && undo && msg) undoable(msg, undo);
  if (r) state.gift = r;
  else state.gift = await get<GiftRules>('/api/rules/gift');
  void refreshEffects();
}

function addSpecific(g: GiftConfig): void {
  if (!rules.value) return;
  const eff = state.effects.find((e) => e.name === '晶礼')?.id ?? null;
  rules.value.specific.push({ giftId: g.id, giftName: g.name, effectId: eff, enabled: true });
  // 选完不收起，可以接着选别的礼物；选过的会从列表里消失
  void save(`已添加指定礼物：${g.name}`);
}
function removeSpecific(id: number): void {
  if (!rules.value) return;
  const before = rules.value.specific.map((s) => ({ ...s }));
  const name = before.find((s) => s.giftId === id)?.giftName ?? '';
  rules.value.specific = rules.value.specific.filter((s) => s.giftId !== id);
  void save(`已删除指定礼物：${name}`, async () => {
    if (!rules.value) return;
    rules.value.specific = before;
    await save(`已恢复指定礼物：${name}`);
  });
}
function addBand(): void {
  if (!rules.value) return;
  const v = Number(addBattery.value);
  if (!(v >= 1)) return void (bandMsg.value = { text: '请输入至少 1 电池', err: true });
  const gold = Math.round(v) * 100;
  if (rules.value.bands.some((b) => b.fromGold === gold)) return void (bandMsg.value = { text: `已经有 ${batteryYuan(gold)}这一档了`, err: true });
  const parent = bands.value.find((b) => b.fromGold < gold) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromGold: gold, effectId: parent.effectId, enabled: parent.enabled });
  addBattery.value = null;
  bandMsg.value = { text: '低于最低一档的礼物不播特效', err: false };
  void save(`已在 ${batteryYuan(gold)}处分出一段`);
}
function removeBand(b: GiftBand): void {
  if (!rules.value || rules.value.bands.length <= 1) return;
  const before = rules.value.bands.map((x) => ({ ...x }));
  rules.value.bands = rules.value.bands.filter((x) => x.fromGold !== b.fromGold);
  void save('已删除这一段，这段价值并入相邻的一段', async () => {
    if (!rules.value) return;
    rules.value.bands = before;
    await save('已恢复这一段');
  });
}
const jumps = (gold: number) => gold >= JUMP_GOLD && state.settings?.queueJump;
function previewSpec(giftId: number, name: string, effectId: number | null): void {
  const g = giftOf(giftId);
  emit('preview', { effectId, viewer: SAMPLES.fan, label: `礼物「${name}」`, kind: 'gift', vars: { gift: name, count: 1, valueGold: g?.price ?? 0 } });
}
function previewBand(i: number): void {
  const b = bands.value[i]!;
  emit('preview', { effectId: b.effectId, viewer: SAMPLES.fan, label: `礼物 ${bandLabel(i)}`, kind: 'gift', vars: { gift: '告白花束', count: Math.max(1, Math.ceil(b.fromGold / 22_000)), valueGold: b.fromGold } });
}

onMounted(async () => {
  try {
    catalog.value = (await get<{ gifts: GiftConfig[] }>('/api/gifts')).gifts;
  } catch (e) {
    catalogErr.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <div v-if="rules">
    <div class="rl-flow"><span>有人送礼时，先看是不是下面的<b>指定礼物</b>；不是的话，再按这次送的<b>总价值</b>（单价 × 数量）找对应的一段。价值按 B 站礼物面板的电池计算（1 电池 = 0.1 元）。免费礼物不播放。</span></div>

    <div class="rl-sec"><h3>指定礼物</h3><span>送这些礼物时，用这里的特效（优先）</span></div>
    <div class="rl-gifts">
      <div v-for="s in rules.specific" :key="s.giftId" class="rl-gift" :class="{ off: !s.enabled }">
        <img v-if="giftOf(s.giftId)?.icon" :src="giftOf(s.giftId)!.icon" alt="" referrerpolicy="no-referrer" />
        <span v-else class="gico">{{ [...s.giftName][0] ?? '礼' }}</span>
        <div class="body">
          <div class="nm">{{ s.giftName || `礼物 ${s.giftId}` }}<span v-if="giftOf(s.giftId)" class="pr">{{ battery(giftOf(s.giftId)!.price) }} / 个（{{ yuan(giftOf(s.giftId)!.price) }}）</span></div>
          <EffectPicker v-model="s.effectId" kind="gift" @change="(id) => save(`「${s.giftName}」改为播放「${effectById(id)?.name}」`)" />
        </div>
        <div class="side">
          <Switch v-model="s.enabled" :label="`指定礼物 ${s.giftName}`" @change="(v) => save(v ? `已打开「${s.giftName}」` : `已关闭「${s.giftName}」，按价值分段处理`)" />
          <span>
            <button class="playmini" :aria-label="`预览送出 ${s.giftName}`" :title="`预览送出 ${s.giftName}`" @click="previewSpec(s.giftId, s.giftName, s.effectId)"><svg><use href="#i-play" /></svg></button>
            <ConfirmButton label="" confirm-label="删除" cls="playmini" armed-cls="delb" :aria-label="`删除指定礼物 ${s.giftName}`" :title="`删除指定礼物 ${s.giftName}`" @confirm="removeSpecific(s.giftId)"><Icon name="i-x" /></ConfirmButton>
          </span>
        </div>
      </div>
      <button class="rl-gift add" :disabled="!!catalogErr" @click="picking = !picking"><span><Icon name="i-plus" />{{ catalogErr ? '读取礼物面板失败' : '从礼物列表里选' }}</span></button>
    </div>
    <div v-if="picking" class="rl-gpick">
      <div class="h"><input v-model.trim="giftQ" class="inp" placeholder="搜索礼物名" aria-label="搜索礼物" /><span class="hint">来自你直播间的礼物面板，分页和顺序与面板一致；点一下就加上，可以连着选几个</span><button class="icon-btn" aria-label="收起" @click="picking = false"><Icon name="i-x" /></button></div>
      <div class="grid">
        <template v-for="grp in groups" :key="grp.title">
          <div class="sep">{{ grp.title }}</div>
          <button v-for="g in grp.list" :key="g.id" type="button" @click="addSpecific(g)"><img :src="g.icon" alt="" referrerpolicy="no-referrer" /><b>{{ g.name }}</b><span>{{ battery(g.price) }}</span><i>{{ yuan(g.price) }}</i></button>
        </template>
        <span v-if="!available.length" class="hint">没有可选的礼物</span>
      </div>
    </div>

    <div class="rl-sec"><h3>按价值</h3><span>每一段放一种特效</span></div>
    <div class="rl-val">
      <div class="valbar">
        <div v-for="x in valueBar" :key="x.key" :class="{ none: !x.color }" :style="x.color ? { background: x.color } : {}"><b>{{ x.name }}</b><span>{{ x.range }}</span></div>
      </div>
      <div class="valticks two"><span v-for="t in ticks" :key="t.key" :style="{ left: `${t.left}%` }">{{ t.text }}<i>{{ t.note }}</i></span></div>
      <div class="lvadd">
        <Icon name="i-plus" />在 <input v-model.number="addBattery" class="inp num" type="number" min="1" step="1" placeholder="500" aria-label="在多少电池处分一段" @keydown.enter="addBand" /> 电池<span v-if="Number(addBattery) >= 1" class="hint">（{{ yuan(Math.round(Number(addBattery)) * 100) }}）</span>处再分一段
        <button class="btn" @click="addBand">分段</button>
        <span class="hint" :style="{ color: bandMsg.err ? '#D64545' : '' }">{{ bandMsg.text }}</span>
      </div>
    </div>
    <div class="rl-list" style="margin-top: 8px">
      <div v-for="(b, i) in bands" :key="b.fromGold" class="rl" :class="{ off: !b.enabled }">
        <span class="who"><span class="tag">{{ battery(b.fromGold) }}+</span></span>
        <span class="say">
          一次送出 <b>{{ bandLabel(i) }}</b><span class="hint">（{{ bandYuan(i) }}）</span> 时，播放 <EffectPicker v-model="b.effectId" kind="gift" @change="(id) => save(`${bandLabel(i)}的礼物改为播放「${effectById(id)?.name}」`)" />
          <span v-if="jumps(b.fromGold)" class="hint">· 会插队优先播放</span>
          <span v-if="!b.enabled" class="offnote">已关闭：{{ bandLabel(i) }}的礼物不播放特效</span>
        </span>
        <span class="acts">
          <button class="playmini" :aria-label="`预览 ${bandLabel(i)}的礼物`" :title="`预览 ${bandLabel(i)}的礼物`" @click="previewBand(i)"><svg><use href="#i-play" /></svg></button>
          <ConfirmButton v-if="bands.length > 1" label="" confirm-label="删除" cls="playmini" armed-cls="delb" :aria-label="`删除 ${bandLabel(i)}这一段`" @confirm="removeBand(b)"><Icon name="i-x" /></ConfirmButton>
          <Switch v-model="b.enabled" :label="`${bandLabel(i)}的礼物特效`" @change="(v) => save(v ? `已打开 ${bandLabel(i)}` : `已关闭 ${bandLabel(i)}，这段价值的礼物不播放特效`)" />
        </span>
      </div>
    </div>

    <div class="rl-sec"><h3>连击合并</h3></div>
    <div class="rl-list">
      <div class="rl" :class="{ off: !rules.comboEnabled }">
        <span class="who"><span class="tag">连击</span></span>
        <span class="say">
          同一个人 <CdPick v-model="rules.comboSec" unit="sec" :options="[1, 2, 3, 5, 8, 10, 15]" :max="15" :allow-zero="false" hint="这段时间里连续送同一种礼物，合成一次特效" @change="(v) => save(`连击合并时间：${v} 秒`)" /> 内连续送同一种礼物，合成一次特效，显示总数量
          <span v-if="!rules.comboEnabled" class="offnote">已关闭：每次送礼都单独处理</span>
        </span>
        <span class="acts"><Switch v-model="rules.comboEnabled" label="连击合并" @change="(v) => save(v ? '已开启连击合并' : '已关闭连击合并，每次送礼都单独处理')" /></span>
      </div>
    </div>
  </div>
</template>
