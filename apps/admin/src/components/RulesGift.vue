<script setup lang="ts">
// 礼物规则（F-GF-01 ~ 05）：指定礼物（按礼物 ID，从本直播间礼物面板选）→ 按单次价值分档；免费礼物不触发；连击合并
import { computed, onMounted, ref } from 'vue';
import { get, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import { yuan } from '../lib/preview.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import type { GiftBand, GiftConfig, GiftRules } from '../lib/types.ts';
import ConfirmButton from './ConfirmButton.vue';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
const catalog = ref<GiftConfig[]>([]);
const catalogErr = ref('');
const pickGift = ref<number | ''>('');
const addYuan = ref<number | null>(null);
const bandMsg = ref<{ text: string; err: boolean }>({ text: '低于最低一档的礼物不播特效', err: false });

const rules = computed(() => state.gift);
const bands = computed(() => [...(rules.value?.bands ?? [])].sort((a, b) => b.fromGold - a.fromGold));
const giftOf = (id: number) => catalog.value.find((g) => g.id === id);
const available = computed(() => catalog.value.filter((g) => g.paid && !rules.value?.specific.some((s) => s.giftId === g.id)));

function bandLabel(i: number): string {
  const b = bands.value[i]!;
  return i === 0 ? `≥ ${yuan(b.fromGold)}` : `${yuan(b.fromGold).replace(' 元', '')} – ${yuan(bands.value[i - 1]!.fromGold)}`;
}

async function save(msg?: string): Promise<void> {
  if (!rules.value) return;
  const r = await attempt(() => put<GiftRules>('/api/rules/gift', rules.value), msg);
  if (r) state.gift = r;
  else state.gift = await get<GiftRules>('/api/rules/gift');
  void refreshEffects();
}

function addSpecific(): void {
  const g = giftOf(Number(pickGift.value));
  if (!g || !rules.value) return;
  const eff = state.effects.find((e) => e.name === '礼物感谢')?.id ?? null;
  rules.value.specific.push({ giftId: g.id, giftName: g.name, effectId: eff, enabled: true });
  pickGift.value = '';
  void save(`已添加指定礼物：${g.name}`);
}
function removeSpecific(id: number): void {
  if (!rules.value) return;
  rules.value.specific = rules.value.specific.filter((s) => s.giftId !== id);
  void save('已删除指定礼物');
}
function addBand(): void {
  if (!rules.value) return;
  const v = Number(addYuan.value);
  if (!(v > 0)) return void (bandMsg.value = { text: '请输入大于 0 的金额', err: true });
  const gold = Math.round(v * 1000);
  if (rules.value.bands.some((b) => b.fromGold === gold)) return void (bandMsg.value = { text: `已经有 ${yuan(gold)} 这一档了`, err: true });
  const parent = bands.value.find((b) => b.fromGold < gold) ?? bands.value[bands.value.length - 1]!;
  rules.value.bands.push({ fromGold: gold, effectId: parent.effectId, enabled: parent.enabled });
  addYuan.value = null;
  bandMsg.value = { text: '低于最低一档的礼物不播特效', err: false };
  void save(`已添加分档：≥ ${yuan(gold)}`);
}
function removeBand(b: GiftBand): void {
  if (!rules.value || rules.value.bands.length <= 1) return;
  rules.value.bands = rules.value.bands.filter((x) => x.fromGold !== b.fromGold);
  void save('已删除分档，这些价值并入相邻档');
}
function setCombo(e: Event): void {
  if (!rules.value) return;
  const el = e.target as HTMLInputElement;
  const v = Math.max(1, Math.min(15, Math.round(Number(el.value) || 3)));
  el.value = String(v);
  rules.value.comboSec = v;
  void save(`连击合并时间：${v} 秒`);
}
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
    <div class="subbar"><span class="subhint">先看是不是指定礼物，再按单次价值（数量 × 单价）分档。免费礼物不触发。</span></div>
    <div class="tlist">
      <div class="tgroup"><b>指定礼物</b><span>送出这些礼物时优先使用这里的素材（按礼物 ID 匹配，同名不同价的礼物分得开）</span></div>
      <div v-for="(s, i) in rules.specific" :key="s.giftId" class="trow gift" :class="{ off: !s.enabled }">
        <span class="prio">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="cond">
          <span class="gname">
            <img v-if="giftOf(s.giftId)?.icon" :src="giftOf(s.giftId)!.icon" alt="" referrerpolicy="no-referrer" style="width: 26px; height: 26px; object-fit: contain" />
            <span v-else class="gico">{{ [...s.giftName][0] ?? '礼' }}</span>
            {{ s.giftName || `礼物 ${s.giftId}` }}
            <span v-if="giftOf(s.giftId)" class="gprice">{{ yuan(giftOf(s.giftId)!.price) }} / 个</span>
          </span>
        </span>
        <EffectPicker v-model="s.effectId" @change="(id) => (save(`已换成素材「${effectById(id)?.name}」`), previewSpec(s.giftId, s.giftName, id))" />
        <Switch v-model="s.enabled" label="启用" @change="() => save()" />
        <button class="playmini" aria-label="在右侧预览" @click="previewSpec(s.giftId, s.giftName, s.effectId)"><svg><use href="#i-play" /></svg></button>
        <ConfirmButton label="" confirm-label="删除" cls="rm" armed-cls="delb" aria-label="删除指定礼物" @confirm="removeSpecific(s.giftId)"><Icon name="i-x" style="width: 12px; height: 12px" /></ConfirmButton>
      </div>
      <div class="addband">
        <Icon name="i-plus" />添加指定礼物
        <select v-model="pickGift" class="sel sm" style="min-width: 200px" aria-label="选择礼物" :disabled="!available.length">
          <option value="">{{ catalogErr ? '读取礼物面板失败' : available.length ? '选择礼物…' : '没有可选的礼物' }}</option>
          <option v-for="g in available" :key="g.id" :value="g.id">{{ g.name }}（{{ yuan(g.price) }}）</option>
        </select>
        <button class="btn" style="height: 30px" :disabled="!pickGift" @click="addSpecific">添加</button>
        <span class="msg" :style="catalogErr ? 'color:#D64545' : ''">{{ catalogErr || '礼物列表来自你直播间的礼物面板' }}</span>
      </div>

      <div class="tgroup"><b>按单次价值分档</b><span>数量 × 单价，高档优先，不会重叠</span></div>
      <div v-for="(b, i) in bands" :key="b.fromGold" class="trow gift" :class="{ off: !b.enabled }">
        <span class="prio">{{ String(rules.specific.length + i + 1).padStart(2, '0') }}</span>
        <span class="cond">单次价值 <b>{{ bandLabel(i) }}</b></span>
        <EffectPicker v-model="b.effectId" @change="(id) => (save(`已换成素材「${effectById(id)?.name}」`), previewBand(i))" />
        <Switch v-model="b.enabled" :label="`启用 ${bandLabel(i)}`" @change="(v) => save(v ? `已启用 ${bandLabel(i)}` : `已停用 ${bandLabel(i)}，这个价值区间的礼物不播特效`)" />
        <button class="playmini" aria-label="在右侧预览" @click="previewBand(i)"><svg><use href="#i-play" /></svg></button>
        <ConfirmButton v-if="bands.length > 1" label="" confirm-label="删除" cls="rm" armed-cls="delb" aria-label="删除这一档" @confirm="removeBand(b)"><Icon name="i-x" style="width: 12px; height: 12px" /></ConfirmButton>
        <span v-else />
      </div>
      <div class="addband">
        <Icon name="i-plus" />添加分档：单次 ≥ <input v-model.number="addYuan" type="number" min="0.1" step="0.1" placeholder="50" aria-label="起始金额" @keydown.enter="addBand" /> 元
        <button class="btn" style="height: 30px" @click="addBand">添加</button>
        <span class="msg" :style="{ color: bandMsg.err ? '#D64545' : '' }">{{ bandMsg.text }}</span>
      </div>

      <div class="tgroup"><b>连击</b></div>
      <div class="trow combo">
        <span class="cond">同一个人连续送同一种礼物，<b>{{ rules.comboSec }} 秒</b>内合并成一次特效，欢迎语里用 {count} 显示数量</span>
        <span class="cdin"><input type="number" min="1" max="15" :value="rules.comboSec" aria-label="合并时间" @change="setCombo" /><span>秒</span></span>
        <Switch v-model="rules.comboEnabled" label="连击合并" @change="(v) => save(v ? '已开启连击合并' : '已关闭连击合并，每次送礼都单独处理')" />
      </div>
    </div>
  </div>
</template>
