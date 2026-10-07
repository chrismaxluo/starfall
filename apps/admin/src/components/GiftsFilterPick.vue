<script setup lang="ts">
// 送礼名单显示哪些：所有付费礼物 / 只显示勾选的礼物（从直播间礼物面板里点选）/ 只显示挂上的记录；上舰、醒目留言单独开关
import { computed, onMounted, ref } from 'vue';
import type { GiftsFilter } from '@starfall/shared/overlay';
import { get } from '../lib/api.ts';
import { battery } from '../lib/preview.ts';
import type { GiftConfig } from '../lib/types.ts';
import Icon from './Icon.vue';
import Seg from './Seg.vue';
import Switch from './Switch.vue';

const props = defineProps<{ modelValue: GiftsFilter }>();
const emit = defineEmits<{ change: [f: GiftsFilter, msg: string] }>();

const catalog = ref<GiftConfig[]>([]);
const catalogErr = ref('');
const picking = ref(false);
const q = ref('');
onMounted(async () => {
  try {
    catalog.value = (await get<{ gifts: GiftConfig[] }>('/api/gifts')).gifts;
  } catch (e) {
    catalogErr.value = e instanceof Error ? e.message : String(e);
  }
});

const MODE_MSG: Record<GiftsFilter['mode'], string> = { all: '送礼名单显示所有付费礼物', only: '送礼名单只显示选中的礼物', pinned: '送礼名单只显示挂上的记录' };

const chosen = computed(() => new Set(props.modelValue.gifts.map((g) => g.id)));
// 按礼物面板分页（礼物、粉丝团、航海……）、页内顺序列出；只列付费礼物
const groups = computed(() => {
  const tabs = new Map<string, GiftConfig[]>();
  for (const g of catalog.value) {
    if (!g.paid || !g.tab || (q.value && !g.name.includes(q.value))) continue;
    if (!tabs.has(g.tab)) tabs.set(g.tab, []);
    tabs.get(g.tab)!.push(g);
  }
  return [...tabs].map(([tab, list]) => ({ title: tab, list: list.sort((a, b) => a.panel! - b.panel!) }));
});
const iconOf = (id: number) => catalog.value.find((g) => g.id === id)?.icon;

const set = (patch: Partial<GiftsFilter>, msg: string) => emit('change', { ...props.modelValue, ...patch }, msg);
function toggle(g: GiftConfig): void {
  const on = chosen.value.has(g.id);
  const gifts = on ? props.modelValue.gifts.filter((x) => x.id !== g.id) : [...props.modelValue.gifts, { id: g.id, name: g.name }];
  set({ gifts }, on ? `送礼名单不再显示「${g.name}」` : `送礼名单会显示「${g.name}」`);
}
</script>

<template>
  <div class="gfp">
    <div class="line">
      <Seg :model-value="modelValue.mode" label="显示哪些" :options="[{ value: 'all', label: '所有付费礼物' }, { value: 'only', label: '只显示选中的礼物' }, { value: 'pinned', label: '只显示挂上的记录' }]" @change="(v) => set({ mode: v as GiftsFilter['mode'] }, MODE_MSG[v as GiftsFilter['mode']])" />
    </div>
    <template v-if="modelValue.mode === 'only'">
      <div class="gfp-chips">
        <span v-for="g in modelValue.gifts" :key="g.id" class="gfp-chip"><img v-if="iconOf(g.id)" :src="iconOf(g.id)" alt="" referrerpolicy="no-referrer" />{{ g.name }}<button type="button" :aria-label="`不显示「${g.name}」`" @click="set({ gifts: modelValue.gifts.filter((x) => x.id !== g.id) }, `送礼名单不再显示「${g.name}」`)"><Icon name="i-x" /></button></span>
        <span v-if="!modelValue.gifts.length" class="hint">还没选礼物：现在只会显示下面打开的上舰、醒目留言</span>
        <button class="btn" type="button" :disabled="!!catalogErr" :aria-expanded="picking" @click="picking = !picking"><Icon name="i-plus" />{{ catalogErr ? '读取礼物面板失败' : '选礼物' }}</button>
      </div>
      <div v-if="picking" class="rl-gpick">
        <div class="h"><input v-model.trim="q" class="inp" placeholder="搜索礼物名" aria-label="搜索礼物" /><span class="hint">来自你直播间的礼物面板；点一下选上，再点一下取消</span><button class="icon-btn" aria-label="收起" @click="picking = false"><Icon name="i-x" /></button></div>
        <div class="grid">
          <template v-for="grp in groups" :key="grp.title">
            <div class="sep">{{ grp.title }}</div>
            <button v-for="g in grp.list" :key="g.id" type="button" :class="{ on: chosen.has(g.id) }" :aria-pressed="chosen.has(g.id)" @click="toggle(g)"><img :src="g.icon" alt="" referrerpolicy="no-referrer" /><b>{{ g.name }}</b><span>{{ battery(g.price) }}</span></button>
          </template>
          <span v-if="!groups.length" class="hint">没有可选的礼物</span>
        </div>
      </div>
    </template>
    <span v-if="modelValue.mode === 'pinned'" class="hint">只显示下面「已挂上」的记录（可以是以前场次的），本场新收到的不会进来。</span>
    <div v-else class="line">
      <Switch :model-value="modelValue.guard" label="显示上舰" @change="(v) => set({ guard: v }, v ? '送礼名单会显示上舰' : '送礼名单不再显示上舰')" /><span>上舰（开通、续费大航海）</span>
      <Switch :model-value="modelValue.sc" label="显示醒目留言" @change="(v) => set({ sc: v }, v ? '送礼名单会显示醒目留言' : '送礼名单不再显示醒目留言')" /><span>醒目留言</span>
    </div>
  </div>
</template>

<style scoped>
.gfp { display: flex; flex-direction: column; gap: 10px; }
.gfp .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--t2); }
.gfp .line > span + :deep(.switch), .gfp .line > span + button { margin-left: 14px; }
.gfp-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gfp-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 4px 0 6px; border-radius: 8px; background: var(--l3); box-shadow: inset 0 0 0 1px var(--line); font-size: 13px; }
.gfp-chip img { width: 22px; height: 22px; object-fit: contain; }
.gfp-chip button { display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: none; color: var(--t3); }
.gfp-chip button:hover { background: var(--hover); color: var(--t1); }
.gfp-chip button svg { width: 12px; height: 12px; }
.rl-gpick .grid button.on { border-color: var(--accent); background: var(--accent-soft); }
.hint { font-size: 12px; color: var(--t3); }
</style>
