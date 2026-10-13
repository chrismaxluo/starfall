<script setup lang="ts">
// 点歌 · 歌库：上传音乐（可以一次选多个，歌词用同名的 .lrc 一起传）、改歌名歌手、配歌词、删除；电脑版还能直接用一个文件夹里的歌
import { computed, onMounted, ref, watch } from 'vue';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import { del, get, post, put, upload } from '../lib/api.ts';
import { desktop } from '../lib/desktop.ts';
import { fileSize } from '../lib/format.ts';
import { mmss, music } from '../lib/music.ts';
import type { LocalSong } from '../lib/music.ts';
import { state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';

const songs = ref<LocalSong[]>([]);
const folder = ref<string | null>(null);
const loaded = ref(false);
async function load(): Promise<void> {
  const r = await attempt(() => get<{ songs: LocalSong[]; folder: string | null }>('/api/music/local'));
  if (!r) return;
  songs.value = r.songs;
  folder.value = r.folder;
  music.libraryCount = r.songs.length;
  loaded.value = true;
}
onMounted(load);
// 别的窗口上传、删除了：重新读
watch(() => music.libraryRev, () => void load());

const q = ref('');
const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? songs.value.filter((x) => `${x.title} ${x.artist} ${x.album} ${x.filename}`.toLowerCase().includes(s)) : songs.value;
});

// ---------- 上传 ----------
const ACCEPT = '.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,.lrc';
const busy = ref<{ name: string; i: number; n: number; p: number } | null>(null);
const over = ref(false);
async function uploadAll(files: File[]): Promise<void> {
  if (!files.length || busy.value) return;
  // 先传音乐，再传歌词（歌词要配到已经有的歌上）
  const list = [...files].sort((a, b) => Number(a.name.toLowerCase().endsWith('.lrc')) - Number(b.name.toLowerCase().endsWith('.lrc')));
  let ok = 0;
  let same = 0;
  const failed: string[] = [];
  for (const [i, f] of list.entries()) {
    busy.value = { name: f.name, i: i + 1, n: list.length, p: 0 };
    try {
      const r = await upload<{ created?: boolean; lyricFor?: LocalSong }>('/api/music/local', f, (p) => busy.value && (busy.value.p = p));
      if (r.created === false) same++;
      else ok++;
    } catch (e) {
      failed.push(`${f.name}：${(e as Error).message}`);
    }
  }
  busy.value = null;
  await load();
  if (ok || same) toast(`传好了 ${ok} 个${same ? `，${same} 个已经在歌库里` : ''}`);
  for (const f of failed.slice(0, 3)) toast(f, 'err', 6000);
}
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  void uploadAll([...(input.files ?? [])]);
  input.value = '';
}
function onDrop(e: DragEvent): void {
  over.value = false;
  void uploadAll([...(e.dataTransfer?.files ?? [])]);
}

// ---------- 改名、歌词、删除 ----------
async function rename(s: LocalSong, k: 'title' | 'artist', e: Event): Promise<void> {
  const v = (e.target as HTMLInputElement).value.trim();
  if (v === s[k]) return;
  if (k === 'title' && !v) {
    (e.target as HTMLInputElement).value = s.title;
    return toast('歌名不能为空', 'info');
  }
  const r = await attempt(() => put<{ song: LocalSong }>(`/api/music/local/${s.id}`, { [k]: v }));
  if (r) Object.assign(s, r.song);
}
async function pickLyric(s: LocalSong, e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const text = await f.text();
  const r = await attempt(() => put<{ song: LocalSong }>(`/api/music/local/${s.id}`, { lyric: text }), `《${s.title}》配上歌词了`);
  if (r) Object.assign(s, r.song);
}
async function dropLyric(s: LocalSong): Promise<void> {
  const r = await attempt(() => put<{ song: LocalSong }>(`/api/music/local/${s.id}`, { lyric: null }), '歌词去掉了');
  if (r) Object.assign(s, r.song);
}
async function remove(s: LocalSong): Promise<void> {
  if (await attempt(() => del(`/api/music/local/${s.id}`), `已删掉《${s.title}》`)) await load();
}

