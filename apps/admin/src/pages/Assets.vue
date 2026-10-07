<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import { del, post, put, upload } from '../lib/api.ts';
import { fileSize, seconds } from '../lib/format.ts';
import { go, route } from '../lib/route.ts';
import { checkFile } from '../lib/upload-check.ts';
import { PREVIEW_BY_KIND, usualKind } from '../lib/preview.ts';
import { builtinThumb, thumbOf } from '../lib/thumbs.ts';
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
/** 正在上传、排队和失败的文件（失败的留着，写明原因，可以重试或移除） */
const uploads = reactive<Array<{ id: number; name: string; pct: number; file: File; err?: string; waiting?: boolean }>>([]);
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
  // 先全部列出来（排队中），再一个一个传；每传完一个就刷新列表
  const list = [...files].map((file) => {
    const err = checkFile(file);
    const u = reactive({ id: ++upSeq, name: file.name, pct: 0, file, waiting: !err, ...(err ? { err } : {}) });
    uploads.push(u);
    return u;
  });
  let anim = false;
  let snd = false;
  for (const u of list) {
    if (u.err) continue;
    if (await uploadOne(u)) {
      if (AUDIO.test(u.name)) snd = true;
      else anim = true;
    }
  }
  if (snd && !anim) tab.value = 'sound';
  if (anim) tab.value = 'anim';
}
async function uploadOne(u: (typeof uploads)[number]): Promise<boolean> {
  u.waiting = false;
  delete u.err;
  u.pct = 0;
  try {
    if (AUDIO.test(u.name)) {
      const r = await upload<{ sound: SoundDto; duplicate: boolean }>('/api/sounds', u.file, (p) => (u.pct = Math.round(p * 100)));
      toast(r.duplicate ? `音效「${u.name}」已经有了` : `已添加音效：${u.name}`);
    } else {
      const r = await upload<{ asset: AssetDto; effect: EffectDto | null; duplicate?: boolean }>('/api/assets', u.file, (p) => (u.pct = Math.round(p * 100)));
      const warn = r.asset.warnings.includes('no_alpha') ? '（没有透明通道，会挡住画面）' : r.asset.warnings.includes('large') ? '（文件较大，首次加载会慢）' : '';
      toast(`已添加素材：${r.effect?.name ?? u.name}${warn}`, warn ? 'info' : 'ok', 6000, { label: '去触发规则里用上它', run: () => go('rules') });
    }
    uploads.splice(uploads.indexOf(u), 1);
    await refreshEffects();
    return true;
  } catch (e) {
    u.err = e instanceof Error ? e.message : String(e);
    return false;
  }
}
const dropUpload = (u: (typeof uploads)[number]) => uploads.splice(uploads.indexOf(u), 1);
function onPick(): void {
  if (fileIn.value?.files) void handleFiles(fileIn.value.files);
  if (fileIn.value) fileIn.value.value = '';
}
// 整个素材库页面都能把文件拖进来（不只上面的框）
const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));
function onDragOver(e: DragEvent): void {
  if (hasFiles(e)) over.value = true;
}
function onDragLeave(e: DragEvent): void {
  // 离开整个页面才算（在子元素之间移动也会触发 dragleave）
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) over.value = false;
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
// 卡片封面：视频取中间一帧（开头常是渐入、几乎全黑），SVGA / Lottie 渲染中间一帧
const covers = reactive(new Map<number, string | null>());
watch(
  () => state.effects.map((e) => e.asset?.url ?? '').join(),
  () => {
    for (const e of state.effects) {
      if (!e.asset || e.asset.kind === 'image' || covers.has(e.id)) continue;
      covers.set(e.id, null);
      void thumbOf(e).then((u) => covers.set(e.id, u));
    }
  },
  { immediate: true },
);
/** 鼠标停在卡片上时从头播放，移开后回到中间那一帧 */
function hoverVideo(ev: MouseEvent, play: boolean): void {
  const v = (ev.currentTarget as HTMLElement).querySelector('video');
  if (!v) return;
  if (play) {
    v.currentTime = 0;
    return void v.play().catch(() => undefined);
  }
  v.pause();
  if (Number.isFinite(v.duration)) v.currentTime = v.duration / 2;
}
const midFrame = (ev: Event) => {
  const v = ev.target as HTMLVideoElement;
  if (Number.isFinite(v.duration) && v.paused) v.currentTime = v.duration / 2;
};
/** 卡片右上角的 ▶：按它平时的用途预览 */
function previewCard(e: EffectDto): void {
  ui.preview = { effectId: e.id, label: e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '还没有规则在用', ...PREVIEW_BY_KIND[usualKind(e)] };
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
  if (s.usedBy.length) return toast(`「${baseName(s.filename)}」正在被 ${s.usedBy.map((u) => u.name).join('、')} 使用，请先在素材设置里换掉`, 'err');
  if (await attempt(() => del(`/api/assets/${s.id}`), `已删除音效：${baseName(s.filename)}`)) await refreshEffects();
}
// 卡片上的操作：改名（同一时间只改一个）、复制、删除
const renameKey = ref('');
const renameText = ref('');
const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) };
const baseName = (f: string) => f.replace(/\.[^.]+$/, '');
function startRename(key: string, name: string): void {
  renameKey.value = key;
  renameText.value = name;
}
async function commitRename(): Promise<void> {
  const key = renameKey.value;
  if (!key) return;
  renameKey.value = '';
  const name = renameText.value.trim();
  const id = Number(key.slice(2));
  const isSound = key.startsWith('s:');
  const old = isSound ? baseName(state.sounds.find((x) => x.id === id)?.filename ?? '') : state.effects.find((x) => x.id === id)?.name;
  if (!name || name === old) return;
  if (await attempt(() => put(isSound ? `/api/sounds/${id}` : `/api/effects/${id}`, { name }), `已改名为「${name}」`)) await refreshEffects();
}
async function copyEffect(e: EffectDto): Promise<void> {
  const r = await attempt(() => post<EffectDto>(`/api/effects/${e.id}/copy`, {}));
  if (!r) return;
  await refreshEffects();
  toast(`已复制为「${r.name}」`);
}
async function removeEffect(e: EffectDto): Promise<void> {
  if (e.usedBy.length) return toast(`「${e.name}」正在用于 ${e.usedBy.map((u) => u.label).join('、')}，请先在触发规则里换成其他素材`, 'err');
  if (await attempt(() => del(`/api/effects/${e.id}`), `已删除素材：${e.name}`)) await refreshEffects();
}
function openEditor(id: number): void {
  if (!renameKey.value) ui.editorId = id;
}
const bars = (id: number) => Array.from({ length: 28 }, (_, i) => 20 + Math.abs(Math.sin((id + 1) * 7.3 + i * 1.7)) * 70);
// 离开素材库时停掉正在试听的音效
onBeforeUnmount(() => {
  audio?.pause();
  audio = null;
});
/** 支持的格式（拖放框里的说明） */
const FORMATS = '动画：透明 WebM（推荐）· MP4（没有透明背景，会挡住画面）· SVGA · Lottie（.json）· GIF · PNG · APNG · WebP · JPG　音效：MP3 · WAV · OGG';
const showFormats = ref(false);
/** 自己的动画素材和音效都还没有：显示大的拖放框 */
const empty = computed(() => !state.effects.some((e) => !e.builtin) && !state.sounds.length && !uploads.length);
</script>

