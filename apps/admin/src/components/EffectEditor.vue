<script setup lang="ts">
// 素材设置（F-AS-06 ~ 12）：左边预览，右边 ① 画面 ② 头像和欢迎语 ③ 音效 ④ 位置与时长
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { POSITION_NAMES } from '@starfall/shared/labels';
import { FADE_MAX_MS, FADE_MIN_MS, FEATHER_MAX, OFFSET_MAX, SIZE_MAX, SIZE_MIN } from '@starfall/shared';
import type { EffectTexts, FeatherMode, Position } from '@starfall/shared';
import { del, post, put, upload } from '../lib/api.ts';
import { fileSize, seconds } from '../lib/format.ts';
import { placeWarnings } from '../lib/place.ts';
import { SAMPLES, STYLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { effectById, output, refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { AssetDto, EffectDto, SoundDto } from '../lib/types.ts';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import PreviewStage from './PreviewStage.vue';
import Seg from './Seg.vue';
import Switch from './Switch.vue';

const props = defineProps<{ effectId: number }>();
const emit = defineEmits<{ close: [] }>();
const eff = computed(() => effectById(props.effectId));
const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
const repIn = ref<HTMLInputElement | null>(null);
const sndIn = ref<HTMLInputElement | null>(null);
const busy = ref(false);

type TextKey = keyof EffectTexts;
const TEXT_TABS: Array<{ value: TextKey; label: string }> = [
  { value: 'enter', label: '通用（进场）' },
  { value: 'gift', label: '礼物时' },
  { value: 'guard', label: '上舰时' },
  { value: 'danmu', label: '弹幕时' },
];
const VARS = ['{name}', '{guard}', '{medal}', '{level}', '{text}', '{gift}', '{count}', '{value}', '{months}', '{op}', '{act}'];
// 宫廷特效铺满画面，位置只分偏上 / 居中 / 偏下
const ROYAL_POSITIONS: Array<{ value: Position; label: string }> = [
  { value: 'top', label: '偏上' },
  { value: 'center', label: '居中' },
  { value: 'bl', label: '偏下' },
];
const positionOptions = computed(() =>
  eff.value?.visual.type === 'builtin_style' && eff.value.visual.style.startsWith('royal-') ? ROYAL_POSITIONS : (Object.keys(POSITION_NAMES) as Position[]).map((k) => ({ value: k, label: POSITION_NAMES[k] })),
);

function snapshot(e: EffectDto) {
  return {
    name: e.name,
    showText: e.showText,
    texts: { enter: e.texts.enter.join('\n'), gift: (e.texts.gift ?? []).join('\n'), guard: (e.texts.guard ?? []).join('\n'), danmu: (e.texts.danmu ?? []).join('\n') },
    soundAssetId: e.soundAssetId,
    volume: e.volume,
    position: e.position,
    seconds: e.durationMs / 1000,
    durationCustom: e.durationCustom,
    fadeIn: e.fadeIn,
    fadeOut: e.fadeOut,
    fadeInS: e.fadeInMs / 1000,
    fadeOutS: e.fadeOutMs / 1000,
    offsetX: e.offsetX,
    offsetY: e.offsetY,
    sizePct: e.sizePct,
    feather: e.feather,
    featherPct: e.featherPct,
    guardFrame: e.guardFrame,
  };
}
const d = ref(eff.value ? snapshot(eff.value) : null);
const saved = ref(eff.value ? JSON.stringify(snapshot(eff.value)) : '');
const dirty = computed(() => d.value !== null && JSON.stringify(d.value) !== saved.value);
const txTab = ref<TextKey>('enter');
const ta = ref<HTMLTextAreaElement | null>(null);
const ro = computed(() => eff.value?.builtin ?? true);
const replaceRefs = ref(true);

function lines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean);
}
/** 渐入渐出秒数 → 毫秒（0.1 ~ 5 秒） */
const fadeMs = (sec: number) => Math.round(Math.min(FADE_MAX_MS, Math.max(FADE_MIN_MS, (sec || 0) * 1000)));
/** 位置微调：画面宽、高的百分比，保留一位小数 */
const clampOff = (n: number) => Math.round(Math.min(OFFSET_MAX, Math.max(-OFFSET_MAX, n || 0)) * 10) / 10;
const clampSize = (n: number) => Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, n || 100)));
const offText = (n: number, neg: string, pos: string) => (Math.abs(n) < 0.05 ? '不挪' : `${n < 0 ? neg : pos} ${Math.abs(n)}%`);
/** 要提交给服务端的修改 */
function patch() {
  const v = d.value!;
  const texts: EffectTexts = { enter: lines(v.texts.enter).length ? lines(v.texts.enter) : ['{name} 来了'] };
  for (const k of ['gift', 'guard', 'danmu'] as const) if (lines(v.texts[k]).length) texts[k] = lines(v.texts[k]);
  const base = { showText: v.showText, texts, soundAssetId: v.soundAssetId, volume: v.volume, position: v.position, fadeIn: v.fadeIn, fadeOut: v.fadeOut, fadeInMs: fadeMs(v.fadeInS), fadeOutMs: fadeMs(v.fadeOutS), ...(a.value ? { offsetX: clampOff(v.offsetX), offsetY: clampOff(v.offsetY), sizePct: clampSize(v.sizePct), feather: v.feather, featherPct: Math.min(FEATHER_MAX, Math.max(0, Math.round(v.featherPct || 0))), guardFrame: v.guardFrame } : {}) };
  // 有时长的素材默认按素材本身时长播放；手动设置时不超过素材本身
  if (timed.value && !v.durationCustom) return { ...base, durationCustom: false };
  const durationMs = Math.round(Math.min(maxSeconds.value, Math.max(0.5, v.seconds || 0)) * 1000);
  return timed.value ? { ...base, durationCustom: true, durationMs } : { ...base, durationMs };
}