// ---------- 电脑版：文件夹 ----------
const scanning = ref(false);
async function setFolder(dir: string | null): Promise<void> {
  scanning.value = true;
  const r = await attempt(() => put<{ total: number; added: number; removed: number; skipped: number }>('/api/music/local/folder', { dir }));
  scanning.value = false;
  if (!r) return;
  toast(dir ? `文件夹里有 ${r.total} 首${r.skipped ? `（${r.skipped} 个读不了，跳过了）` : ''}` : '不用文件夹了');
  await load();
}
async function chooseFolder(): Promise<void> {
  const dir = await desktop?.pickFolder?.();
  if (dir) await setFolder(dir);
}
async function rescan(): Promise<void> {
  scanning.value = true;
  const r = await attempt(() => post<{ total: number; added: number; removed: number }>('/api/music/local/rescan'));
  scanning.value = false;
  if (!r) return;
  toast(`重新扫描好了：${r.total} 首（新加 ${r.added}，去掉 ${r.removed}）`);
  await load();
}
</script>

<template>
  <div class="mlb">
    <div class="mlb-top">
      <label class="mlb-drop" :class="{ over, busy: busy }" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
        <input type="file" :accept="ACCEPT" multiple hidden :disabled="Boolean(busy)" @change="onPick" />
        <Icon name="i-upload" />
        <template v-if="busy">
          <b>正在上传 {{ busy.i }} / {{ busy.n }}：{{ busy.name }}</b>
          <span class="mlb-bar"><i :style="{ width: `${Math.round(busy.p * 100)}%` }" /></span>
        </template>
        <template v-else>
          <b>点这里选音乐文件，或者拖进来</b>
          <span>mp3、flac、m4a、ogg、wav 都可以，一次能选多个。歌词放一个和音乐文件同名的 .lrc 一起传，会自动配上。</span>
        </template>
      </label>

      <div v-if="state.desktop" class="card mlb-folder">
        <div class="card-h"><h2>用电脑上的文件夹</h2></div>
        <template v-if="folder">
          <p class="mlb-path" :title="folder"><Icon name="i-image" />{{ folder }}</p>
          <div class="mlb-fa">
            <button class="btn sm" :disabled="scanning" @click="rescan"><Icon name="i-replay" />{{ scanning ? '扫描中…' : '重新扫描' }}</button>
            <button v-if="desktop?.pickFolder" class="btn sm" :disabled="scanning" @click="chooseFolder">换一个</button>
            <ConfirmButton label="不用了" confirm-label="确认不用？" cls="btn sm" @confirm="setFolder(null)" />
          </div>
          <p class="inline-hint">文件夹里加了、删了歌，点「重新扫描」。</p>
        </template>
        <template v-else>
          <p class="inline-hint">不用上传：选一个放音乐的文件夹（包括子文件夹），里面的歌直接能点。</p>
          <button v-if="desktop?.pickFolder" class="btn sm primary" :disabled="scanning" @click="chooseFolder"><Icon name="i-plus" />{{ scanning ? '扫描中…' : '选择文件夹' }}</button>
          <p v-else class="inline-hint">请先把电脑版更新到最新版本。</p>
        </template>
      </div>
    </div>

    <div class="card">
      <div class="card-h">
        <h2>歌库 {{ songs.length }} 首</h2>
        <span class="aside"><input v-model="q" class="inp mlb-q" placeholder="搜歌名、歌手" aria-label="在歌库里搜" /></span>
      </div>
      <div v-if="!loaded" class="inline-hint">读取中…</div>
      <div v-else-if="!songs.length" class="inline-hint">歌库是空的。上传后，观众点歌时会先在这里找（规则里可以改成先找网易云）。</div>
      <div v-else-if="!shown.length" class="inline-hint">没有符合的歌。</div>
      <div v-else class="mlb-list">
        <div v-for="s in shown" :key="s.id" class="mlb-row">
          <img v-if="s.cover" class="mlb-cover" :src="s.cover" alt="" />
          <span v-else class="mlb-cover blank"><Icon name="i-music" /></span>
          <span class="mlb-ed">
            <input class="mlb-in t" :value="s.title" maxlength="200" :aria-label="`《${s.title}》的歌名`" @change="(e) => rename(s, 'title', e)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
            <input class="mlb-in a" :value="s.artist" maxlength="200" placeholder="歌手" :aria-label="`《${s.title}》的歌手`" @change="(e) => rename(s, 'artist', e)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
          </span>
          <span class="mlb-meta num">{{ mmss(s.durationMs) }} · {{ fileSize(s.size) }}<template v-if="s.folder"> · 文件夹</template></span>
          <span class="mlb-ly">
            <template v-if="s.hasLyric"><span class="mlb-has">有歌词</span><button class="icon-btn" type="button" :aria-label="`去掉《${s.title}》的歌词`" title="去掉歌词" @click="dropLyric(s)"><Icon name="i-x" /></button></template>
            <label v-else class="btn sm" :title="'选一个 .lrc 歌词文件'"><input type="file" accept=".lrc,text/plain" hidden @change="(e) => pickLyric(s, e)" />配歌词</label>
          </span>
          <ConfirmButton v-if="!s.folder" label="" confirm-label="删除" cls="icon-btn" :aria-label="`删除《${s.title}》`" @confirm="remove(s)"><Icon name="i-trash" /></ConfirmButton>
          <span v-else />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mlb { display: flex; flex-direction: column; gap: 16px; }
