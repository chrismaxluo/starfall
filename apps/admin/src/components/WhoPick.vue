<script setup lang="ts">
// 弹幕规则「谁发的才算」：点一下弹出多选（所有人、主播、房管、总督 / 提督 / 舰长、粉丝牌等级、指定观众），改了立即保存
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { DANMU_UIDS_MAX, MEDAL_LEVEL_MAX } from '@starfall/shared';
import type { DanmuWho } from '@starfall/shared';
import { get } from '../lib/api.ts';
import { whoText } from '../lib/danmu-who.ts';
import type { DanmuPerson } from '../lib/danmu-who.ts';
import { toast } from '../lib/toast.ts';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';

const props = defineProps<{ modelValue: DanmuWho; people: DanmuPerson[]; blockAnchor?: boolean }>();
const emit = defineEmits<{ change: [value: DanmuWho] }>();
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLDivElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
const uidIn = ref('');
const busy = ref(false);
/** 刚加的观众：服务端返回之前先显示 */
const added = ref<DanmuPerson[]>([]);
const w = computed(() => props.modelValue);
const people = computed(() => w.value.uids.map((uid) => props.people.find((p) => p.uid === uid) ?? added.value.find((p) => p.uid === uid) ?? { uid, name: null, face: null, guard: 0 }));
const text = computed(() => whoText(w.value, people.value));

const ROLES = [
  { key: 'anchor', name: '主播' },
  { key: 'mod', name: '房管' },
] as const;
const GUARDS = [
  { level: 1, name: '总督' },
  { level: 2, name: '提督' },
  { level: 3, name: '舰长' },
] as const;

function set(next: DanmuWho): void {
  if (!(next.all || next.anchor || next.mod || next.guards.length || next.fanMin !== null || next.uids.length)) return toast('至少选一种人；不限的话选「所有人」', 'info');
  emit('change', next);
}
/** 勾了别的就不再是「所有人」 */
const base = () => ({ ...w.value, all: false });
function toggleAll(): void {
  set({ ...w.value, all: !w.value.all });
}
function toggleRole(key: 'anchor' | 'mod'): void {
  const b = base();
  set({ ...b, [key]: w.value.all ? true : !w.value[key] });
}
function toggleGuard(level: 1 | 2 | 3): void {
  const b = base();
  const on = !w.value.all && w.value.guards.includes(level);
  set({ ...b, guards: on ? b.guards.filter((g) => g !== level) : [...b.guards.filter((g) => g !== level), level].sort() });
}
function toggleFan(): void {
  const b = base();
  set({ ...b, fanMin: !w.value.all && w.value.fanMin !== null ? null : (w.value.fanMin ?? 1) });
}
function setFanMin(e: Event): void {
  const n = Math.round(Number((e.target as HTMLInputElement).value));
  if (!n || n < 1 || Math.min(MEDAL_LEVEL_MAX, n) === w.value.fanMin) return;
  set({ ...base(), fanMin: Math.min(MEDAL_LEVEL_MAX, n) });
}
async function addUid(): Promise<void> {
  const v = uidIn.value.trim();
  if (!v) return;
  if (!/^\d{1,16}$/.test(v)) return toast('UID 只能是数字', 'info');
  const uid = Number(v);
  if (w.value.uids.includes(uid)) return toast('已经在名单里了', 'info');
  if (w.value.uids.length >= DANMU_UIDS_MAX) return toast(`一条规则最多指定 ${DANMU_UIDS_MAX} 位观众`, 'info');
  busy.value = true;
  // 先查一下是谁，免得填错；查不到（B 站暂时连不上）也能加
  const p = await get<{ uid: number; name: string; face: string; guard?: number }>(`/api/viewers/${uid}`).catch((e: Error) => (/没有 UID/.test(e.message) ? (toast(e.message, 'err'), undefined) : null));
  busy.value = false;
  if (p === undefined) return;
  added.value.push({ uid, name: p?.name ?? null, face: p?.face ?? null, guard: p?.guard ?? 0 });
  uidIn.value = '';
  set({ ...base(), uids: [...w.value.uids, uid] });
}
function removeUid(uid: number): void {
  set({ ...w.value, uids: w.value.uids.filter((x) => x !== uid) });
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
  place();
  addEventListener('mousedown', outside, true);
  addEventListener('scroll', onScroll, true);
}
function place(): void {
  const r = btn.value!.getBoundingClientRect();
  const h = pop.value?.offsetHeight ?? 300;
  const width = Math.min(340, innerWidth - 16);
  pos.value = { left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), top: r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 };
}
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" type="button" class="cdpick whopick" :aria-label="`谁发的弹幕才算：${text}`" :aria-expanded="open" @click.stop="toggle">{{ text }}<Icon name="i-chev" /></button>
  <Teleport to="body">
    <div v-if="open" ref="pop" class="cdpop whopop" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
      <div class="lbl">谁发的弹幕才算：满足任意一项就算，改了立即保存</div>
      <div class="opts">
        <button type="button" :aria-pressed="w.all" @click="toggleAll">所有人</button>
      </div>
      <div class="opts" :class="{ dim: w.all }">
        <button v-for="r in ROLES" :key="r.key" type="button" :aria-pressed="!w.all && w[r.key]" @click="toggleRole(r.key)">{{ r.name }}</button>
        <button v-for="g in GUARDS" :key="g.level" type="button" :aria-pressed="!w.all && w.guards.includes(g.level)" @click="toggleGuard(g.level)">{{ g.name }}</button>
      </div>
      <div class="fanrow" :class="{ dim: w.all }">
        <button type="button" :aria-pressed="!w.all && w.fanMin !== null" @click="toggleFan">戴本房间粉丝牌</button>
        <label v-if="!w.all && w.fanMin !== null">至少 <input class="inp num" type="number" min="1" :max="MEDAL_LEVEL_MAX" :value="w.fanMin" aria-label="粉丝牌最低等级" @change="setFanMin" @keydown.enter="setFanMin" /> 级</label>
      </div>
      <div class="uidbox" :class="{ dim: w.all }">
        <div class="uidin"><input v-model="uidIn" class="inp num" placeholder="指定观众：输入 UID，回车添加" inputmode="numeric" aria-label="指定观众的 UID" :disabled="busy" @keydown.enter.prevent="addUid" /></div>
        <div v-for="p in people" :key="p.uid" class="person">
          <Avatar :name="p.name || String(p.uid)" :face="p.face" :guard="p.guard" :size="24" />
          <span class="pn">{{ p.name || '（昵称未知）' }}</span><span class="uid num">{{ p.uid }}</span>
          <button type="button" :aria-label="`移出 ${p.name || p.uid}`" @click="removeUid(p.uid)"><Icon name="i-x" /></button>
        </div>
      </div>
      <div v-if="blockAnchor && !w.all && w.anchor" class="lbl">设置里「主播本人不触发」是开着的，这里点了主播的名，主播发的照样算。</div>
    </div>
  </Teleport>
</template>
