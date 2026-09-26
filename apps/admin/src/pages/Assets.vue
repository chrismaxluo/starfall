<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import { del, upload } from '../lib/api.ts';
import { fileSize, seconds } from '../lib/format.ts';
import { route } from '../lib/route.ts';
import { STYLES } from '../lib/identity.ts';
import { refreshEffects, state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { AssetDto, EffectDto, SoundDto } from '../lib/types.ts';

// #assets/sound 直接打开音效（命令面板）
const tab = ref<'anim' | 'sound'>(route.value.sub === 'sound' ? 'sound' : 'anim');
watch(
  () => route.value.sub,
  (sub) => (tab.value = sub === 'sound' ? 'sound' : 'anim'),
);
const q = ref('');
const sort = ref<'new' | 'name' | 'used'>('new');
const over = ref(false);
const fileIn = ref<HTMLInputElement | null>(null);
const uploads = reactive<Array<{ id: number; name: string; pct: number }>>([]);
let upSeq = 0;
const ACCEPT = '.webm,.mp4,.svga,.json,.gif,.png,.apng,.webp,.jpg,.jpeg,.mp3,.wav,.ogg';
const AUDIO = /\.(mp3|wav|ogg)$/i;

const mine = computed(() => {
  const list = state.effects.filter((e) => !e.builtin && (!q.value || e.name.includes(q.value)));
  if (sort.value === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (sort.value === 'used') return list.sort((a, b) => b.usedBy.length - a.usedBy.length);
  return list.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
});
const builtin = computed(() => state.effects.filter((e) => e.builtin && (!q.value || e.name.includes(q.value))));
const sounds = computed(() => state.sounds.filter((s) => !q.value || s.filename.includes(q.value)));
const totalSize = computed(() => {
  const seen = new Map<number, number>();
  for (const e of state.effects) if (e.asset) seen.set(e.asset.id, e.asset.size);
  for (const s of state.sounds) seen.set(s.id, s.size);
  return [...seen.values()].reduce((a, b) => a + b, 0);
});

async function handleFiles(files: FileList | File[]): Promise<void> {
  const list = [...files];
  let anim = false;
  let snd = false;
  for (const f of list) {
    const u = { id: ++upSeq, name: f.name, pct: 0 };
    uploads.push(u);
    const isAudio = AUDIO.test(f.name);
    try {
      if (isAudio) {
        const r = await upload<{ sound: SoundDto; duplicate: boolean }>('/api/sounds', f, (p) => (u.pct = Math.round(p * 100)));
        snd = true;
        toast(r.duplicate ? `音效「${f.name}」已经有了` : `已添加音效：${f.name}`);
      } else {
        const r = await upload<{ asset: AssetDto; effect: EffectDto | null }>('/api/assets', f, (p) => (u.pct = Math.round(p * 100)));
        anim = true;
        const warn = r.asset.warnings.includes('no_alpha') ? '（没有透明通道，会挡住画面）' : r.asset.warnings.includes('large') ? '（文件较大，首次加载会慢）' : '';
        toast(`已添加素材：${r.effect?.name ?? f.name}${warn}。去触发规则里选它，或点开调整`, warn ? 'info' : 'ok', warn ? 5000 : 3000);
      }
    } catch (e) {
      toast(`${f.name}：${e instanceof Error ? e.message : String(e)}`, 'err');
    } finally {
      uploads.splice(uploads.indexOf(u), 1);
    }
  }
  await refreshEffects();
  if (snd && !anim) tab.value = 'sound';
  if (anim) tab.value = 'anim';
}
function onPick(): void {
  if (fileIn.value?.files) void handleFiles(fileIn.value.files);
  if (fileIn.value) fileIn.value.value = '';
}
function onDrop(e: DragEvent): void {
  over.value = false;
  if (e.dataTransfer?.files.length) void handleFiles(e.dataTransfer.files);
}

function meta(e: EffectDto): string {
  if (e.visual.type === 'builtin_style') return `内置样式 · ${(e.durationMs / 1000).toFixed(1)}s`;
  const a = e.asset;
  return a ? `${a.ext.toUpperCase()}${a.width ? ` · ${a.width}×${a.height}` : ''} · ${seconds(a.durationMs)} · ${fileSize(a.size)}` : '文件已丢失';
}
function hoverVideo(ev: MouseEvent, play: boolean): void {
  const v = (ev.currentTarget as HTMLElement).querySelector('video');
  if (!v) return;
  if (play) return void v.play().catch(() => undefined);
  v.pause();
  v.currentTime = 0;
}

// 音效试听
const playing = ref<number | null>(null);
let audio: HTMLAudioElement | null = null;
function playSound(s: SoundDto): void {
  audio?.pause();
  if (playing.value === s.id) return void (playing.value = null);
  audio = new Audio(s.url);
  playing.value = s.id;
  audio.onended = () => (playing.value = null);
  void audio.play().catch(() => (playing.value = null));
}
async function removeSound(s: SoundDto): Promise<void> {
  if (s.usedBy.length) return toast(`「${s.filename}」正在被 ${s.usedBy.map((u) => u.name).join('、')} 使用，请先在素材设置里换掉`, 'err');
  if (await attempt(() => del(`/api/assets/${s.id}`), `已删除音效：${s.filename}`)) await refreshEffects();
}
const bars = (id: number) => Array.from({ length: 28 }, (_, i) => 20 + Math.abs(Math.sin((id + 1) * 7.3 + i * 1.7)) * 70);
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>素材库</h1>
        <p>上传的动画和图片就是进场特效，在触发规则里直接选用。音效单独管理，可以被多个素材共用。</p>
      </div>
      <div class="actions">
        <span class="usage"><span class="num">已用 {{ fileSize(totalSize) }}</span></span>
        <button class="btn primary" @click="fileIn?.click()"><Icon name="i-upload" />上传素材</button>
      </div>
    </div>

    <div class="drop" :class="{ over }" @dragenter.prevent="over = true" @dragover.prevent="over = true" @dragleave.prevent="over = false" @drop.prevent="onDrop">
      <span class="ico"><Icon name="i-upload" /></span>
      <div>
        <b>把文件拖到这里，或点击选择</b>
        <span>动画：透明 WebM（推荐）· MP4 · SVGA · Lottie（.json）· GIF · PNG · WebP　音效：MP3 · WAV · OGG　单个文件不超过 100 MB</span>
      </div>
      <button class="btn" @click="fileIn?.click()">选择文件</button>
      <input ref="fileIn" type="file" multiple hidden :accept="ACCEPT" @change="onPick" />
    </div>

    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="素材类型">
        <button role="tab" :aria-pressed="tab === 'anim'" @click="tab = 'anim'">动画素材 <span class="num">{{ state.effects.filter((e) => !e.builtin).length }}</span></button>
        <button role="tab" :aria-pressed="tab === 'sound'" @click="tab = 'sound'">音效 <span class="num">{{ state.sounds.length }}</span></button>
      </div>
      <div class="s"><Icon name="i-search" /><input v-model.trim="q" class="inp" :placeholder="tab === 'anim' ? '搜索素材名称' : '搜索音效名称'" aria-label="搜索" /></div>
      <select v-if="tab === 'anim'" v-model="sort" class="sel" style="width: 130px" aria-label="排序">
        <option value="new">最近上传</option><option value="name">按名称</option><option value="used">按使用次数</option>
      </select>
    </div>

    <div v-if="tab === 'anim'">
      <div class="a-sec" style="margin-top: 4px"><h2>我的素材</h2><span>{{ mine.length }} 个</span></div>
      <div class="ecards">
        <button class="ecard new" @click="fileIn?.click()"><div><Icon name="i-upload" />上传素材</div></button>
        <div v-for="u in uploads" :key="`u${u.id}`" class="ecard uploading">
          <div class="ethumb"><div class="prog"><i :style="{ width: `${u.pct}%` }" /></div></div>
          <div class="meta"><b>{{ u.name }}</b><span class="used">上传中 {{ u.pct }}%</span></div>
        </div>
        <button v-for="e in mine" :key="e.id" class="ecard" @click="ui.editorId = e.id" @mouseenter="(ev) => hoverVideo(ev, true)" @mouseleave="(ev) => hoverVideo(ev, false)">
          <div class="ethumb" :class="{ alpha: e.asset?.hasAlpha }">
            <template v-if="e.asset">
              <video v-if="e.asset.kind === 'video'" class="thumb-media" :src="e.asset.url" muted loop playsinline preload="metadata" />
              <img v-else-if="e.asset.kind === 'image'" class="thumb-media" :src="e.asset.url" alt="" loading="lazy" />
              <span v-else class="thumb-icon"><Icon name="i-spark" /></span>
              <div class="fmt"><span>{{ e.asset.ext.toUpperCase() }}</span><span v-if="!e.asset.hasAlpha" class="warn">无透明</span></div>
            </template>
            <div v-else class="mpos pos-center">
              <div class="mini" :class="`tpl-${e.visual.type === 'builtin_style' ? e.visual.style : 'line'}`" :style="{ '--edge': STYLES[e.visual.type === 'builtin_style' ? e.visual.style : 'line']?.edge }">
                <span class="avatar" :style="{ background: STYLES[e.visual.type === 'builtin_style' ? e.visual.style : 'line']?.grad }">星</span><span><b>{{ e.name }}</b></span>
              </div>
            </div>
          </div>
          <div class="meta">
            <b>{{ e.name }}</b><span>{{ meta(e) }}</span>
            <span :class="{ used: e.usedBy.length }">{{ e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '未使用 · 在触发规则里选它' }}</span>
          </div>
        </button>
      </div>
      <div class="a-sec"><h2>内置素材</h2><span>随软件提供，不能直接修改，复制一份就能自由调整</span></div>
      <div class="ecards">
        <button v-for="e in builtin" :key="e.id" class="ecard" @click="ui.editorId = e.id">
          <div class="ethumb">
            <div class="mpos pos-center">
              <div class="mini" :class="`tpl-${e.visual.type === 'builtin_style' ? e.visual.style : 'line'}`" :style="{ '--edge': STYLES[e.visual.type === 'builtin_style' ? e.visual.style : 'line']?.edge }">
                <span class="avatar" :style="{ background: STYLES[e.visual.type === 'builtin_style' ? e.visual.style : 'line']?.grad }">星</span><span><b>{{ e.name }}</b></span>
              </div>
            </div>
          </div>
          <div class="meta">
            <b>{{ e.name }}<em>内置</em></b><span>{{ meta(e) }}</span>
            <span :class="{ used: e.usedBy.length }">{{ e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '未使用' }}</span>
          </div>
        </button>
      </div>
    </div>

    <div v-else class="agrid">
      <div v-for="s in sounds" :key="s.id" class="acard" style="cursor: default">
        <div class="thumb">
          <div class="wave"><i v-for="(h, i) in bars(s.id)" :key="i" :class="{ on: playing === s.id }" :style="{ height: `${h}%` }" /></div>
          <button class="playb" :aria-label="`试听 ${s.filename}`" @click="playSound(s)"><svg><use :href="playing === s.id ? '#i-pause' : '#i-play'" /></svg></button>
          <span class="dur">{{ seconds(s.durationMs) }}</span>
        </div>
        <div class="ameta">
          <b>{{ s.filename }}</b>
          <span>{{ s.ext.toUpperCase() }} · {{ fileSize(s.size) }}</span>
          <span :class="s.usedBy.length ? 'used' : 'unused'">{{ s.usedBy.length ? `用于 ${s.usedBy.map((u) => u.name).join('、')}` : '未使用' }}</span>
        </div>
        <div class="del-row"><ConfirmButton label="删除" cls="btn" style="height: 28px; font-size: 12px" @confirm="removeSound(s)" /></div>
      </div>
      <div v-if="!sounds.length" class="soon-box" style="grid-column: 1 / -1"><b>还没有音效</b>把 MP3 / WAV / OGG 拖到上面就能添加，然后在素材设置的「音效」里选用</div>
    </div>
  </section>
</template>