<template>
  <section class="page" @dragenter.prevent="onDragOver" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
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

    <!-- 还没有素材时是一个大的拖放框；有了素材就收成一条提示（右上角和列表里都有「上传素材」） -->
    <div v-if="empty" class="drop" :class="{ over }">
      <span class="ico"><Icon name="i-upload" /></span>
      <div>
        <b>把文件拖到这里，或点击选择</b>
        <span>{{ FORMATS }}　单个文件不超过 100 MB；拖到这个页面任何地方都可以</span>
      </div>
      <button class="btn" @click="fileIn?.click()">选择文件</button>
    </div>
    <template v-else>
      <div class="drop-slim" :class="{ over }">
        <Icon name="i-upload" /><span><b>把文件拖到这个页面任何地方</b>就能上传，单个文件不超过 100 MB</span>
        <button type="button" class="linkish" :aria-expanded="showFormats" @click="showFormats = !showFormats">支持哪些格式</button>
      </div>
      <div v-if="showFormats" class="fmts">{{ FORMATS }}</div>
    </template>
    <input ref="fileIn" type="file" multiple hidden :accept="ACCEPT" @change="onPick" />

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
        <div v-for="u in uploads" :key="`u${u.id}`" class="ecard uploading" :class="{ failed: u.err }">
          <div class="ethumb">
            <div v-if="u.err" class="up-err"><Icon name="i-ban" /><span>{{ u.err }}</span></div>
            <div v-else class="prog"><i :style="{ width: `${u.pct}%` }" /></div>
          </div>
          <div class="meta"><b>{{ u.name }}</b><span :class="u.err ? 'bad' : 'used'">{{ u.err ? '没有传上去' : u.waiting ? '排队中' : `上传中 ${u.pct}%` }}</span></div>
          <div v-if="u.err" class="card-acts">
            <button type="button" @click="uploadOne(u)"><Icon name="i-replay" />重试</button>
            <button type="button" @click="dropUpload(u)"><Icon name="i-x" />移除</button>
          </div>
        </div>
        <div v-for="e in mine" :key="e.id" class="ecard" role="button" tabindex="0" :aria-label="`${e.name} 的设置`" @click="openEditor(e.id)" @keydown.enter.self="openEditor(e.id)" @keydown.space.self.prevent="openEditor(e.id)" @mouseenter="(ev) => hoverVideo(ev, true)" @mouseleave="(ev) => hoverVideo(ev, false)">
          <div class="ethumb" :class="{ alpha: e.asset?.hasAlpha }">
            <template v-if="e.asset">
              <video v-if="e.asset.kind === 'video'" class="thumb-media" :src="e.asset.url" :poster="covers.get(e.id) ?? undefined" muted loop playsinline preload="metadata" @loadedmetadata="midFrame" />
              <img v-else-if="e.asset.kind === 'image'" class="thumb-media" :src="e.asset.url" alt="" loading="lazy" />
              <img v-else-if="covers.get(e.id)" class="thumb-media" :src="covers.get(e.id)!" alt="" />
              <span v-else class="thumb-icon"><Icon name="i-spark" /></span>
              <div class="fmt"><span>{{ e.asset.ext.toUpperCase() }}</span><span v-if="!e.asset.hasAlpha" class="warn">无透明</span></div>
            </template>
            <img v-else-if="e.visual.type === 'builtin_style'" class="thumb-media cover" :src="builtinThumb(e.visual.style)" alt="" loading="lazy" />
            <button type="button" class="card-play" :aria-label="`预览 ${e.name}`" title="预览" @click.stop="previewCard(e)"><svg><use href="#i-play" /></svg></button>
          </div>
          <div class="meta">
            <input v-if="renameKey === `e:${e.id}`" v-model="renameText" v-focus class="inp rn" maxlength="40" aria-label="新名字" @click.stop @keydown.enter.prevent="commitRename" @keydown.esc.prevent="renameKey = ''" @blur="commitRename" />
            <b v-else>{{ e.name }}</b>
            <span>{{ meta(e) }}</span>
            <span :class="{ used: e.usedBy.length }">{{ e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '未使用 · 在触发规则里选它' }}</span>
          </div>
          <div class="card-acts" @click.stop @keydown.stop>
            <button type="button" :aria-label="`重命名 ${e.name}`" @click="startRename(`e:${e.id}`, e.name)"><Icon name="i-pen" />重命名</button>
            <button type="button" :aria-label="`复制 ${e.name}`" @click="copyEffect(e)"><Icon name="i-dup" />复制</button>
            <button v-if="e.usedBy.length" type="button" class="off" :title="`正在用于 ${e.usedBy.map((u) => u.label).join('、')}，先在触发规则里换掉才能删除`" @click="removeEffect(e)"><Icon name="i-trash" />删除</button>
            <ConfirmButton v-else label="删除" confirm-label="确认删除？" cls="danger" armed-cls="delb" @confirm="removeEffect(e)"><Icon name="i-trash" />删除</ConfirmButton>
          </div>
        </div>
      </div>
      <div class="a-sec"><h2>内置素材</h2><span>随软件提供，不能直接修改，复制一份就能自由调整</span></div>
      <div class="ecards">
        <div v-for="e in builtin" :key="e.id" class="ecard" role="button" tabindex="0" :aria-label="`${e.name} 的设置`" @click="openEditor(e.id)" @keydown.enter.self="openEditor(e.id)" @keydown.space.self.prevent="openEditor(e.id)">
          <div class="ethumb">
            <img v-if="e.visual.type === 'builtin_style'" class="thumb-media cover" :src="builtinThumb(e.visual.style)" alt="" loading="lazy" />
            <button type="button" class="card-play" :aria-label="`预览 ${e.name}`" title="预览" @click.stop="previewCard(e)"><svg><use href="#i-play" /></svg></button>
          </div>
          <div class="meta">
            <b>{{ e.name }}<em>内置</em></b><span>{{ meta(e) }}</span>
            <span :class="{ used: e.usedBy.length }">{{ e.usedBy.length ? `用于 ${e.usedBy.map((u) => u.label).join('、')}` : '未使用' }}</span>
          </div>
          <div class="card-acts" @click.stop @keydown.stop>
            <button type="button" :aria-label="`复制 ${e.name}`" @click="copyEffect(e)"><Icon name="i-dup" />复制一份来改</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="agrid">
      <div v-for="s in sounds" :key="s.id" class="acard" style="cursor: default">
        <div class="thumb">
          <div class="wave"><i v-for="(h, i) in bars(s.id)" :key="i" :class="{ on: playing === s.id }" :style="{ height: `${h}%` }" /></div>
          <button class="playb" :aria-label="`试听 ${baseName(s.filename)}`" @click="playSound(s)"><svg><use :href="playing === s.id ? '#i-pause' : '#i-play'" /></svg></button>
          <span class="dur">{{ seconds(s.durationMs) }}</span>
        </div>
        <div class="ameta">
          <input v-if="renameKey === `s:${s.id}`" v-model="renameText" v-focus class="inp rn" maxlength="60" aria-label="新名字" @keydown.enter.prevent="commitRename" @keydown.esc.prevent="renameKey = ''" @blur="commitRename" />
          <b v-else>{{ baseName(s.filename) }}</b>
          <span>{{ s.ext.toUpperCase() }} · {{ fileSize(s.size) }}</span>
          <span :class="s.usedBy.length ? 'used' : 'unused'">{{ s.usedBy.length ? `用于 ${s.usedBy.map((u) => u.name).join('、')}` : '未使用' }}</span>
        </div>
        <div class="card-acts">
          <button type="button" :aria-label="`重命名 ${baseName(s.filename)}`" @click="startRename(`s:${s.id}`, baseName(s.filename))"><Icon name="i-pen" />重命名</button>
          <button v-if="s.usedBy.length" type="button" class="off" :title="`正在被 ${s.usedBy.map((u) => u.name).join('、')} 使用，先在素材设置里换掉才能删除`" @click="removeSound(s)"><Icon name="i-trash" />删除</button>
          <ConfirmButton v-else label="删除" confirm-label="确认删除？" cls="danger" armed-cls="delb" @confirm="removeSound(s)"><Icon name="i-trash" />删除</ConfirmButton>
        </div>
      </div>
      <div v-if="!sounds.length" class="soon-box" style="grid-column: 1 / -1"><b>还没有音效</b>把 MP3 / WAV / OGG 拖到上面就能添加，然后在素材设置的「音效」里选用</div>
    </div>
  </section>
</template>
