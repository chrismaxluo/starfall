<script setup lang="ts">
// 多久内只播一次：点一下弹出常用选项（每次都播 / 1 / 5 / 10 / 30 分钟 / 1 小时），也可以自己填。unit 为 sec 时单位是秒
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{ unit?: 'min' | 'sec'; hint?: string; options?: number[]; max?: number; allowZero?: boolean; after?: string }>(), {
  unit: 'min',
  hint: '同一个观众这段时间里再来，不重复播放',
  options: undefined,
  max: undefined,
  allowZero: true,
  /** 跟在按钮后面的字（例如「内只播一次」）：选了「每次都播」时不显示，免得读成反话 */
  after: '',
});
const model = defineModel<number>({ required: true });
const emit = defineEmits<{ change: [value: number] }>();
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
const opts = computed(() => props.options ?? (props.unit === 'min' ? [0, 1, 5, 10, 30, 60] : [0, 5, 10, 30, 60]));
const limit = computed(() => props.max ?? (props.unit === 'min' ? 1440 : 3600));

function text(v: number): string {
  if (v === 0 && props.allowZero) return '每次都播';
  if (props.unit === 'sec') return `${v} 秒`;
  return v >= 60 && v % 60 === 0 ? `${v / 60} 小时` : `${v} 分钟`;
}
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
  const h = pop.value?.offsetHeight ?? 150;
  pos.value = { left: Math.max(8, Math.min(r.left, innerWidth - 276)), top: r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 };
  addEventListener('mousedown', outside, true);
  addEventListener('scroll', onScroll, true);
}
function set(v: number): void {
  const n = Math.max(props.allowZero ? 0 : 1, Math.min(limit.value, Math.round(v) || 0));
  close();
  if (n === model.value) return;
  model.value = n;
  emit('change', n);
}
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" type="button" class="cdpick" :aria-label="`${hint}：${text(model)}`" :aria-expanded="open" @click.stop="toggle">{{ text(model) }}<Icon name="i-chev" /></button><template v-if="after && !(model === 0 && allowZero)">{{ ' ' + after }}</template>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="cdpop" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <div class="lbl">{{ hint }}</div>
      <div class="opts">
        <button v-for="o in opts" :key="o" type="button" :aria-pressed="model === o" @click="set(o)">{{ text(o) }}</button>
      </div>
      <label class="custom">自定义 <input class="inp num" type="number" :min="allowZero ? 0 : 1" :max="limit" :value="model" @keydown.enter="(e) => set(Number((e.target as HTMLInputElement).value))" @change="(e) => set(Number((e.target as HTMLInputElement).value))" /> {{ unit === 'min' ? '分钟' : '秒' }}</label>
    </div>
  </Teleport>
</template>