/** 示例观众：按这个素材用在哪条规则选（总督规则用总督观众） */
const sample = computed(() => {
  const u = (eff.value?.usedBy ?? []).map((x) => x.label).join(' ');
  const id: Identity = /总督/.test(u) ? 'gov' : /提督/.test(u) ? 'adm' : /舰长/.test(u) ? 'cap' : /房管/.test(u) ? 'mod' : /粉丝牌/.test(u) ? 'fan' : 'cap';
  return SAMPLES[id];
});
const KIND_OF_TAB: Record<TextKey, 'enter' | 'gift' | 'guard' | 'danmu'> = { enter: 'enter', gift: 'gift', guard: 'guard', danmu: 'danmu' };
function replay(): void {
  if (!eff.value || !d.value) return;
  void stage.value?.play(eff.value.id, sample.value, patch(), KIND_OF_TAB[txTab.value]).then(() => setTimeout(checkSafe, 300));
}
let replayTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => d.value && [d.value.position, d.value.showText, d.value.soundAssetId, d.value.fadeIn, d.value.fadeOut, d.value.durationCustom, d.value.guardFrame],
  () => replay(),
);
watch(
  () => d.value && [d.value.texts[txTab.value], d.value.seconds, d.value.fadeInS, d.value.fadeOutS],
  () => {
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = setTimeout(replay, 600);
  },
);
onMounted(() => setTimeout(replay, 300));

// 位置微调、大小：正在播放时直接改过去，不重新播放；没在播放时重播一遍
let offTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => d.value && [d.value.offsetX, d.value.offsetY, d.value.sizePct],
  () => {
    if (!d.value) return;
    checkSafe();
    if (stage.value?.nudge(clampOff(d.value.offsetX), clampOff(d.value.offsetY), clampSize(d.value.sizePct)) || drag) return;
    if (offTimer) clearTimeout(offTimer);
    offTimer = setTimeout(replay, 600);
  },
);

/** 调整后比原来多盖住的区域（顶部信息栏、底部弹幕区），以及有没有超出画面 */
const intoSafe = ref('');
const outOfStage = ref(false);
/** 挪过位置或改过大小 */
const adjusted = computed(() => Boolean(d.value && (d.value.offsetX || d.value.offsetY || clampSize(d.value.sizePct) !== 100)));
function checkSafe(): void {
  const g = stage.value?.geom();
  const v = d.value;
  const out = o.value;
  if (!g?.base || !v || !out) return;
  const w = placeWarnings(g.base, g.stage, out, g.pos, clampOff(v.offsetX), clampOff(v.offsetY), clampSize(v.sizePct));
  intoSafe.value = w.into.join('、');
  outOfStage.value = w.out;
}