.mlb-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: stretch; }
@media (max-width: 1000px) { .mlb-top { grid-template-columns: 1fr; } }
.mlb-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 150px; padding: 20px; border-radius: 16px; border: 1.5px dashed var(--line-strong); background: var(--l2); text-align: center; cursor: pointer; }
.mlb-drop:hover, .mlb-drop.over { border-color: var(--accent); background: var(--accent-soft); }
.mlb-drop.busy { cursor: progress; }
.mlb-drop svg { width: 26px; height: 26px; color: var(--accent); }
.mlb-drop b { font-size: 14px; font-weight: 600; }
.mlb-drop span { font-size: 12.5px; color: var(--t2); max-width: 520px; line-height: 1.6; }
.mlb-bar { position: relative; width: 280px; height: 4px; border-radius: 2px; background: var(--hover); overflow: hidden; }
.mlb-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
.mlb-folder { width: 340px; margin: 0; }
@media (max-width: 1000px) { .mlb-folder { width: auto; } }
.mlb-path { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font: 12.5px/1.4 var(--font-mono); color: var(--t1); word-break: break-all; }
.mlb-path svg { width: 15px; height: 15px; flex: none; color: var(--accent); }
.mlb-fa { display: flex; gap: 6px; flex-wrap: wrap; }
.mlb-folder .btn.sm, .mlb-folder :deep(.btn.sm) { height: 28px; padding: 0 10px; font-size: 12.5px; }
.mlb-q { width: 200px; height: 30px; }
.mlb-list { display: flex; flex-direction: column; margin: 0 -6px; }
.mlb-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) 140px 110px 32px; align-items: center; gap: 12px; padding: 6px; border-radius: 8px; font-size: 13px; }
.mlb-row + .mlb-row { border-top: 1px solid var(--line); }
.mlb-row:hover { background: var(--hover); }
.mlb-cover { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
.mlb-cover.blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.mlb-cover.blank svg { width: 16px; height: 16px; }
.mlb-ed { display: flex; flex-direction: column; min-width: 0; }
.mlb-in { width: 100%; min-width: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--t1); font: inherit; padding: 1px 6px; margin-left: -6px; }
.mlb-in:hover { border-color: var(--line); }
.mlb-in:focus { outline: none; border-color: var(--accent); background: var(--l3); }
.mlb-in.t { font-weight: 600; }
.mlb-in.a { font-size: 12px; color: var(--t2); }
.mlb-meta { font-size: 12px; color: var(--t3); }
.mlb-ly { display: flex; align-items: center; gap: 4px; }
.mlb-ly .btn.sm { height: 26px; padding: 0 10px; font-size: 12px; cursor: pointer; }
.mlb-has { font-size: 12px; color: var(--ok); }
</style>
