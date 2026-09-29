<script setup lang="ts">
// 快捷设置专属（总览实时动态、事件记录里点观众）：小窗口完成，不跳页（F-UI-03）
import { computed, ref } from 'vue';
import { del, post, put } from '../lib/api.ts';
import { go } from '../lib/route.ts';
import { refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import EffSwatch from './EffSwatch.vue';
import IdTag from './IdTag.vue';

const emit = defineEmits<{ close: [] }>();
const q = ui.quick!;
const existing = computed(() => state.exclusives.find((x) => x.uid === q.uid));
const sel = ref<number | null>(existing.value?.effectId ?? state.enter?.tiers.gov.effectId ?? state.effects[0]?.id ?? null);
const cd = ref(existing.value?.cooldownMin ?? 10);

async function save(more = false): Promise<void> {
  if (!sel.value) return;
  const body = { effectId: sel.value, cooldownMin: cd.value };
  const ok = existing.value
    ? await attempt(() => put(`/api/rules/exclusive/${q.uid}`, body), `已修改 ${q.name} 的专属素材`)
    : await attempt(() => post('/api/rules/exclusive', { uid: q.uid, ...body, until: null, enabled: true }), `已为 ${q.name} 设置专属素材`);
  if (!ok) return;
  await refreshRules();
  void refreshEffects();
  emit('close');
  if (more) go('rules', 'exclusive');
}
async function remove(): Promise<void> {
  if (!(await attempt(() => del(`/api/rules/exclusive/${q.uid}`), `已取消 ${q.name} 的专属素材`))) return;
  await refreshRules();
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="qdialog" role="dialog" aria-label="设置专属素材">
      <div class="qh">
        <Avatar :name="q.name" :face="q.face" :guard="q.viewer?.guard" />
        <div><b>{{ existing ? '修改' : '为' }} {{ q.name }} {{ existing ? '的专属素材' : '设置专属素材' }}</b><span class="num">UID {{ q.uid }}</span></div>
        <span v-if="q.viewer" style="margin-left: auto"><IdTag :viewer="q.viewer" /></span>
      </div>
      <div class="qb">
        <div class="field">
          <span class="flabel">选择素材 <span class="hint">TA 进场时会优先播放这个</span></span>
          <div class="qgrid">
            <button v-for="e in state.effects" :key="e.id" type="button" :aria-pressed="e.id === sel" @click="sel = e.id"><EffSwatch :effect="e" /><span>{{ e.name }}</span></button>
          </div>
        </div>
        <div class="field">
          <span class="flabel">冷却</span>
          <div class="suffix" style="max-width: 200px"><input v-model.number="cd" class="inp num" type="number" min="0" max="1440" /><span>分钟</span></div>
        </div>
      </div>
      <div class="qf">
        <button class="linkish" @click="save(true)">更多设置（有效期等）</button>
        <ConfirmButton v-if="existing" label="取消专属" cls="btn" @confirm="remove" />
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="save()">保存</button>
      </div>
    </div>
  </Teleport>
</template>
