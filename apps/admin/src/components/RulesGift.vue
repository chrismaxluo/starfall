<script setup lang="ts">
// 礼物规则（F-GF-01 ~ 05）：指定礼物（按礼物 ID，从本直播间礼物面板选）→ 按单次价值分档；免费礼物不触发；连击合并
import { computed, ref } from 'vue';
import { JUMP_GOLD } from '@starfall/shared/labels';
import { get, put } from '../lib/api.ts';
import { useGiftCatalog } from '../lib/gift-catalog.ts';
import { SAMPLES } from '../lib/identity.ts';
import { battery, batteryYuan, yuan } from '../lib/preview.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, refreshSettings, state, ui } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { GiftBand, GiftConfig, GiftRules } from '../lib/types.ts';
import CdPick from './CdPick.vue';
import EffectPicker from './EffectPicker.vue';
import GiftCatalogError from './GiftCatalogError.vue';
import Icon from './Icon.vue';
import RowMenu from './RowMenu.vue';
import type { MenuItem } from './RowMenu.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
/** 「怎么判断」展开（由页面传进来，换标签时收起） */
const help = defineModel<boolean>('help', { default: false });
/** 列宽：开关 | 礼物 / 价值 | 特效 | 备注 | 操作 */
const COLS = '44px minmax(150px, 220px) minmax(190px, 300px) minmax(0, 1fr) 68px';
/** 「＋ 加一段」展开输入框 */
const adding = ref(false);
function editEffect(id: number | null): void {
  if (!id) return toast('这条规则还没有选特效', 'info');
  ui.editorId = id;
}
const { catalog, error: catalogErr, noRoom, loading: catalogLoading, load: loadCatalog } = useGiftCatalog();
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

/** 礼物图用动图还是静态图（全局设置，所有礼物特效都按它） */
async function setAnim(v: boolean): Promise<void> {
  await attempt(() => put('/api/settings', { giftAnimImg: v }), v ? '礼物图改用动图' : '礼物图改用静态图');
  await refreshSettings().catch(() => undefined);
}
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
  if (rules.value.bands.some((b) => b.fromGold === gold)) return void (bandMsg.value = { text: `已经有 ${batteryYuan(gold)}这一段了`, err: true });
  const parent = bands.value.find((b) => b.fromGold < gold) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromGold: gold, effectId: parent.effectId, enabled: parent.enabled });
  addBattery.value = null;
  adding.value = false;
  bandMsg.value = { text: '分出来的新一段先沿用原来的特效', err: false };
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
const specMenu = (giftId: number, effectId: number | null): Array<MenuItem | null> => [
  { icon: 'i-pen', label: '调整这个特效（素材设置）', run: () => editEffect(effectId) },
  null,
  { icon: 'i-trash', label: '删除（可以撤销）', danger: true, run: () => removeSpecific(giftId) },
];
const bandMenu = (b: GiftBand): Array<MenuItem | null> => [
  { icon: 'i-pen', label: '调整这个特效（素材设置）', run: () => editEffect(b.effectId) },
  null,
  { icon: 'i-trash', label: '删掉这一段（并入相邻的一段）', danger: true, disabled: bands.value.length <= 1, run: () => removeBand(b) },
];
const jumps = (gold: number) => gold >= JUMP_GOLD && state.settings?.queueJump;
function previewSpec(giftId: number, name: string, effectId: number | null): void {
  const g = giftOf(giftId);
  emit('preview', { effectId, viewer: SAMPLES.fan, label: `礼物「${name}」`, kind: 'gift', vars: { gift: name, giftId, count: 1, valueGold: g?.price ?? 0 } });
}
/** 价值分段预览用的礼物：礼物面板上落在这一段里最便宜的一个；没有时用比这一段便宜的最贵的一个，多送几个凑够 */
function bandSample(from: number, to: number | undefined): { gift: string; giftId?: number; count: number; valueGold: number } {
  const paid = catalog.value.filter((g) => g.paid && g.price > 0 && g.tab).sort((a, b) => a.price - b.price);
  const inside = paid.find((g) => g.price >= from && (to === undefined || g.price < to));
  if (inside) return { gift: inside.name, giftId: inside.id, count: 1, valueGold: inside.price };
  const below = [...paid].reverse().find((g) => g.price < from);
  if (below) {
    const count = Math.ceil(from / below.price);
    return { gift: below.name, giftId: below.id, count, valueGold: below.price * count };
  }
  return { gift: '礼物', count: 1, valueGold: from };
}
function previewBand(i: number): void {
  const b = bands.value[i]!;
  emit('preview', { effectId: b.effectId, viewer: SAMPLES.fan, label: `礼物 ${bandLabel(i)}`, kind: 'gift', vars: bandSample(b.fromGold, bandHi(i)) });
}
</script>

