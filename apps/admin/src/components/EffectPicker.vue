<script setup lang="ts">
// 选择特效：按钮 + 弹出列表（我的素材 / 内置素材），每项有缩略画面，点 ▶ 只预览、不改规则；可以当场上传新素材
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { upload } from '../lib/api.ts';
import { PREVIEW_BY_KIND } from '../lib/preview.ts';
import { effectById, refreshEffects, state, ui } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import { checkFile } from '../lib/upload-check.ts';
import type { AssetDto, EffectDto, TriggerKind } from '../lib/types.ts';
import EffThumb from './EffThumb.vue';
import Icon from './Icon.vue';
import { pushEsc } from '../lib/esc.ts';

/** kind：这个选择框用在哪类事件上（预览时按它播放：礼物带礼物图、弹幕带弹幕内容） */
const props = withDefaults(defineProps<{ kind?: TriggerKind }>(), { kind: 'enter' });
const model = defineModel<number | null>({ required: true });
const emit = defineEmits<{ change: [id: number] }>();
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const file = ref<HTMLInputElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
const current = computed(() => effectById(model.value));
const q = ref('');
const searchable = computed(() => state.effects.length > 10);
const groups = computed(() => {
  const hit = (e: EffectDto) => !q.value.trim() || e.name.toLowerCase().includes(q.value.trim().toLowerCase());
  return [
    { name: '我的素材', list: state.effects.filter((e) => !e.builtin && hit(e)) },
    { name: '内置素材', list: state.effects.filter((e) => e.builtin && hit(e)) },
  ];
});
const usedText = (e: EffectDto) => (e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '还没有规则在用');

// 预览时先收起列表，关掉预览后再打开，方便接着挑
let reopen = false;
function preview(e: EffectDto): void {
  reopen = true;
  close();
  ui.preview = { effectId: e.id, label: '只是预览，不会改规则', ...PREVIEW_BY_KIND[props.kind] };
}
watch(
  () => ui.preview,
  (p) => {
    if (p || !reopen) return;
    reopen = false;
    void toggle();
  },
);

let offEsc: (() => void) | null = null;
function close(): void {
  offEsc?.();
  offEsc = null;
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
  pop.value?.querySelector<HTMLInputElement>('.pick-q')?.focus();
  const r = btn.value!.getBoundingClientRect();
  const h = pop.value?.offsetHeight ?? 300;
  pos.value = { left: Math.max(8, Math.min(r.left, innerWidth - 392)), top: r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 };
  addEventListener('mousedown', outside, true);
  offEsc ??= pushEsc(close);
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
  const bad = checkFile(f, 'anim');
  if (bad) return toast(bad, 'err', 6000);
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
  <button ref="btn" type="button" class="effbtn" :class="{ missing: model !== null && !current }" :aria-label="`选择特效，当前：${current?.name ?? '未选择'}`" @click.stop="toggle">
    <EffThumb :effect="current" />
    <span class="nm">{{ current ? current.name : model !== null ? '素材已删除' : '未选择' }}</span>
    <Icon name="i-chev" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="pickpop" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <div v-if="searchable" class="pick-search"><Icon name="i-search" /><input v-model="q" class="pick-q" placeholder="搜索特效名称" aria-label="搜索特效名称" @keydown.esc="close" /></div>
      <div class="list">
        <template v-for="g in groups" :key="g.name">
          <template v-if="g.list.length">
            <div class="grp">{{ g.name }}</div>
            <div v-for="e in g.list" :key="e.id" class="opt" :class="{ on: e.id === model }">
              <button type="button" class="opt-pick" :aria-selected="e.id === model" @click="pick(e)">
                <EffThumb :effect="e" />
                <span class="opt-t"><b>{{ e.name }}</b><small :title="usedText(e)">{{ usedText(e) }}</small></span>
                <Icon v-if="e.id === model" name="i-check" class="opt-cur" />
              </button>
              <button type="button" class="opt-play" :aria-label="`预览「${e.name}」（不会改规则）`" title="预览（不会改规则）" @click="preview(e)"><svg><use href="#i-play" /></svg></button>
            </div>
          </template>
        </template>
        <div v-if="!groups.some((g) => g.list.length)" class="pick-empty">没有名字里带「{{ q }}」的特效</div>
      </div>
      <div class="foot">
        <button type="button" @click="file?.click()">＋ 上传新素材</button>
        <button v-if="current" type="button" @click="(close(), (ui.editorId = current.id))">调整当前素材</button>
      </div>
      <input ref="file" type="file" hidden accept=".webm,.mp4,.svga,.json,.gif,.png,.apng,.webp,.jpg,.jpeg" @change="onFile" />
    </div>
  </Teleport>
</template>