// 在预览里按住素材拖动
let drag: { x: number; y: number; ox: number; oy: number; w: number; h: number } | null = null;
const dragging = ref(false);
const overMedia = ref(false);
function hit(e: PointerEvent): boolean {
  const r = stage.value?.geom()?.media;
  return Boolean(r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h);
}
function onDown(e: PointerEvent): void {
  const g = stage.value?.geom();
  if (!d.value || !g || e.button !== 0) return;
  // 素材已经播完：点一下先重播
  if (!g.media) return replay();
  if (!hit(e)) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  stage.value?.hold();
  drag = { x: e.clientX, y: e.clientY, ox: d.value.offsetX, oy: d.value.offsetY, w: g.stage.w, h: g.stage.h };
  dragging.value = true;
}
function onMove(e: PointerEvent): void {
  if (!drag) return void (overMedia.value = hit(e));
  if (!d.value) return;
  d.value.offsetX = clampOff(drag.ox + ((e.clientX - drag.x) / drag.w) * 100);
  d.value.offsetY = clampOff(drag.oy + ((e.clientY - drag.y) / drag.h) * 100);
}
function onUp(): void {
  if (!drag) return;
  drag = null;
  dragging.value = false;
  // 松手后在新位置从头播一遍
  replay();
}
function resetOffset(): void {
  if (!d.value) return;
  d.value.offsetX = 0;
  d.value.offsetY = 0;
  d.value.sizePct = 100;
}

function insertVar(v: string): void {
  const el = ta.value;
  if (!el || !d.value) return;
  const s = el.selectionStart;
  const e = el.selectionEnd;
  const cur = d.value.texts[txTab.value];
  d.value.texts[txTab.value] = cur.slice(0, s) + v + cur.slice(e);
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = s + v.length;
  });
}

async function save(): Promise<void> {
  if (!eff.value || !d.value || ro.value) return;
  const name = d.value.name.trim();
  if (!name) return toast('请填写素材名称', 'info');
  busy.value = true;
  const r = await attempt(() => put<EffectDto>(`/api/effects/${eff.value!.id}`, { name, ...patch() }));
  busy.value = false;
  if (!r) return;
  await refreshEffects();
  toast(`已保存：${name}${r.usedBy.length ? `，${r.usedBy.map((u) => u.label).join('、')} 已同步` : ''}`);
  emit('close');
}

async function copy(): Promise<void> {
  if (!eff.value) return;
  // 复制的是已保存的版本，会切到副本：没保存的修改先提醒一次
  if (dirty.value && !confirmCopy.value) {
    confirmCopy.value = true;
    return toast('有修改还没保存，复制出的副本不包含这些修改；再点一次「复制」会放弃修改', 'info', 4000);
  }
  const used = eff.value.usedBy.length > 0;
  const r = await attempt(() => post<EffectDto>(`/api/effects/${eff.value!.id}/copy`, { replaceRefs: eff.value!.builtin && used && replaceRefs.value }));
  if (!r) return;
  await Promise.all([refreshEffects(), refreshRules()]);
  toast(`已复制为「${r.name}」${r.usedBy.length ? `，${r.usedBy.map((u) => u.label).join('、')} 已换成副本` : ''}`);
  ui.editorId = r.id;
}

async function remove(): Promise<void> {
  if (!eff.value) return;
  if (eff.value.usedBy.length) return toast(`「${eff.value.name}」正在用于 ${eff.value.usedBy.map((u) => u.label).join('、')}，请先在触发规则里换成其他素材`, 'err');
  if (!(await attempt(() => del(`/api/effects/${eff.value!.id}`), `已删除素材：${eff.value.name}`))) return;
  await refreshEffects();
  emit('close');
}

