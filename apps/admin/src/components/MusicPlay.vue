<script setup lang="ts">
// 点歌 · 主页：上面一排是网易云账号、本场、点歌窗口三张卡片；
// 下面是正在放的歌（歌词、暂停、切歌、音量）、列表（拖动排序、置顶、删除、清空）；右边加歌（搜本地歌库和网易云）、模拟点歌、最近的点歌消息
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { MusicItem, MusicSong } from '@starfall/shared/overlay';
import Avatar from './Avatar.vue';
import Empty from './Empty.vue';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import MusicNetease from './MusicNetease.vue';
import MusicSession from './MusicSession.vue';
import MusicSwap from './MusicSwap.vue';
import MusicWindow from './MusicWindow.vue';
import RowMenu from './RowMenu.vue';
import type { MenuItem } from './RowMenu.vue';
import { get, post, put } from '../lib/api.ts';
import { desktop, reloadHotkeys } from '../lib/desktop.ts';
import { clock } from '../lib/format.ts';
import { banRequester, blockSong, clearQueue, mmss, music, removeSong, saveMusic } from '../lib/music.ts';
import { keyOf } from '../lib/quick.ts';
import { QUICK_GLOBAL_RE } from '@starfall/shared';
import type { SearchHit } from '../lib/music.ts';
import { attempt, toast } from '../lib/toast.ts';

// ---------- 正在放 ----------
const now = computed(() => music.state?.now ?? null);
/** 正在放的歌的封面：「正在放」卡片背后铺一层模糊的封面，透出这首歌的颜色 */
const cover = computed(() => now.value?.item.song.cover ?? '');
const holding = computed(() => (music.state?.hold ?? null) !== null);
const paused = computed(() => music.state?.hold === 'manual');
const tickNow = ref(performance.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => (timer = setInterval(() => (tickNow.value = performance.now()), 500)));
onBeforeUnmount(() => timer && clearInterval(timer));
const pos = computed(() => {
  const n = now.value;
  if (!n) return 0;
  return n.paused ? n.posMs : n.posMs + (tickNow.value - music.gotAt);
});
const pct = computed(() => (now.value?.item.song.durationMs ? Math.min(100, (pos.value / now.value.item.song.durationMs) * 100) : 0));

// 歌词：唱到的那句（字随着唱亮起来）和下一句
const lyric = computed(() => {
  const lines = now.value?.lyric;
  if (!lines?.length) return null;
  const p = pos.value;
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1]!.t <= p) i++;
  const cur = lines[i];
  const next = lines.slice(i + 1).find((l) => l.text.trim());
  if (!cur || !cur.text.trim()) return { i, text: i < 0 ? '（前奏）' : '（间奏）', fill: 0, next: next?.text ?? '', dim: true };
  const end = lines[i + 1]?.t ?? now.value!.item.song.durationMs;
  // 一句唱到大约八成整句就亮完
  const fill = Math.min(1, Math.max(0, (p - cur.t) / Math.max(1, (end - cur.t) * 0.8)));
  return { i, text: cur.text, fill, next: next?.text ?? '', dim: false };
});

async function togglePause(): Promise<void> {
  await attempt(() => post('/api/music/pause', { paused: !paused.value }), paused.value ? '继续放歌' : '已暂停：正在放的歌停在这里');
}
async function skip(): Promise<void> {
  await attempt(() => post('/api/music/skip'), '已切歌');
}
// 音量：拖动时只改显示，松手后保存
const vol = ref<number | null>(null);
const volShown = computed(() => vol.value ?? music.settings?.volume ?? 70);
async function saveVol(): Promise<void> {
  if (vol.value === null) return;
  const v = vol.value;
  await saveMusic({ volume: v });
  vol.value = null;
}

