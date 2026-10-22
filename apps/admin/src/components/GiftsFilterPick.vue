<script setup lang="ts">
// 送礼名单「只要这几种礼物」：从直播间礼物面板里点选礼物种类（按礼物编号，名字只用来显示）
import { computed, onMounted, reactive, ref } from 'vue';
import { useGiftCatalog } from '../lib/gift-catalog.ts';
import { useGiftSearch } from '../lib/gift-search.ts';
import { battery } from '../lib/preview.ts';
import type { GiftConfig } from '../lib/types.ts';
import GiftCatalogError from './GiftCatalogError.vue';
import Icon from './Icon.vue';

const props = defineProps<{ modelValue: Array<{ id: number; name: string }> }>();
const emit = defineEmits<{ change: [gifts: Array<{ id: number; name: string }>, msg: string] }>();

const { catalog, error: catalogErr, noRoom, loading: catalogLoading, load: loadCatalog } = useGiftCatalog();
const picking = ref(false);
const q = ref('');
// 还一种都没选时直接打开选择面板（读不到礼物面板时不打开，先显示原因）
onMounted(() => {
  if (!props.modelValue.length) picking.value = true;
});

const chosen = computed(() => new Set(props.modelValue.map((g) => g.id)));
// 按礼物面板分页（礼物、粉丝团、航海……）、页内顺序列出；只列付费礼物
const groups = computed(() => {
  const tabs = new Map<string, GiftConfig[]>();
  for (const g of catalog.value) {
    if (!g.paid || !g.tab || (q.value && !g.name.includes(q.value))) continue;
    if (!tabs.has(g.tab)) tabs.set(g.tab, []);
    tabs.get(g.tab)!.push(g);
  }
  const out = [...tabs].map(([tab, list]) => ({ title: tab, list: list.sort((a, b) => a.panel! - b.panel!) }));
  // 打字搜索时：礼物面板上没有的（盲盒里爆出的、活动礼物等），在全站礼物里找到的
  const more = [...catalog.value.filter((g) => g.paid && !g.tab && q.value && g.name.includes(q.value)), ...found.value];
  if (more.length) out.push({ title: `礼物面板上没有的（${more.length}）`, list: more });
  return out;
});
// 打字搜索时也在全站礼物里找
const { extra: found, searching } = useGiftSearch(q, () => catalog.value);
/** 选过的、面板上没有的礼物：记住礼物图 */
const seen = reactive(new Map<number, string>());
const iconOf = (id: number) => catalog.value.find((g) => g.id === id)?.icon ?? seen.get(id);

function toggle(g: { id: number; name: string; icon?: string }): void {
  if (g.icon) seen.set(g.id, g.icon);
  const on = chosen.value.has(g.id);
  emit('change', on ? props.modelValue.filter((x) => x.id !== g.id) : [...props.modelValue, { id: g.id, name: g.name }], on ? `不再显示「${g.name}」` : `会显示「${g.name}」`);
}
</script>

<template>
  <div class="gfp">
    <div class="gfp-chips">
      <span v-for="g in modelValue" :key="g.id" class="gfp-chip"><img v-if="iconOf(g.id)" :src="iconOf(g.id)" alt="" referrerpolicy="no-referrer" />{{ g.name }}<button type="button" :aria-label="`不显示「${g.name}」`" @click="toggle(g)"><Icon name="i-x" /></button></span>
      <GiftCatalogError v-if="catalogErr" :error="catalogErr" :no-room="noRoom" :loading="catalogLoading" @retry="loadCatalog" />
      <button v-else class="btn" type="button" :aria-expanded="picking" @click="picking = !picking"><Icon :name="picking ? 'i-chev' : 'i-plus'" />{{ picking ? '收起' : modelValue.length ? '再选几种' : '选礼物' }}</button>
    </div>
    <div v-if="picking && !catalogErr" class="rl-gpick">
      <div class="h"><input v-model.trim="q" class="inp" placeholder="搜索礼物名" aria-label="搜索礼物" /><span class="hint">来自你直播间的礼物面板；打字搜索时也会在 B 站全站礼物里找（盲盒里爆出的、活动礼物等）。点一下选上，再点一下取消</span></div>
      <div class="grid">
        <template v-for="grp in groups" :key="grp.title">
          <div class="sep">{{ grp.title }}</div>
          <button v-for="g in grp.list" :key="g.id" type="button" :class="{ on: chosen.has(g.id) }" :aria-pressed="chosen.has(g.id)" @click="toggle(g)"><img :src="g.icon" alt="" referrerpolicy="no-referrer" /><b>{{ g.name }}</b><span>{{ battery(g.price) }}</span></button>
        </template>
        <span v-if="searching" class="hint">正在全站礼物里找…</span>
        <span v-else-if="!groups.length" class="hint">{{ q ? '没有找到这个礼物' : '没有可选的礼物' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gfp { display: flex; flex-direction: column; gap: 10px; }
.gfp-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gfp-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 4px 0 6px; border-radius: 8px; background: var(--l3); box-shadow: inset 0 0 0 1px var(--line); font-size: 13px; }
.gfp-chip img { width: 22px; height: 22px; object-fit: contain; }
.gfp-chip button { display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 6px; background: none; color: var(--t3); }
.gfp-chip button:hover { background: var(--hover); color: var(--t1); }
.gfp-chip button svg { width: 12px; height: 12px; }
.rl-gpick { margin-top: 0; }
.rl-gpick .grid button.on { border-color: var(--accent); background: var(--accent-soft); }
.hint { font-size: 12px; color: var(--t3); }
</style>
