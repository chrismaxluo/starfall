<script setup lang="ts">
// 上舰规则（F-GD-01 ~ 02）：总督 / 提督 / 舰长各一条。开通和续费用同一个特效时只显示一个选择，也可以分开选
import { reactive } from 'vue';
import { get, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import type { GuardRules } from '../lib/types.ts';
import EffectPicker from './EffectPicker.vue';
import IdTag from './IdTag.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
const ROWS = [
  { key: 'gov', level: 1, name: '总督' },
  { key: 'adm', level: 2, name: '提督' },
  { key: 'cap', level: 3, name: '舰长' },
] as const;
type Key = (typeof ROWS)[number]['key'];
/** 点了「续费用别的特效」：即使两边暂时一样，也分开显示 */
const split = reactive<Record<Key, boolean>>({ gov: false, adm: false, cap: false });
const separate = (k: Key) => split[k] || state.guard![k].openEffectId !== state.guard![k].renewEffectId;

async function save(msg?: string): Promise<void> {
  if (!state.guard) return;
  const r = await attempt(() => put<GuardRules>('/api/rules/guard', state.guard), msg);
  state.guard = r ?? (await get<GuardRules>('/api/rules/guard'));
  void refreshEffects();
}
function setBoth(row: (typeof ROWS)[number], id: number): void {
  state.guard![row.key].renewEffectId = id;
  void save(`${row.name}开通、续费都播放「${effectById(id)?.name ?? ''}」`);
}
function merge(row: (typeof ROWS)[number]): void {
  const g = state.guard![row.key];
  split[row.key] = false;
  g.renewEffectId = g.openEffectId;
  void save(`${row.name}续费改回和开通用同一个特效`);
}
function preview(row: (typeof ROWS)[number], op: 'open' | 'renew'): void {
  const g = state.guard![row.key];
  emit('preview', { effectId: op === 'open' ? g.openEffectId : g.renewEffectId, viewer: SAMPLES[row.key], label: `${op === 'open' ? '开通' : '续费'}${row.name}`, kind: 'guard', vars: { months: op === 'open' ? 1 : 3, guardLevel: row.level, op } });
}
</script>

<template>
  <div v-if="state.guard">
    <div class="rl-flow"><span>有人开通或续费大航海时播放，会<b>插队优先</b>。同一次上舰 B 站会发好几条消息，星临只播一次。</span></div>
    <div class="rl-list">
      <div v-for="row in ROWS" :key="row.key" class="rl" :class="{ off: !state.guard[row.key].enabled }">
        <span class="who"><IdTag :identity="row.key" /></span>
        <span v-if="!separate(row.key)" class="say">
          有人<b>开通或续费{{ row.name }}</b>时，播放 <EffectPicker v-model="state.guard[row.key].openEffectId" @change="(id) => setBoth(row, id)" />
          <button class="linkish sm" @click="split[row.key] = true">续费用别的特效</button>
          <span v-if="!state.guard[row.key].enabled" class="offnote">已关闭：{{ row.name }}上舰不播放特效</span>
        </span>
        <span v-else class="say">
          有人<b>开通{{ row.name }}</b>时，播放 <EffectPicker v-model="state.guard[row.key].openEffectId" @change="(id) => save(`开通${row.name}：${effectById(id)?.name}`)" />；
          <b>续费</b>时，播放 <EffectPicker v-model="state.guard[row.key].renewEffectId" @change="(id) => save(`续费${row.name}：${effectById(id)?.name}`)" />
          <button class="linkish sm" @click="merge(row)">改回同一个</button>
          <span v-if="!state.guard[row.key].enabled" class="offnote">已关闭：{{ row.name }}上舰不播放特效</span>
        </span>
        <span class="acts">
          <button class="playmini" :aria-label="`预览开通${row.name}`" @click="preview(row, 'open')"><svg><use href="#i-play" /></svg></button>
          <Switch v-model="state.guard[row.key].enabled" :label="`${row.name}上舰特效`" @change="(v) => save(v ? `已打开${row.name}上舰特效` : `已关闭${row.name}上舰特效`)" />
        </span>
      </div>
    </div>
    <div class="rl-note">欢迎语里可以用 <b>{act}</b> 显示「上舰 / 续费」，<b>{months}</b> 显示月数，在素材库里改。</div>
  </div>
</template>