// ---------- 列表 ----------
const queue = computed(() => music.queue);
async function order(ids: number[]): Promise<void> {
  await attempt(() => put('/api/music/queue/order', { ids }));
}
// 换个版本（弹窗）
const swapping = ref<{ item: MusicItem; playing: boolean } | null>(null);
function rowMenu(it: MusicItem): Array<MenuItem | null> {
  return [
    { icon: 'i-replay', label: '换个版本', run: () => (swapping.value = { item: it, playing: false }) },
    null,
    { icon: 'i-ban', label: `不让 ${it.by.name} 点歌`, run: () => void banRequester(it) },
    { icon: 'i-x', label: '这首歌以后不收', run: () => void blockSong(it) },
    null,
    { icon: 'i-trash', label: '从列表删掉', danger: true, run: () => void removeSong(it) },
  ];
}
function toTop(i: number): void {
  const ids = queue.value.map((x) => x.id);
  const [id] = ids.splice(i, 1);
  void order([id!, ...ids]);
}
// ---------- 桌面版：切歌、暂停的全局快捷键（在游戏、直播姬里按也行） ----------
const canGlobal = Boolean(desktop);
const listening = ref<'hotkeySkip' | 'hotkeyPause' | null>(null);
const HK_NAMES = { hotkeySkip: '切歌', hotkeyPause: '暂停 / 继续' } as const;
async function setHotkey(k: 'hotkeySkip' | 'hotkeyPause', v: string | null): Promise<void> {
  if (!(await saveMusic({ [k]: v }, v ? `${HK_NAMES[k]}的快捷键设成 ${v}` : `${HK_NAMES[k]}不用快捷键了`))) return;
  const failed = await reloadHotkeys();
  if (v && failed.includes(v)) toast(`快捷键 ${v} 被别的软件占用了，换一个组合试试`, 'err');
}
function onHotkey(e: KeyboardEvent): void {
  const k = listening.value;
  if (!k) return stopListen();
  if (e.key === 'Tab') return stopListen();
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return stopListen();
  if (e.key === 'Backspace' || e.key === 'Delete') {
    stopListen();
    return void setHotkey(k, null);
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  if (e.code.startsWith('Numpad')) return toast('全局快捷键请用主键盘上的数字', 'info');
  const key = /^F([1-9]|1[0-2])$/.test(e.code) ? e.code : keyOf(e);
  const acc = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
  if (!key || !QUICK_GLOBAL_RE.test(acc)) return toast('要按住 Ctrl、Alt 或 Shift，再按一个数字、字母或 F1–F12，例如 Ctrl+Alt+N', 'info');
  stopListen();
  void setHotkey(k, acc);
}
function listen(k: 'hotkeySkip' | 'hotkeyPause'): void {
  if (listening.value === k) return stopListen();
  stopListen();
  listening.value = k;
  // 录快捷键时先停掉已经注册的，不然按下会被系统拦走
  void desktop?.pauseHotkeys().catch(() => undefined);
  addEventListener('keydown', onHotkey, true);
}
function stopListen(): void {
  const was = listening.value;
  listening.value = null;
  removeEventListener('keydown', onHotkey, true);
  if (was) void reloadHotkeys();
}
onBeforeUnmount(stopListen);
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i;
  e.dataTransfer?.setData('text/plain', String(i));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDrop(to: number): void {
  const from = dragFrom.value;
  dragFrom.value = dragOver.value = null;
  if (from === null || from === to) return;
  const ids = queue.value.map((x) => x.id);
  const [id] = ids.splice(from, 1);
  ids.splice(to, 0, id!);
  void order(ids);
}

// ---------- 加歌 ----------
const q = ref('');
const searching = ref(false);
const hits = ref<{ local: SearchHit[]; netease: SearchHit[]; neteaseError?: string } | null>(null);
async function search(): Promise<void> {
  const s = q.value.trim();
  if (!s) return;
  searching.value = true;
  hits.value = (await attempt(() => get<{ local: SearchHit[]; netease: SearchHit[]; neteaseError?: string }>(`/api/music/search?q=${encodeURIComponent(s)}`))) ?? null;
  searching.value = false;
}
const inList = computed(() => new Set([...(now.value ? [now.value.item] : []), ...queue.value].map((x) => `${x.song.source}:${x.song.id}`)));
async function add(h: SearchHit, front: boolean): Promise<void> {
  const song: MusicSong = { source: h.source, id: h.id, name: h.name, artists: h.artists, ...(h.album ? { album: h.album } : {}), ...(h.cover ? { cover: h.cover } : {}), durationMs: h.durationMs };
  await attempt(() => post('/api/music/queue', { song, front }), front ? `《${h.name}》排到下一首` : `已加《${h.name}》到列表最后`);
}

// ---------- 模拟点歌 ----------
const simText = ref('');
const simGuard = ref<0 | 1 | 2 | 3>(0);
const simResult = ref<{ ok: boolean; text: string } | null>(null);
const simBusy = ref(false);
async function simulate(): Promise<void> {
  const text = simText.value.trim() || `${music.settings?.cmdRequest ?? '点歌'} 起风了`;
  simBusy.value = true;
  simResult.value = (await attempt(() => post<{ ok: boolean; text: string }>('/api/music/simulate', { text, guard: simGuard.value }))) ?? null;
  simBusy.value = false;
}
</script>

<template>
  <div class="mh-top">
    <MusicNetease />
    <MusicSession />
    <MusicWindow />
  </div>
  <div class="mp-grid">
    <div class="mp-col">
      <div class="card mp-nowcard" :class="{ 'has-cover': cover }">
        <!-- 背后是这首歌的封面（放大、模糊、调淡），换歌时新旧封面交叉淡入淡出 -->
        <Transition name="mp-bgfade">
          <div v-if="cover" :key="cover" class="mp-bg" aria-hidden="true"><img :src="cover" alt="" referrerpolicy="no-referrer" /></div>
        </Transition>
        <div class="card-h"><h2><span class="hicon"><Icon name="i-play" /></span>正在放</h2><span class="aside">{{ holding ? (paused ? '已暂停' : '没在放') : now ? '播放中' : '' }}</span></div>
        <div v-if="now" class="mp-now" :class="{ paused: now.paused }">
          <img v-if="now.item.song.cover" class="mp-cover" :src="now.item.song.cover" alt="" referrerpolicy="no-referrer" />
          <span v-else class="mp-cover blank"><Icon name="i-music" /></span>
          <div class="mp-info">
            <b class="mp-title">{{ now.item.song.name }}</b>
            <span class="mp-artist">{{ now.item.song.artists || '未知歌手' }}<span class="mp-src">{{ now.item.song.source === 'local' ? '本地歌库' : '网易云' }}</span></span>
            <span class="mp-by"><Avatar :name="now.item.by.name" :face="now.item.by.face" :guard="now.item.by.guard" :size="20" />{{ now.item.by.name }} 点的</span>
            <div class="mp-bar"><i :style="{ width: `${pct}%` }" /></div>
            <span class="mp-time num"><span>{{ mmss(pos) }}</span><span>{{ mmss(now.item.song.durationMs) }}</span></span>
          </div>
        </div>
        <div v-else class="mp-empty">
          <Icon name="i-music" />
          <span>{{ queue.length ? '列表里有歌，等能放的时候自动开始' : `还没有人点歌。观众发弹幕「${music.settings?.cmdRequest} 歌名」就能点，也可以在右边直接加歌。` }}</span>
        </div>
        <div v-if="now" class="ly" :class="{ paused: now.paused }">
          <Icon name="i-music" />
          <template v-if="lyric">
            <span :key="`c${lyric.i}`" class="ly-cur" :class="{ dim: lyric.dim }" :data-t="lyric.dim ? '' : lyric.text" :style="{ '--k': `${(lyric.fill * 100).toFixed(1)}%` }">{{ lyric.text }}</span>
            <span v-if="lyric.next" :key="`n${lyric.i}`" class="ly-next">{{ lyric.next }}</span>
          </template>
          <span v-else class="ly-cur dim">这首没有歌词</span>
        </div>
        <div class="mp-ctl">
          <button class="btn" :disabled="!music.settings?.enabled" @click="togglePause"><Icon :name="paused ? 'i-play' : 'i-pause'" />{{ paused ? '继续' : '暂停' }}</button>
          <button class="btn" :disabled="!now" @click="skip"><Icon name="i-arrow" />切歌</button>
          <button class="btn" :disabled="!now" title="点到的不是想要的那版（翻唱、现场版、伴奏）时，换成别的版本" @click="now && (swapping = { item: now.item, playing: true })"><Icon name="i-replay" />换个版本</button>
          <label class="mp-vol"><span>音量</span><input type="range" min="0" max="100" step="5" :value="volShown" aria-label="音量" @input="(e) => (vol = Number((e.target as HTMLInputElement).value))" @change="saveVol" /><span class="num">{{ volShown }}</span></label>
        </div>
        <p class="inline-hint mp-tip">直播软件的混音器里也能单独调点歌窗口的音量。</p>
        <div v-if="canGlobal" class="mp-hk">
          <span class="mp-hkl">全局快捷键</span>
          <button v-for="(name, k) in HK_NAMES" :key="k" type="button" class="btn sm" :class="{ on: listening === k }" :title="'在直播姬、游戏等别的窗口里按也能用；按 Backspace 清掉'" @click="listen(k)">
            <template v-if="listening === k">按 Ctrl / Alt / Shift + 键…</template>
            <template v-else-if="music.settings?.[k]">{{ name }} <span class="kbd">{{ music.settings[k] }}</span></template>
            <template v-else>设{{ name }}快捷键</template>
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-h">
          <h2><span class="hicon"><Icon name="i-queue" /></span>列表 {{ queue.length }} 首</h2>
          <span class="aside">
            拖动左边的序号调整顺序
            <ConfirmButton v-if="queue.length" label="清空" confirm-label="确认清空？" cls="btn" @confirm="clearQueue" />
          </span>
        </div>
        <Empty v-if="!queue.length" compact icon="i-queue" title="列表是空的" desc="观众点的歌和手动添加的歌会排在这里" />
        <div v-else class="mp-list">
          <div
            v-for="(it, i) in queue"
            :key="it.id"
            class="mp-row"
            :class="{ dragging: dragFrom === i, dropto: dragOver === i && dragFrom !== i }"
            @dragover.prevent="dragFrom !== null && (dragOver = i)"
            @dragleave="dragOver === i && (dragOver = null)"
            @drop.prevent="onDrop(i)"
          >
            <span class="rl-no grab" draggable="true" title="按住拖动调整顺序" @dragstart="(e) => onDragStart(e, i)" @dragend="(dragFrom = null), (dragOver = null)"><Icon name="i-grip" class="grip" />{{ i + 1 }}</span>
            <img v-if="it.song.cover" class="mp-thumb" :src="it.song.cover" alt="" referrerpolicy="no-referrer" />
            <span v-else class="mp-thumb blank"><Icon name="i-music" /></span>
            <span class="mp-t"><b>{{ it.song.name }}</b><span>{{ it.song.artists }}</span></span>
            <span class="mp-who"><Avatar :name="it.by.name" :face="it.by.face" :guard="it.by.guard" :size="20" /><span>{{ it.by.name }}</span></span>
            <span class="mp-d num">{{ mmss(it.song.durationMs) }}</span>
            <span class="mp-acts">
              <button class="icon-btn" type="button" :disabled="i === 0" :aria-label="`把《${it.song.name}》排到下一首`" title="排到下一首" @click="toTop(i)"><Icon name="i-up" /></button>
              <button class="icon-btn" type="button" :aria-label="`删掉《${it.song.name}》`" title="从列表删掉（可以撤销）" @click="removeSong(it)"><Icon name="i-x" /></button>
              <RowMenu :items="rowMenu(it)" :label="`《${it.song.name}》：更多操作`" />
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="mp-col">
      <div class="card">
        <div class="card-h"><h2><span class="hicon"><Icon name="i-plus" /></span>加歌</h2><span class="aside">不受点歌规则限制</span></div>
        <form class="mp-search" @submit.prevent="search">
          <input v-model="q" class="inp" placeholder="歌名，或者 歌名 歌手" aria-label="搜歌" maxlength="60" />
          <button class="btn primary" type="submit" :disabled="searching || !q.trim()"><Icon name="i-search" />{{ searching ? '搜索中…' : '搜索' }}</button>
        </form>
        <template v-if="hits">
          <template v-for="grp in [{ key: 'local', title: '本地歌库', list: hits.local }, { key: 'netease', title: '网易云', list: hits.netease }]" :key="grp.key">
            <h3 v-if="grp.list.length || (grp.key === 'netease' && hits.neteaseError)" class="mp-sub">{{ grp.title }}</h3>
            <p v-if="grp.key === 'netease' && hits.neteaseError" class="inline-hint err">{{ hits.neteaseError }}</p>
            <div v-for="h in grp.list" :key="`${h.source}${h.id}`" class="mp-hit" :class="{ dim: !h.playable }">
              <img v-if="h.cover" class="mp-thumb" :src="h.cover" alt="" referrerpolicy="no-referrer" />
              <span v-else class="mp-thumb blank"><Icon name="i-music" /></span>
              <span class="mp-t"><b>{{ h.name }}</b><span>{{ h.artists }}<template v-if="h.note"> · {{ h.note }}</template></span></span>
              <span class="mp-d num">{{ mmss(h.durationMs) }}</span>
              <span v-if="inList.has(`${h.source}:${h.id}`)" class="mp-in">已在列表</span>
              <span v-else class="mp-acts">
                <button class="btn sm" type="button" :disabled="!h.playable" @click="add(h, true)">下一首</button>
                <button class="btn sm" type="button" :disabled="!h.playable" @click="add(h, false)">加到最后</button>
              </span>
            </div>
          </template>
          <p v-if="!hits.local.length && !hits.netease.length && !hits.neteaseError" class="inline-hint">没有找到。</p>
        </template>
      </div>

      <div class="card">
        <div class="card-h"><h2><span class="hicon"><Icon name="i-demo" /></span>模拟点歌</h2><span class="aside">按点歌规则判断，不用开播</span></div>
        <form class="mp-sim" @submit.prevent="simulate">
          <input v-model="simText" class="inp" :placeholder="`${music.settings?.cmdRequest ?? '点歌'} 起风了`" aria-label="模拟的弹幕" maxlength="100" />
          <select v-model.number="simGuard" class="sel" aria-label="以什么身份发">
            <option :value="0">普通观众</option>
            <option :value="3">舰长</option>
            <option :value="2">提督</option>
            <option :value="1">总督</option>
          </select>
          <button class="btn" type="submit" :disabled="simBusy">发送</button>
        </form>
        <p v-if="simResult" class="mp-simr" :class="{ bad: !simResult.ok }"><Icon :name="simResult.ok ? 'i-check' : 'i-info'" />{{ simResult.text }}</p>
        <p class="inline-hint">以「测试观众」的身份发一条弹幕，点到的歌会真的进列表并播放。</p>
      </div>

      <div class="card">
        <div class="card-h"><h2><span class="hicon"><Icon name="i-chat" /></span>最近的点歌消息</h2><span class="aside">直播画面上也会提示</span></div>
        <Empty v-if="!music.notices.length" compact icon="i-chat" title="还没有点歌消息" />
        <div v-else class="mp-notes">
          <div v-for="n in music.notices" :key="n.id" class="mp-note" :class="{ bad: !n.ok }">
            <span class="t num">{{ clock(n.ts) }}</span><Icon :name="n.ok ? 'i-check' : 'i-x'" /><span><b>{{ n.who }}</b> {{ n.text }}<em v-if="n.quiet" class="mp-quiet" title="同一个人反复失败、点得太快这类，不在直播画面上提示，免得刷屏">只在后台</em></span>
          </div>
        </div>
      </div>
    </div>
    <MusicSwap v-if="swapping" :item="swapping.item" :playing="swapping.playing" @close="swapping = null" />
  </div>
</template>

<style scoped>
/* 正在放：卡片背后铺一层模糊的封面，上面盖一层和卡片同色的半透明渐变，字照样清楚 */
.mp-nowcard { overflow: hidden; isolation: isolate; }
.mp-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; border-radius: inherit; }
.mp-bg img { position: absolute; left: -15%; top: -35%; width: 130%; height: 170%; object-fit: cover; filter: blur(46px) saturate(1.6); opacity: .42; }
.mp-bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--l3) 40%, transparent) 0%, color-mix(in srgb, var(--l3) 72%, transparent) 55%, var(--l3) 100%); }
[data-theme="dark"] .mp-bg img { opacity: .55; }
.mp-nowcard.has-cover .mp-cover { box-shadow: 0 10px 28px -10px rgba(0, 0, 0, .45), 0 0 0 1px rgba(255, 255, 255, .25); }
.mp-nowcard.has-cover .ly { background: color-mix(in srgb, var(--l3) 55%, transparent); }
.mp-bgfade-enter-active, .mp-bgfade-leave-active { transition: opacity .9s ease; }
.mp-bgfade-enter-from, .mp-bgfade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .mp-bgfade-enter-active, .mp-bgfade-leave-active { transition: none; } }
.mh-top { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-bottom: 16px; align-items: stretch; }
@media (max-width: 1280px) { .mh-top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .mh-top > :first-child { grid-column: 1 / -1; } }
@media (max-width: 760px) { .mh-top { grid-template-columns: 1fr; } }
.mp-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.mp-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1100px) { .mp-grid { grid-template-columns: 1fr; } }

