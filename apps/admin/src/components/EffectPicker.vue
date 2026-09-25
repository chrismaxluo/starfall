<script setup lang="ts">
// 选择素材：按钮 + 弹出列表（我的素材 / 内置素材），可以当场上传新素材
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { upload } from '../lib/api.ts';
import { effectById, refreshEffects, state, ui } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import type { AssetDto, EffectDto } from '../lib/types.ts';
import EffSwatch from './EffSwatch.vue';
import Icon from './Icon.vue';

const model = defineModel<number | null>({ required: true });
const emit = defineEmits<{ change: [id: number] }>();
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const file = ref<HTMLInputElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
const current = computed(() => effectById(model.value));
const groups = computed(() => [
  { name: '我的素材', list: state.effects.filter((e) => !e.builtin) },
  { name: '内置素材', list: state.effects.filter((e) => e.builtin) },
]);

function close(): void {
  open.value = false;
  removeEventListener('mousedown', outside, true);
  removeEventListener('scroll', onScroll, true);
}
function outside(e: MouseEvent): void {
  if (!pop.value?.contains(e.target as Node) && !btn.value?.contains(e.target as Node)) close();
}
function onScroll(e: Event): void {
  if (!pop.value?.contains(e.target as Node)) close();
}
async function toggle(): Promise<void> {
  if (open.value) return close();
  open.value = true;
  await nextTick();
  const r = btn.value!.getBoundingClientRect();
  const h = pop.value?.offsetHeight ?? 300;
  pos.value = { left: Math.max(8, Math.min(r.left, innerWidth - 312)), top: r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 };
  addEventListener('mousedown', outside, true);
  addEventListener('scroll', onScroll, true);
}
function pick(e: EffectDto): void {
  close();
  if (e.id === model.value) return;
  model.value = e.id;
  emit('change', e.id);
}
async function onFile(): Promise<void> {
  const f = file.value?.files?.[0];
  if (file.value) file.value.value = '';
  if (!f) return;
  close();
  try {
    toast(`正在上传 ${f.name}…`, 'info');
    const r = await upload<{ asset: AssetDto; effect: EffectDto | null }>('/api/assets', f);
    await refreshEffects();
    if (r.effect) {
      model.value = r.effect.id;
      emit('change', r.effect.id);
      toast(`已上传并选用「${r.effect.name}」`);
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
  }
}
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" type="button" class="effbtn" :class="{ missing: model !== null && !current }" :aria-label="`选择素材，当前：${current?.name ?? '未选择'}`" @click.stop="toggle">
    <EffSwatch :effect="current" />
    <span class="nm">{{ current ? current.name : model !== null ? '素材已删除' : '未选择' }}</span>
    <Icon name="i-chev" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="pickpop" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <div class="list">
        <template v-for="g in groups" :key="g.name">
          <template v-if="g.list.length">
            <div class="grp">{{ g.name }}</div>
            <button v-for="e in g.list" :key="e.id" type="button" class="opt" :aria-selected="e.id === model" @click="pick(e)">
              <EffSwatch :effect="e" />{{ e.name }}<small>{{ e.usedBy.length ? `${e.usedBy.length} 处在用` : '' }}</small>
            </button>
          </template>
        </template>
      </div>
      <div class="foot">
        <button type="button" @click="file?.click()">＋ 上传新素材</button>
        <button v-if="current" type="button" @click="(close(), (ui.editorId = current.id))">调整当前素材</button>
      </div>
      <input ref="file" type="file" hidden accept=".webm,.mp4,.svga,.json,.gif,.png,.apng,.webp,.jpg,.jpeg" @change="onFile" />
    </div>
  </Teleport>
</template>
