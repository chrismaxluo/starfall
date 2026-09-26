<script setup lang="ts">
// 上舰规则（F-GD-01 ~ 02）：总督 / 提督 / 舰长各一行，开通和续费分别选素材
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

async function save(msg?: string): Promise<void> {
  if (!state.guard) return;
  const r = await attempt(() => put<GuardRules>('/api/rules/guard', state.guard), msg);
  state.guard = r ?? (await get<GuardRules>('/api/rules/guard'));
  void refreshEffects();
}
function preview(row: (typeof ROWS)[number], op: 'open' | 'renew'): void {
  const g = state.guard![row.key];
  emit('preview', { effectId: op === 'open' ? g.openEffectId : g.renewEffectId, viewer: SAMPLES[row.key], label: `${op === 'open' ? '开通' : '续费'}${row.name}`, kind: 'guard', vars: { months: op === 'open' ? 1 : 3, guardLevel: row.level, op } });
}
</script>

<template>
  <div v-if="state.guard">
    <div class="subbar"><span class="subhint">有人开通或续费大航海时播放，欢迎语里可以用 {months} 显示月数、{op} 显示「开通」或「续费」。</span></div>
    <div class="tlist">
      <div class="grow head"><span>身份</span><span>开通</span><span>续费</span><span>启用</span><span /></div>
      <div v-for="row in ROWS" :key="row.key" class="grow" :class="{ off: !state.guard[row.key].enabled }">
        <span><IdTag :identity="row.key" /></span>
        <span class="gpick"><i>开通</i><EffectPicker v-model="state.guard[row.key].openEffectId" @change="(id) => (save(`开通${row.name}：${effectById(id)?.name}`), preview(row, 'open'))" /></span>
        <span class="gpick"><i>续费</i><EffectPicker v-model="state.guard[row.key].renewEffectId" @change="(id) => (save(`续费${row.name}：${effectById(id)?.name}`), preview(row, 'renew'))" /></span>
        <Switch v-model="state.guard[row.key].enabled" :label="`启用${row.name}`" @change="(v) => save(v ? `已启用${row.name}上舰特效` : `已停用${row.name}上舰特效`)" />
        <button class="playmini" aria-label="在右侧预览开通" @click="preview(row, 'open')"><svg><use href="#i-play" /></svg></button>
      </div>
    </div>
    <div class="subhint" style="margin-top: 10px">续费和开通想用同一个素材，两边选同一个就行。上舰默认可以插队，见右侧「播放队列」。</div>
  </div>
</template>
