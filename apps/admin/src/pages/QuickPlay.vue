<script setup lang="ts">
// 素材快捷播放：点按钮或按快捷键，马上在直播画面上播放；编辑时可以添加、改名、排序、设快捷键、删除。
// 在电脑版窗口里还能设全局快捷键（带 Ctrl / Alt / Shift，在别的窗口里按也能播）
import { computed, onBeforeUnmount, ref } from 'vue';
import EffectPicker from '../components/EffectPicker.vue';
import Icon from '../components/Icon.vue';
import QuickPad from '../components/QuickPad.vue';
import { put } from '../lib/api.ts';
import { desktop, reloadHotkeys } from '../lib/desktop.ts';
import { keyOf, quickName, useQuickHotkeys } from '../lib/quick.ts';
import { effectById, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import { QUICK_GLOBAL_RE } from '@starfall/shared';
import type { QuickButton } from '../lib/types.ts';

type Row = Omit<QuickButton, 'id'> & { key: number };
/** 全局快捷键只有电脑版窗口能设 */
const canGlobal = Boolean(desktop);
const MAX = 40;
const editing = ref(false);
const rows = ref<Row[]>([]);
const saving = ref(false);
let seq = 0;
useQuickHotkeys(() => !editing.value);

function startEdit(): void {
  rows.value = state.quick.map((b) => ({ key: ++seq, effectId: b.effectId, label: b.label, hotkey: b.hotkey, globalHotkey: b.globalHotkey }));
  editing.value = true;
  // 编辑时先停掉全局快捷键：录快捷键时不会被系统拦走，也不会误播
  void desktop?.pauseHotkeys().catch(() => undefined);
}

/** 下一个没用过的数字键（1–9、0） */
function freeKey(): string | null {
  const used = new Set(rows.value.map((r) => r.hotkey));
  return [...'1234567890'].find((k) => !used.has(k)) ?? null;
}

const adding = ref<number | null>(null);
function add(effectId: number): void {
  adding.value = null;
  if (rows.value.length >= MAX) return toast(`最多 ${MAX} 个按钮`, 'err');
  rows.value.push({ key: ++seq, effectId, label: '', hotkey: freeKey(), globalHotkey: null });
}

// 设快捷键：点一下后按一个数字或字母；Backspace / Delete 清掉，Esc 取消
const listening = ref<number | null>(null);
function onKeyCapture(e: KeyboardEvent): void {
  const row = rows.value.find((r) => r.key === listening.value);
  if (!row) return stopListen();
  if (e.key === 'Tab') return stopListen();
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return stopListen();
  if (e.key === 'Backspace' || e.key === 'Delete') {
    row.hotkey = null;
    return stopListen();
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = keyOf(e);
  if (!k) return toast('快捷键只能是一个数字或字母', 'info');
  const other = rows.value.find((r) => r !== row && r.hotkey === k);
  if (other) {
    other.hotkey = null;
    toast(`快捷键 ${k} 原来是「${quickName(other)}」的，已经换过来`, 'info');
  }
  row.hotkey = k;
  stopListen();
}
function listen(row: Row): void {
  if (listening.value === row.key) return stopListen();
  stopListen();
  listening.value = row.key;
  addEventListener('keydown', onKeyCapture, true);
}

// 设全局快捷键：点一下后按组合键（Ctrl / Alt / Shift 加一个数字、字母或 F1–F12）；Backspace / Delete 清掉，Esc 取消
const listeningG = ref<number | null>(null);
function onGlobalCapture(e: KeyboardEvent): void {
  const row = rows.value.find((r) => r.key === listeningG.value);
  if (!row) return stopListen();
  if (e.key === 'Tab') return stopListen();
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return stopListen();
  if (e.key === 'Backspace' || e.key === 'Delete') {
    row.globalHotkey = null;
    return stopListen();
  }
  // 只按了修饰键：等下一个键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  // 小键盘的数字在系统里是另一个键，注册成全局快捷键按不出来
  if (e.code.startsWith('Numpad')) return toast('全局快捷键请用主键盘上的数字', 'info');
  const k = /^F([1-9]|1[0-2])$/.test(e.code) ? e.code : keyOf(e);
  const acc = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
  if (!k || !QUICK_GLOBAL_RE.test(acc)) return toast('全局快捷键要按住 Ctrl、Alt 或 Shift，再按一个数字、字母或 F1–F12，例如 Ctrl+Alt+1', 'info');
  const other = rows.value.find((r) => r !== row && r.globalHotkey === acc);
  if (other) {
    other.globalHotkey = null;
    toast(`全局快捷键 ${acc} 原来是「${quickName(other)}」的，已经换过来`, 'info');
  }
  row.globalHotkey = acc;
  stopListen();
}
function listenGlobal(row: Row): void {
  if (listeningG.value === row.key) return stopListen();
  stopListen();
  listeningG.value = row.key;
  addEventListener('keydown', onGlobalCapture, true);
}
function stopListen(): void {
  listening.value = null;
  listeningG.value = null;
  removeEventListener('keydown', onKeyCapture, true);
  removeEventListener('keydown', onGlobalCapture, true);
}
onBeforeUnmount(stopListen);

// 拖动排序
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i;
  e.dataTransfer?.setData('text/plain', String(i));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDrop(to: number): void {
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOver.value = null;
  if (from === null || from === to) return;
  const [r] = rows.value.splice(from, 1);
  rows.value.splice(to, 0, r!);
}
function move(i: number, d: -1 | 1): void {
  const j = i + d;
  if (j < 0 || j >= rows.value.length) return;
  const [r] = rows.value.splice(i, 1);
  rows.value.splice(j, 0, r!);
}

const changed = computed(() => JSON.stringify(rows.value.map(({ key: _k, ...r }) => r)) !== JSON.stringify(state.quick.map(({ id: _i, ...r }) => r)));
async function save(): Promise<void> {
  stopListen();
  saving.value = true;
  const buttons = rows.value.map(({ key: _k, ...r }) => ({ ...r, label: r.label.trim() }));
  const res = await attempt(() => put<{ buttons: QuickButton[] }>('/api/quickplay/buttons', { buttons }), '已保存');
  saving.value = false;
  if (!res) return;
  state.quick = res.buttons;
  editing.value = false;
  const failed = await reloadHotkeys();
  if (failed.length) toast(`全局快捷键 ${failed.join('、')} 被别的软件占用了，换一个组合试试`, 'err');
}
function cancel(): void {
  stopListen();
  editing.value = false;
  void reloadHotkeys();
}
// 编辑到一半离开这一页：恢复全局快捷键
onBeforeUnmount(() => {
  if (editing.value) void reloadHotkeys();
});
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>素材快捷播放</h1>
        <p>点一下按钮或按快捷键，马上在直播画面上播放。正在播的观众特效会先停下，播完再从头播。</p>
      </div>
      <div class="actions">
        <template v-if="editing">
          <button class="btn" @click="cancel">取消</button>
          <button class="btn primary" :disabled="saving || !changed" @click="save"><Icon name="i-check" />保存</button>
        </template>
        <button v-else class="btn" @click="startEdit"><Icon name="i-pen" />编辑按钮</button>
      </div>
    </div>

    <template v-if="!editing">
      <div v-if="state.quick.length" class="card">
        <QuickPad big />
        <p class="qp-tip">快捷键只在这个页面或「总览」是当前窗口时有用；在输入框里打字时不会触发。</p>
      </div>
      <div v-else class="card qp-empty">
        <b>还没有按钮</b>
        <span>把常用的素材做成按钮，直播时点一下就能播，不用再发弹幕触发。</span>
        <button class="btn primary" @click="startEdit"><Icon name="i-plus" />添加按钮</button>
      </div>
    </template>

    <div v-else class="card">
      <div class="card-h"><h2>按钮</h2><span class="aside">拖动左边的序号调整顺序；名字不填时显示素材名</span></div>
      <div v-if="rows.length" class="qp-rows">
        <div
          v-for="(r, i) in rows"
          :key="r.key"
          class="qp-row"
          :class="{ dragging: dragFrom === i, dropto: dragOver === i && dragFrom !== i }"
          @dragover.prevent="dragFrom !== null && (dragOver = i)"
          @dragleave="dragOver === i && (dragOver = null)"
          @drop.prevent="onDrop(i)"
        >
          <span class="rl-no grab" draggable="true" title="按住拖动调整顺序" @dragstart="(e) => onDragStart(e, i)" @dragend="(dragFrom = null), (dragOver = null)"><Icon name="i-grip" class="grip" />{{ i + 1 }}</span>
          <EffectPicker :model-value="r.effectId" @change="(id) => (r.effectId = id)" />
          <input v-model="r.label" class="inp qp-label" maxlength="20" :placeholder="effectById(r.effectId)?.name ?? '按钮名字'" :aria-label="`第 ${i + 1} 个按钮的名字`" />
          <button type="button" class="btn qp-key" :class="{ on: listening === r.key }" :aria-label="`第 ${i + 1} 个按钮的快捷键：${r.hotkey ?? '没有'}，点一下后按一个键`" @click="listen(r)">
            <template v-if="listening === r.key">按一个数字或字母…</template>
            <template v-else-if="r.hotkey">快捷键 <span class="kbd">{{ r.hotkey }}</span></template>
            <template v-else>设快捷键</template>
          </button>
          <button v-if="canGlobal" type="button" class="btn qp-key" :class="{ on: listeningG === r.key }" :title="'在别的窗口（直播姬、游戏）里按也能播放'" :aria-label="`第 ${i + 1} 个按钮的全局快捷键：${r.globalHotkey ?? '没有'}，点一下后按组合键`" @click="listenGlobal(r)">
            <template v-if="listeningG === r.key">按 Ctrl / Alt / Shift + 键…</template>
            <template v-else-if="r.globalHotkey">全局 <span class="kbd">{{ r.globalHotkey }}</span></template>
            <template v-else>设全局快捷键</template>
          </button>
          <span class="qp-move">
            <button type="button" class="icon-btn" :disabled="i === 0" :aria-label="`把第 ${i + 1} 个按钮往前挪`" @click="move(i, -1)"><Icon name="i-up" /></button>
            <button type="button" class="icon-btn" :disabled="i === rows.length - 1" :aria-label="`把第 ${i + 1} 个按钮往后挪`" @click="move(i, 1)"><Icon name="i-up" style="transform: rotate(180deg)" /></button>
          </span>
          <button type="button" class="icon-btn" :aria-label="`删除第 ${i + 1} 个按钮`" title="删除这个按钮（素材不会删）" @click="rows.splice(i, 1)"><Icon name="i-trash" /></button>
        </div>
      </div>
      <p v-else class="qp-tip">还没有按钮，点下面「添加按钮」选一个素材。</p>
      <div class="qp-foot">
        <EffectPicker v-model="adding" add="添加按钮" @change="add" />
        <span class="hint">已有 {{ rows.length }} 个，最多 {{ MAX }} 个。设快捷键时按 Backspace 清掉。{{ canGlobal ? '全局快捷键在直播姬、游戏等别的窗口里按也能播放。' : '' }}</span>
      </div>
    </div>
  </section>
</template>