async function replaceFile(): Promise<void> {
  const f = repIn.value?.files?.[0];
  if (repIn.value) repIn.value.value = '';
  if (!f || !eff.value) return;
  busy.value = true;
  const r = await attempt(() => upload<EffectDto>(`/api/effects/${eff.value!.id}/file`, f, undefined, 'PUT'), '已替换文件，所有用到它的规则自动换成新文件');
  busy.value = false;
  if (r) {
    await refreshEffects();
    if (d.value) d.value.seconds = r.durationMs / 1000;
    saved.value = JSON.stringify({ ...JSON.parse(saved.value), seconds: r.durationMs / 1000 });
    replay();
  }
}

async function onSound(e: Event): Promise<void> {
  const v = (e.target as HTMLSelectElement).value;
  if (v !== '__up') return void (d.value!.soundAssetId = v ? Number(v) : null);
  (e.target as HTMLSelectElement).value = String(d.value!.soundAssetId ?? '');
  sndIn.value?.click();
}
async function uploadSound(): Promise<void> {
  const f = sndIn.value?.files?.[0];
  if (sndIn.value) sndIn.value.value = '';
  if (!f) return;
  const r = await attempt(() => upload<{ sound: SoundDto }>('/api/sounds', f), `已添加音效：${f.name}`);
  if (!r) return;
  await refreshEffects();
  d.value!.soundAssetId = r.sound.id;
}
let audio: HTMLAudioElement | null = null;
function playSound(): void {
  const s = state.sounds.find((x) => x.id === d.value?.soundAssetId);
  if (!s) return toast('当前没有选择音效', 'info');
  audio?.pause();
  audio = new Audio(s.url);
  audio.volume = (d.value?.volume ?? 70) / 100;
  void audio.play().catch(() => undefined);
}

const a = computed<AssetDto | null>(() => eff.value?.asset ?? null);
/** 视频、SVGA、Lottie、动图有自己的时长 */
const timed = computed(() => Boolean(a.value?.durationMs));
/** 时长上限：30 秒，有时长的素材不超过素材本身 */
const maxSeconds = computed(() => (a.value?.durationMs ? Math.min(30, Math.floor(a.value.durationMs / 100) / 10) : 30));
watch(
  () => d.value?.durationCustom,
  (on) => {
    if (on && d.value && d.value.seconds > maxSeconds.value) d.value.seconds = maxSeconds.value;
  },
);
const meta = computed(() => (a.value ? `${a.value.ext.toUpperCase()}${a.value.width ? ` · ${a.value.width}×${a.value.height}` : ''} · ${seconds(a.value.durationMs)} · ${fileSize(a.value.size)}` : ''));
const o = computed(() => output());

