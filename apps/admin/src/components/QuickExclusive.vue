<script setup lang="ts">
// 快捷设置专属（总览实时动态、事件记录里点观众）：小窗口完成，不跳页（F-UI-03）
import { computed, ref } from 'vue';
import { del, post, put } from '../lib/api.ts';
import { go } from '../lib/route.ts';
import { refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import CdPick from './CdPick.vue';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import EffThumb from './EffThumb.vue';
import HonorMedal from './HonorMedal.vue';
import IdTag from './IdTag.vue';
import { useEsc } from '../lib/esc.ts';

const emit = defineEmits<{ close: [] }>();
const q = ui.quick!;
const existing = computed(() => state.exclusives.find((x) => x.uid === q.uid));
// 新设置时不默认选中，免得看起来像已经设好了
const sel = ref<number | null>(existing.value?.effectId ?? null);
const cd = ref(existing.value?.cooldownMin ?? 10);

async function save(more = false): Promise<void> {
  if (!sel.value) return toast('先选一个特效', 'info');
  const body = { effectId: sel.value, cooldownMin: cd.value };
  const ok = existing.value
    ? await attempt(() => put(`/api/rules/exclusive/${q.uid}`, body), `已修改 ${q.name} 的专属特效`)
    : await attempt(() => post('/api/rules/exclusive', { uid: q.uid, ...body, until: null, enabled: true }), `已为 ${q.name} 设置专属特效`);
  if (!ok) return;
  await refreshRules();
  void refreshEffects();
  emit('close');
  if (more) go('rules', 'exclusive');
}
async function remove(): Promise<void> {
  if (!(await attempt(() => del(`/api/rules/exclusive/${q.uid}`), `已取消 ${q.name} 的专属特效`))) return;
  await refreshRules();
  emit('close');
}
// 按 Esc 关闭
useEsc(() => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="qdialog" role="dialog" aria-label="设置专属特效">
      <div class="qh">
        <Avatar :name="q.name" :face="q.face" :guard="q.viewer?.guard" />
        <div><b>{{ existing ? '修改' : '为' }} {{ q.name }} {{ existing ? '的专属特效' : '设置专属特效' }}</b><span class="num">UID {{ q.uid }}</span></div>
        <span v-if="q.viewer" class="ids" style="margin-left: auto"><HonorMedal :level="q.viewer.honor" /><IdTag :viewer="q.viewer" /></span>
      </div>
      <div class="qb">
        <div class="field">
          <span class="flabel">选择特效 <span class="hint">TA 进场时会优先播放这个</span></span>
          <div class="qgrid">
            <button v-for="e in state.effects" :key="e.id" type="button" :aria-pressed="e.id === sel" @click="sel = e.id"><EffThumb :effect="e" /><span>{{ e.name }}</span></button>
          </div>
        </div>
        <div class="field">
          <span class="flabel">同一个人多久内只播一次</span>
          <div><CdPick v-model="cd" after="内只播一次" /></div>
        </div>
      </div>
      <div class="qf">
        <button class="linkish" :disabled="!sel" @click="save(true)">保存并去设置有效期</button>
        <ConfirmButton v-if="existing" label="取消专属" cls="btn" @confirm="remove" />
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="save()">保存</button>
      </div>
    </div>
  </Teleport>
</template>
