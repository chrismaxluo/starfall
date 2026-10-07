<script setup lang="ts">
// 上舰规则（F-GD-01 ~ 02）：总督 / 提督 / 舰长各一行，开通、续费各占一列；续费默认和开通一样，点一下可以单独选
import { reactive } from 'vue';
import { get, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, state, ui } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { GuardRules } from '../lib/types.ts';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import IdTag from './IdTag.vue';
import RowMenu from './RowMenu.vue';
import type { MenuItem } from './RowMenu.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
/** 列宽：开关 | 等级 | 开通 | 续费 | 空 | 操作 */
const COLS = '44px minmax(110px, 150px) minmax(190px, 280px) minmax(190px, 280px) minmax(0, 1fr) 68px';
const ROWS = [
  { key: 'gov', level: 1, name: '总督' },
  { key: 'adm', level: 2, name: '提督' },
  { key: 'cap', level: 3, name: '舰长' },
] as const;
type Key = (typeof ROWS)[number]['key'];
/** 点了「续费用别的特效」：即使两边暂时一样，也分开显示 */
const split = reactive<Record<Key, boolean>>({ gov: false, adm: false, cap: false });
const separate = (k: Key) => split[k] || state.guard![k].openEffectId !== state.guard![k].renewEffectId;

async function save(msg?: string, undo?: () => Promise<unknown>): Promise<void> {
  if (!state.guard) return;
  const r = await attempt(() => put<GuardRules>('/api/rules/guard', state.guard), undo ? undefined : msg);
  if (r && undo && msg) undoable(msg, undo);
  state.guard = r ?? (await get<GuardRules>('/api/rules/guard'));
  void refreshEffects();
}
function setBoth(row: (typeof ROWS)[number], id: number): void {
  state.guard![row.key].renewEffectId = id;
  void save(`${row.name}开通、续费都播放「${effectById(id)?.name ?? ''}」`);
}
function merge(row: (typeof ROWS)[number]): void {
  const g = state.guard![row.key];
  const old = g.renewEffectId;
  split[row.key] = false;
  g.renewEffectId = g.openEffectId;
  void save(`${row.name}续费改回和开通用同一个特效`, async () => {
    if (!state.guard) return;
    state.guard[row.key].renewEffectId = old;
    split[row.key] = true;
    await save(`${row.name}续费恢复成「${effectById(old)?.name ?? ''}」`);
  });
}
/** 续费单独选：先沿用开通的特效，再打开选择 */
function splitRenew(row: (typeof ROWS)[number]): void {
  split[row.key] = true;
}
function editEffect(id: number | null): void {
  if (!id) return toast('还没有选特效', 'info');
  ui.editorId = id;
}
const menu = (row: (typeof ROWS)[number]): Array<MenuItem | null> => {
  const g = state.guard![row.key];
  return separate(row.key)
    ? [
        { icon: 'i-play', label: `预览续费${row.name}`, run: () => preview(row, 'renew') },
        { icon: 'i-replay', label: '续费改回和开通一样', run: () => merge(row) },
        null,
        { icon: 'i-pen', label: '调整开通的特效（素材设置）', run: () => editEffect(g.openEffectId) },
        { icon: 'i-pen', label: '调整续费的特效（素材设置）', run: () => editEffect(g.renewEffectId) },
      ]
    : [
        { icon: 'i-dup', label: '续费用别的特效', run: () => splitRenew(row) },
        { icon: 'i-pen', label: '调整这个特效（素材设置）', run: () => editEffect(g.openEffectId) },
      ];
};
function preview(row: (typeof ROWS)[number], op: 'open' | 'renew'): void {
  const g = state.guard![row.key];
  emit('preview', { effectId: op === 'open' ? g.openEffectId : g.renewEffectId, viewer: SAMPLES[row.key], label: `${op === 'open' ? '开通' : '续费'}${row.name}`, kind: 'guard', vars: { months: op === 'open' ? 1 : 3, guardLevel: row.level, op } });
}
</script>

<template>
  <div v-if="state.guard">
    <div class="rtool">
      <span class="say">有人开通或续费大航海时播放，{{ state.settings?.queueJump === false ? '按顺序排队（排队设置里关掉了插队）' : '会插队优先播放' }}。同一次上舰 B站会发好几条消息，星临只播一次。</span>
    </div>
    <div class="rt">
      <div class="rt-h" :style="{ gridTemplateColumns: COLS }"><span>开关</span><span>等级</span><span>开通时播放</span><span>续费时播放</span><span /><span>操作</span></div>
      <div v-for="row in ROWS" :key="row.key" class="rt-r" :class="{ off: !state.guard[row.key].enabled }" :style="{ gridTemplateColumns: COLS }" :title="state.guard[row.key].enabled ? undefined : `已关闭：${row.name}上舰不播放特效`">
        <div class="c-sw"><Switch v-model="state.guard[row.key].enabled" :label="`${row.name}上舰特效`" @change="(v) => save(v ? `已打开${row.name}上舰特效` : `已关闭${row.name}上舰特效`)" /></div>
        <div class="c-who"><IdTag :identity="row.key" /></div>
        <div class="c-eff">
          <EffectPicker v-if="separate(row.key)" v-model="state.guard[row.key].openEffectId" kind="guard" @change="(id) => save(`开通${row.name}：${effectById(id)?.name}`)" />
          <EffectPicker v-else v-model="state.guard[row.key].openEffectId" kind="guard" @change="(id) => setBoth(row, id)" />
        </div>
        <div class="c-eff">
          <EffectPicker v-if="separate(row.key)" v-model="state.guard[row.key].renewEffectId" kind="guard" @change="(id) => save(`续费${row.name}：${effectById(id)?.name}`)" />
          <button v-else type="button" class="effbtn same" :title="`续费${row.name}也播放「${effectById(state.guard[row.key].openEffectId)?.name ?? '未选择'}」，点一下单独选`" @click="splitRenew(row)"><span class="nm">和开通时一样</span><Icon name="i-chev" class="chev" /></button>
        </div>
        <div />
        <div class="c-act"><button class="icon-btn play" :aria-label="`预览开通${row.name}`" :title="`预览开通${row.name}`" @click="preview(row, 'open')"><svg><use href="#i-play" /></svg></button><RowMenu :items="menu(row)" :label="`${row.name}上舰：更多操作`" /></div>
      </div>
    </div>
    <p class="rt-note">欢迎语里可以用 <b>{act}</b> 显示「上舰 / 续费」，<b>{months}</b> 显示月数，在素材库里改。</p>
  </div>
</template>