.mp-now { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 16px; align-items: center; }
.mp-cover { width: 96px; height: 96px; border-radius: var(--r-md); object-fit: cover; box-shadow: var(--shadow-card), 0 0 0 1px var(--line); }
.mp-cover.blank, .mp-thumb.blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.mp-cover.blank svg { width: 36px; height: 36px; }
.mp-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mp-title { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-artist { font-size: var(--fs-sec); color: var(--t2); display: flex; align-items: center; gap: 8px; min-width: 0; }
.mp-src { font-size: var(--fs-badge); padding: 1px 6px; border-radius: var(--r-xs); background: var(--hover); color: var(--t3); flex: none; }
.mp-by { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sec); color: var(--t2); }
.mp-bar { position: relative; height: 4px; margin-top: 6px; border-radius: 2px; background: var(--hover); overflow: hidden; }
.mp-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; background: var(--accent); transition: width .5s linear; }
.mp-now.paused .mp-bar i { background: var(--t3); }
.mp-time { display: flex; justify-content: space-between; font-size: var(--fs-cap); color: var(--t3); }
.mp-empty { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: var(--r-md); background: var(--hover); font-size: var(--fs-sec); color: var(--t2); line-height: 1.6; }
.mp-empty svg { width: 24px; height: 24px; flex: none; color: var(--accent); }
/* 歌词：唱到哪里，字就亮到哪里（和直播画面上的一样） */
.ly { position: relative; margin-top: 14px; padding: 12px 16px 12px 40px; border-radius: var(--r-md); background: var(--hover); overflow: hidden; }
.ly > svg { position: absolute; left: 14px; top: 15px; width: 15px; height: 15px; color: var(--accent); }
.ly.paused { opacity: .6; }
.ly-cur { position: relative; display: block; font-size: var(--fs-title); font-weight: 600; line-height: 1.5; color: var(--t3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ly-cur::after { content: attr(data-t); position: absolute; left: 0; top: 0; white-space: nowrap; color: var(--t1); clip-path: inset(0 calc(100% - var(--k, 0%)) 0 0); transition: clip-path .5s linear; }
.ly-cur.dim { font-weight: 500; }
.ly-next { display: block; margin-top: 2px; font-size: var(--fs-sec); color: var(--t3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ly-cur, .ly-next { animation: ly-in .35s cubic-bezier(.2, .8, .2, 1); }
@keyframes ly-in { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ly-cur, .ly-next { animation: none; } .ly-cur::after { transition: none; } }
.mp-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.mp-vol { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; font-size: var(--fs-sec); color: var(--t2); }
.mp-vol input { width: 140px; accent-color: var(--accent); }
.mp-vol .num { width: 26px; text-align: right; }
.mp-tip { margin: 8px 0 0; }

.mp-list { display: flex; flex-direction: column; margin: 0 -6px; max-height: 620px; overflow: auto; }
.mp-row, .mp-hit { display: grid; align-items: center; gap: 10px; padding: 7px 6px; border-radius: var(--r-sm); font-size: var(--fs-sec); }
.mp-row { grid-template-columns: 44px 36px minmax(0, 1fr) minmax(0, 9em) 40px 96px; }
.mp-row + .mp-row, .mp-hit + .mp-hit { border-top: 1px solid var(--line); }
.mp-row:hover, .mp-hit:hover { background: var(--hover); }
.mp-row.dragging { opacity: .4; }
.mp-row.dropto { box-shadow: inset 0 2px 0 var(--accent); }
.mp-thumb { width: 36px; height: 36px; border-radius: var(--r-sm); object-fit: cover; }
.mp-thumb.blank svg { width: 16px; height: 16px; }
.mp-t { display: flex; flex-direction: column; min-width: 0; }
.mp-t b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-t span { font-size: var(--fs-cap); color: var(--t2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-who { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--fs-sec); color: var(--t2); }
.mp-who span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-d { font-size: var(--fs-cap); color: var(--t3); text-align: right; }
.mp-acts { display: flex; gap: 4px; justify-content: flex-end; }
.mp-acts .btn.sm { height: 28px; padding: 0 10px; font-size: var(--fs-sec); }

.mp-search, .mp-sim { display: flex; gap: 8px; }
.mp-search .inp, .mp-sim .inp { flex: 1; min-width: 0; }
.mp-sim .sel { width: 108px; }
.mp-sub { margin: 16px 0 4px; font-size: var(--fs-sec); font-weight: 600; color: var(--t2); }
.mp-hit { grid-template-columns: 36px minmax(0, 1fr) 40px auto; margin: 0 -6px; }
.mp-hit.dim { opacity: .55; }
.mp-in { font-size: var(--fs-cap); color: var(--t3); }
.err { color: #D64545; }
.mp-simr { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 8px 12px; border-radius: var(--r-sm); background: var(--ok-soft); font-size: var(--fs-sec); }
.mp-simr svg { width: 15px; height: 15px; color: var(--ok); flex: none; }
.mp-simr.bad { background: var(--gov-soft); }
.mp-simr.bad svg { color: var(--gov); }

.mp-notes { display: flex; flex-direction: column; max-height: 320px; overflow: auto; }
.mp-note { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: var(--fs-sec); color: var(--t2); }
.mp-note + .mp-note { border-top: 1px solid var(--line); }
.mp-note .t { width: 58px; flex: none; color: var(--t3); font-size: var(--fs-cap); }
.mp-note svg { width: 14px; height: 14px; flex: none; color: var(--ok); }
.mp-note.bad svg { color: var(--gov); }
.mp-note b { color: var(--t1); font-weight: 600; }
.mp-quiet { margin-left: 6px; padding: 0 6px; border-radius: var(--r-xs); font-style: normal; font-size: var(--fs-badge); color: var(--t3); background: var(--hover); }
.mp-hk { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.mp-hkl { font-size: var(--fs-sec); color: var(--t2); margin-right: 4px; }
.mp-hk .btn.sm { height: 30px; padding: 0 12px; font-size: var(--fs-sec); }
.mp-hk .btn.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
</style>