<template>
  <div v-if="rules">
    <div class="rtool">
      <span class="say">先看是不是指定礼物，不是的话按这次送的总价值找对应的一段。<button class="linkish" :aria-expanded="help" @click="help = !help"><Icon name="i-info" />怎么判断</button></span>
      <span class="sp" />
      <span v-if="state.settings" class="set" title="礼物特效里的礼物图用 B站的动图；关掉用静态图（直播电脑比较卡时可以关掉）">礼物图用动图<Switch v-model="state.settings.giftAnimImg" label="礼物图用动图" @change="setAnim" /></span>
      <span class="set">连击合并<Switch v-model="rules.comboEnabled" label="连击合并" @change="(v) => save(v ? '已开启连击合并' : '已关闭连击合并，每次送礼都单独处理')" /><template v-if="rules.comboEnabled">同一个人 <CdPick v-model="rules.comboSec" unit="sec" :options="[1, 2, 3, 5, 8, 10, 15]" :max="15" :allow-zero="false" hint="这段时间里连续送同一种礼物，合成一次特效" @change="(v) => save(`连击合并时间：${v} 秒`)" /> 内连续送，合成一次</template></span>
    </div>
    <div v-if="help" class="rhelp">
      <b>总价值</b> = 单价 × 数量，按 B站礼物面板的电池计算（1 电池 = 0.1 元）。免费礼物不播放。<br />
      <b>{{ battery(JUMP_GOLD) }}（{{ yuan(JUMP_GOLD) }}）以上</b>的礼物{{ state.settings?.queueJump === false ? '按顺序排队（排队设置里关掉了插队）' : '会插队优先播放（可在总览「排队设置」里关掉）' }}。<br />
      <b>B站动画</b>：有 B站全屏动画的礼物（大多是 5 元以上的）播 B站官方的动画，下方显示是谁送的；没有动画的礼物 100 元以上显示晶耀、以下显示晶礼。观众在 B站 App 里也会看到 App 自己播的动画，不想重复可以给这一段换成别的特效。<br />
      <b>礼物图用动图</b>：礼物特效里的礼物图用 B站的动图，关掉用静态图，对所有礼物特效都有效。<br />
      <b>连击合并</b>：同一个人在设定的几秒内连续送同一种礼物，合成一次特效，显示总数量，按合起来的总价值选特效；连击停下后才播放，会晚几秒。关掉后每次送礼都单独处理。
    </div>

    <div class="rsec"><h3>指定礼物</h3><span>送这些礼物时用这里的特效，优先于按价值</span></div>
    <div class="rt">
      <div v-if="rules.specific.length" class="rt-h" :style="{ gridTemplateColumns: COLS }"><span>开关</span><span>礼物</span><span>播放的特效</span><span /><span>操作</span></div>
      <div v-for="s in rules.specific" :key="s.giftId" class="rt-r" :class="{ off: !s.enabled }" :style="{ gridTemplateColumns: COLS }" :title="s.enabled ? undefined : `已关闭：「${s.giftName}」按价值分段处理`">
        <div class="c-sw"><Switch v-model="s.enabled" :label="`指定礼物 ${s.giftName}`" @change="(v) => save(v ? `已打开「${s.giftName}」` : `已关闭「${s.giftName}」，按价值分段处理`)" /></div>
        <div class="c-who">
          <img v-if="giftOf(s.giftId)?.icon" class="gico" :src="giftOf(s.giftId)!.icon" alt="" referrerpolicy="no-referrer" />
          <span class="nm"><b>{{ s.giftName || `礼物 ${s.giftId}` }}</b><span v-if="giftOf(s.giftId)" class="uid">{{ battery(giftOf(s.giftId)!.price) }} / 个（{{ yuan(giftOf(s.giftId)!.price) }}）</span></span>
        </div>
        <div class="c-eff"><EffectPicker v-model="s.effectId" kind="gift" @change="(id) => save(`「${s.giftName}」改为播放「${effectById(id)?.name}」`)" /></div>
        <div />
        <div class="c-act"><button class="icon-btn play" :aria-label="`预览送出 ${s.giftName}`" :title="`预览送出 ${s.giftName}`" @click="previewSpec(s.giftId, s.giftName, s.effectId)"><svg><use href="#i-play" /></svg></button><RowMenu :items="specMenu(s.giftId, s.effectId)" :label="`指定礼物 ${s.giftName}：更多操作`" /></div>
      </div>
      <div class="rt-foot">
        <GiftCatalogError v-if="catalogErr" :error="catalogErr" :no-room="noRoom" :loading="catalogLoading" @retry="loadCatalog" />
        <button v-else class="btn" :aria-expanded="picking" @click="picking = !picking"><Icon name="i-plus" />从礼物列表里选</button>
        <span v-if="!rules.specific.length">还没有指定礼物：所有礼物都按下面的价值分段处理</span>
      </div>
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

    <div class="rsec"><h3>按价值</h3><span>一次送出的总价值落在哪一段，就播哪一段的特效</span></div>
    <div class="rt">
      <div class="rl-val">
        <div class="valbar">
          <div v-for="x in valueBar" :key="x.key" :class="{ none: !x.color }" :style="x.color ? { background: x.color } : {}"><b>{{ x.name }}</b><span>{{ x.range }}</span></div>
        </div>
        <div class="valticks two"><span v-for="t in ticks" :key="t.key" :style="{ left: `${t.left}%` }">{{ t.text }}<i>{{ t.note }}</i></span></div>
      </div>
      <div class="rt-h" :style="{ gridTemplateColumns: COLS, borderTop: '1px solid var(--line)' }"><span>开关</span><span>一次送出的价值</span><span>播放的特效</span><span /><span>操作</span></div>
      <div v-for="(b, i) in bands" :key="b.fromGold" class="rt-r" :class="{ off: !b.enabled }" :style="{ gridTemplateColumns: COLS }" :title="b.enabled ? undefined : `已关闭：${bandLabel(i)}的礼物不播放特效`">
        <div class="c-sw"><Switch v-model="b.enabled" :label="`${bandLabel(i)}的礼物特效`" @change="(v) => save(v ? `已打开 ${bandLabel(i)}` : `已关闭 ${bandLabel(i)}，这段价值的礼物不播放特效`)" /></div>
        <div class="val"><b>{{ bandLabel(i) }}</b><span>{{ bandYuan(i) }}</span></div>
        <div class="c-eff"><EffectPicker v-model="b.effectId" kind="gift" @change="(id) => save(`${bandLabel(i)}的礼物改为播放「${effectById(id)?.name}」`)" /></div>
        <div><span v-if="jumps(b.fromGold)" class="jump">插队优先播放</span></div>
        <div class="c-act"><button class="icon-btn play" :aria-label="`预览 ${bandLabel(i)}的礼物`" :title="`预览 ${bandLabel(i)}的礼物`" @click="previewBand(i)"><svg><use href="#i-play" /></svg></button><RowMenu :items="bandMenu(b)" :label="`${bandLabel(i)}：更多操作`" /></div>
      </div>
      <div class="rt-foot">
        <span v-if="bands.length">{{ battery(bands[bands.length - 1]!.fromGold) }}以下的礼物不播放</span>
        <span style="flex: 1" />
        <span v-if="adding" class="lvadd">在 <input v-model.number="addBattery" class="inp num" type="number" min="1" step="1" placeholder="500" aria-label="在多少电池处分一段" @keydown.enter="addBand" @keydown.esc="adding = false" /> 电池<span v-if="Number(addBattery) >= 1" class="hint">（{{ yuan(Math.round(Number(addBattery)) * 100) }}）</span>处再分一段 <button class="btn" @click="addBand">分段</button><button class="linkish" style="color: var(--t3)" @click="adding = false">取消</button><span class="hint" :style="{ color: bandMsg.err ? '#D64545' : '' }">{{ bandMsg.text }}</span></span>
        <button v-else class="linkish" @click="adding = true">＋ 加一段</button>
      </div>
    </div>
  </div>
</template>