// 上下羽化：跟随全局时只对没有透明通道的素材生效
const globalFeather = computed(() => (a.value && !a.value.hasAlpha && state.settings?.featherOn ? state.settings.featherPct : 0));
const featherOptions = computed<Array<{ value: FeatherMode; label: string }>>(() => [
  { value: 'global', label: `跟随全局 · ${globalFeather.value ? `${globalFeather.value}%` : '不羽化'}` },
  { value: 'custom', label: '自己设置' },
  { value: 'off', label: '不羽化' },
]);
/** 现在实际用的羽化宽度 */
const featherNow = computed(() => {
  const v = d.value;
  if (!v || !a.value || v.feather === 'off') return 0;
  return v.feather === 'custom' ? Math.min(FEATHER_MAX, Math.max(0, Math.round(v.featherPct || 0))) : globalFeather.value;
});
const featherHint = computed(() => {
  if (d.value?.feather === 'custom') return '按素材高度算，0% 就是不羽化';
  if (d.value?.feather === 'off') return '这个素材的边缘不虚化';
  if (a.value?.hasAlpha) return '这个素材有透明通道，跟随全局时不羽化；需要的话选「自己设置」';
  return state.settings?.featherOn ? '全局设置在「设置 → 素材显示」里改' : '全局没有打开，可以在「设置 → 素材显示」里统一打开';
});
// 正在播放时直接改，不重新播放
watch(featherNow, (p) => {
  if (stage.value?.feather(p)) return;
  if (offTimer) clearTimeout(offTimer);
  offTimer = setTimeout(replay, 600);
});
function close(): void {
  audio?.pause();
  if (dirty.value && !confirmLeave.value) {
    confirmLeave.value = true;
    return toast('有修改还没保存，再点一次关闭会放弃修改', 'info');
  }
  emit('close');
}
const confirmLeave = ref(false);
const confirmCopy = ref(false);
// 有没保存的修改时，刷新或关闭浏览器标签页前提醒
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value) e.preventDefault();
};
addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  removeEventListener('beforeunload', beforeUnload);
  // 不管怎么关掉的（保存、切换、复制），试听的音效都停掉
  audio?.pause();
  audio = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="close" />
    <div v-if="eff && d" class="editor" role="dialog" aria-label="素材设置">
      <div class="ed-h">
        <label class="ed-name" :title="ro ? '' : '点击改名，保存后生效'">
          <input v-model="d.name" aria-label="素材名称" :disabled="ro" maxlength="40" />
          <Icon v-if="!ro" name="i-pen" />
        </label>
        <span v-if="ro" class="badge">内置</span>
        <button class="icon-btn" aria-label="关闭" @click="close"><Icon name="i-x" /></button>
      </div>
      <div class="ed-b">
        <div class="ed-prev">
          <PreviewStage ref="stage" :label="o ? `预览 · ${o.width}×${o.height}` : '预览'">
            <div v-if="a && !ro" class="drag-layer" :class="{ grab: overMedia, grabbing: dragging }" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="overMedia = false" />
          </PreviewStage>
          <div class="tools">
            <button class="btn" @click="replay"><Icon name="i-replay" />重播（带声音）</button>
            <ConfirmButton label="发送到直播测试" confirm-label="确认？观众会看到" cls="btn live-send" armed-cls="btn live-send" :disabled="dirty" :title="dirty ? '先保存再发送到直播' : ''" @confirm="attempt(() => post('/api/playback/test', { effectId: eff!.id }), '已发送到直播画面')" />
          </div>
          <span v-if="a && !ro" class="hint" style="font-size: 12px; color: var(--t3)">在预览里按住素材可以直接拖到想要的位置</span>
          <span class="hint" style="font-size: 12px; color: var(--t3)">示例观众：{{ sample.name }}{{ dirty ? ' · 预览的是还没保存的修改' : '' }}</span>
        </div>
        <div class="ed-set" :class="{ readonly: ro }">
          <div v-if="ro" class="ro-banner" style="pointer-events: auto; opacity: 1"><Icon name="i-lock" />内置素材不能直接修改。点右下角「复制并编辑」，就能在副本上自由调整。</div>

          <div class="ed-sec">
            <h3><span class="n">1</span>画面</h3>
            <template v-if="a">
              <div class="filecard">
                <span class="vt" :class="{ alpha: a.hasAlpha }">
                  <video v-if="a.kind === 'video'" :src="a.url" muted loop autoplay playsinline />
                  <img v-else-if="a.kind === 'image'" :src="a.url" alt="" />
                  <span v-else class="thumb-icon" style="position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, 0.6); font-size: 11px">{{ a.ext.toUpperCase() }}</span>
                </span>
                <span><b>{{ a.filename }}</b><span>{{ meta }}</span></span>
                <button class="btn" :disabled="busy" @click="repIn?.click()"><Icon name="i-replay" />替换文件</button>
              </div>
              <input ref="repIn" type="file" hidden accept=".webm,.mp4,.svga,.json,.gif,.png,.apng,.webp,.jpg,.jpeg" @change="replaceFile" />
              <div class="toggle-line fe-line">上下羽化 <Seg v-model="d.feather" label="上下羽化" :options="featherOptions" /></div>
              <div v-if="d.feather === 'custom'" class="slider-row off"><label for="edFe">羽化宽度</label><input id="edFe" v-model.number="d.featherPct" type="range" min="0" :max="FEATHER_MAX" step="1" /><output>{{ d.featherPct }}%</output></div>
              <span class="hint" style="font-size: 12px; color: var(--t3)">{{ featherHint }}</span>
              <div v-if="a.warnings.includes('no_alpha')" class="warnbox">这个文件没有透明通道，在直播软件里会带背景色，挡住直播画面。建议导出成带透明通道的 WebM（VP9）。</div>
              <div v-if="a.warnings.includes('large')" class="warnbox">文件超过 10 MB，首次加载可能会慢一点，建议压缩。</div>
            </template>
            <div v-else class="filecard">
              <span class="vt" :style="{ background: STYLES[eff.visual.type === 'builtin_style' ? eff.visual.style : 'line']?.grad }" />
              <span><b>内置样式 · {{ STYLES[eff.visual.type === 'builtin_style' ? eff.visual.style : 'line']?.name }}</b><span>由特效页绘制，自带头像和欢迎语</span></span>
            </div>
          </div>

          <div class="ed-sec">
            <h3><span class="n">2</span>头像和欢迎语</h3>
            <div v-if="a" class="toggle-line">在素材上叠加头像和欢迎语 <span class="hint">素材里已经画好文字的话可以关掉</span><Switch v-model="d.showText" label="叠加头像和欢迎语" /></div>
            <div v-if="a && d.showText" class="toggle-line">大航海头像框 <span class="hint">舰长、提督、总督的头像套上 B 站的头像框</span><Switch v-model="d.guardFrame" label="大航海头像框" /></div>
            <template v-if="!a || d.showText">
              <span class="hint" style="font-size: 12px; color: var(--t3)">每行一句，随机选一句；不同事件可以写不同的话，没写的用「通用」</span>
              <Seg v-model="txTab" label="欢迎语事件" :options="TEXT_TABS.map((t) => ({ value: t.value, label: t.label + (t.value !== 'enter' && lines(d!.texts[t.value]).length ? ' ·' : '') }))" />
              <textarea ref="ta" v-model="d.texts[txTab]" class="ta" :placeholder="txTab === 'enter' ? '例如：欢迎 {name} 大驾光临' : '留空就用「通用」那几句'" />
              <div class="vars"><button v-for="v in VARS" :key="v" type="button" @click="insertVar(v)">{{ v }}</button></div>
              <span class="hint" style="font-size: 12px; color: var(--t3)">通用：昵称 {name}、大航海 {guard}、牌子 {medal}、等级 {level}　弹幕：{text}　礼物：{gift} {count} {value}　上舰：月数 {months}、开通 / 续费 {op}、上舰 / 续费 {act}</span>
            </template>
          </div>

          <div class="ed-sec">
            <h3><span class="n">3</span>音效 <span class="hint">音效在素材库的「音效」里管理，可以被多个素材共用</span></h3>
            <div class="snd">
              <select class="sel" :value="d.soundAssetId ?? ''" aria-label="音效" @change="onSound">
                <option value="">无音效</option>
                <option v-for="s in state.sounds" :key="s.id" :value="s.id">{{ s.filename.replace(/\.[^.]+$/, '') }}　{{ seconds(s.durationMs) }}</option>
                <option value="__up">＋ 上传新音效…</option>
              </select>
              <button class="playmini" aria-label="试听音效" style="width: 36px; height: 36px" @click="playSound"><svg><use href="#i-play" /></svg></button>
            </div>
            <input ref="sndIn" type="file" hidden accept=".mp3,.wav,.ogg" @change="uploadSound" />
            <div class="slider-row"><label for="edVol">音量</label><input id="edVol" v-model.number="d.volume" type="range" min="0" max="100" /><output>{{ d.volume }}%</output></div>
          </div>

          <div class="ed-sec">
            <h3><span class="n">4</span>位置与时长</h3>
            <div class="row2">
              <Seg v-model="d.position" label="位置" :options="positionOptions" />
              <span v-if="timed && !d.durationCustom" class="hint" style="font-size: 13px; color: var(--t2)" title="按素材本身的时长完整播放">时长跟随素材 · {{ ((a?.durationMs ?? 0) / 1000).toFixed(1) }} 秒</span>
              <div v-else class="suffix"><input v-model.number="d.seconds" class="inp num" type="number" min="0.5" :max="maxSeconds" step="0.1" aria-label="时长" /><span>秒</span></div>
            </div>
            <template v-if="a">
              <div class="slider-row off"><label for="edOffY">上下挪动</label><input id="edOffY" v-model.number="d.offsetY" type="range" :min="-OFFSET_MAX" :max="OFFSET_MAX" step="0.5" /><output>{{ offText(d.offsetY, '往上', '往下') }}</output></div>
              <div class="slider-row off"><label for="edOffX">左右挪动</label><input id="edOffX" v-model.number="d.offsetX" type="range" :min="-OFFSET_MAX" :max="OFFSET_MAX" step="0.5" /><output>{{ offText(d.offsetX, '往左', '往右') }}</output></div>
              <div class="slider-row off"><label for="edSize">大小</label><input id="edSize" v-model.number="d.sizePct" type="range" :min="SIZE_MIN" :max="SIZE_MAX" step="1" /><output>{{ clampSize(d.sizePct) }}%</output></div>
              <div class="toggle-line">
                <span class="hint">在「{{ POSITION_NAMES[d.position] }}」的基础上挪，按画面宽、高的百分比算；大小 100% 是自动算出的大小</span>
                <button class="btn" type="button" style="margin-left: auto; flex: none" :disabled="!adjusted" @click="resetOffset">回到原位</button>
              </div>
              <div v-if="adjusted && intoSafe" class="warnbox">素材有一部分盖住了{{ intoSafe }}，直播时可能挡住 B 站的信息、弹幕，或者被挡住。</div>
              <div v-if="adjusted && outOfStage" class="warnbox">素材有一部分超出了画面，超出的部分直播时看不到。</div>
              <div v-if="timed" class="toggle-line">手动设置时长 <span class="hint">{{ d.durationCustom ? `最长 ${maxSeconds} 秒，到时间就结束` : '关着时按素材完整播放' }}</span><Switch v-model="d.durationCustom" label="手动设置时长" /></div>
              <div class="toggle-line">
                开头渐入 <span class="hint">{{ d.fadeIn ? '用多少秒慢慢出现' : '关掉后第一帧直接出现' }}</span>
                <span class="ctl"><span v-if="d.fadeIn" class="suffix"><input v-model.number="d.fadeInS" class="inp num" type="number" min="0.1" max="5" step="0.1" aria-label="渐入秒数" /><span>秒</span></span><Switch v-model="d.fadeIn" label="开头渐入" /></span>
              </div>
              <div class="toggle-line">
                结尾渐出 <span class="hint">{{ d.fadeOut ? '用多少秒慢慢消失' : '关掉后播完直接消失' }}</span>
                <span class="ctl"><span v-if="d.fadeOut" class="suffix"><input v-model.number="d.fadeOutS" class="inp num" type="number" min="0.1" max="5" step="0.1" aria-label="渐出秒数" /><span>秒</span></span><Switch v-model="d.fadeOut" label="结尾渐出" /></span>
              </div>
            </template>
            <span v-if="o?.orient === 'portrait' && !(a && adjusted)" class="hint" style="font-size: 12px; color: var(--t3)">竖屏下会自动避开顶部信息栏和底部弹幕区</span>
          </div>
        </div>
      </div>
      <div class="ed-f">
        <span class="use">
          <label v-if="ro && eff.usedBy.length" style="display: inline-flex; align-items: center; gap: 8px; color: var(--t1); cursor: pointer">
            <input v-model="replaceRefs" type="checkbox" style="accent-color: var(--accent); width: 15px; height: 15px" />复制后，把 <b>{{ eff.usedBy.map((u) => u.label).join('、') }}</b> 用的「{{ eff.name }}」换成副本
          </label>
          <template v-else-if="eff.usedBy.length">用于 <b>{{ eff.usedBy.map((u) => u.label).join('、') }}</b>，保存后同步生效</template>
          <template v-else>还没有规则使用这个素材</template>
        </span>
        <template v-if="!ro">
          <ConfirmButton label="删除" cls="btn" style="color: #d64545" @confirm="remove" />
          <button class="btn" @click="copy"><Icon name="i-dup" />复制</button>
          <button class="btn" @click="close">取消</button>
          <button class="btn primary" :disabled="busy" @click="save">保存</button>
        </template>
        <button v-else class="btn primary" @click="copy">复制并编辑</button>
      </div>
    </div>
  </Teleport>
</template>
