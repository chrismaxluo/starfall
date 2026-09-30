<script setup lang="ts">
// 预览：在 iframe 里运行真正的特效页（预览模式），和直播画面上看到的完全一样；只在本地播放，不上直播
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { POSITIONS } from '@starfall/shared';
import type { OverlayConfig, Position } from '@starfall/shared';
import { post } from '../lib/api.ts';
import { scaleRect } from '../lib/place.ts';
import type { Rect } from '../lib/place.ts';
import type { SampleViewer } from '../lib/identity.ts';
import { output, overlayConfigOf } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import type { EffectDto, TriggerKind } from '../lib/types.ts';

const props = withDefaults(defineProps<{ label?: string; safe?: boolean; cls?: string; alpha?: boolean; config?: OverlayConfig | null }>(), { label: '', safe: true, cls: 'pstage', alpha: false, config: null });
const frame = ref<HTMLIFrameElement | null>(null);
let ready = false;
let pending: unknown = null;

const cfg = computed<OverlayConfig | null>(() => {
  if (props.config) return props.config;
  const o = output();
  return o ? overlayConfigOf(o) : null;
});
const src = computed(() => `/overlay/?preview=1${props.safe ? '&debug=1' : ''}`);

function send(msg: unknown): void {
  frame.value?.contentWindow?.postMessage(msg, location.origin);
}

function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || e.source !== frame.value?.contentWindow) return;
  if ((e.data as { type?: string })?.type !== 'starfall-preview-ready') return;
  ready = true;
  if (cfg.value) send({ type: 'config', config: cfg.value });
  if (pending) send(pending);
  pending = null;
}

watch(cfg, (c) => c && ready && send({ type: 'config', config: c }), { deep: true });
watch(src, () => (ready = false));
onMounted(() => addEventListener('message', onMessage));
onBeforeUnmount(() => removeEventListener('message', onMessage));

/** 播放一个素材（draft：还没保存的修改） */
async function play(effect: EffectDto | number, viewer?: SampleViewer, draft?: object, kind: TriggerKind = 'enter', vars?: object): Promise<void> {
  try {
    const item = await post('/api/preview', { effectId: typeof effect === 'number' ? effect : effect.id, kind, ...(viewer ? { viewer } : {}), ...(draft ? { draft } : {}), ...(vars ? { vars } : {}) });
    const msg = { type: 'play', item };
    if (ready) send(msg);
    else pending = msg;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
  }
}

function stop(): void {
  send({ type: 'stop' });
}

/**
 * 画面和正在播放的上传素材在页面上的位置（没在播放时 media 为 null）。
 * base 是素材不挪动、100% 大小时的位置，用来比较调整前后。
 */
function geom(): { stage: Rect; media: Rect | null; base: Rect | null; pos: Position } | null {
  const f = frame.value;
  const doc = f?.contentDocument;
  const st = doc?.getElementById('stage');
  if (!f || !doc || !st) return null;
  const fr = f.getBoundingClientRect();
  const k = f.clientWidth ? fr.width / f.clientWidth : 1;
  const map = (r: DOMRect): Rect => ({ x: fr.left + r.left * k, y: fr.top + r.top * k, w: r.width * k, h: r.height * k });
  const stage = map(st.getBoundingClientRect());
  const m = doc.querySelector<HTMLElement>('.slot:not(.warm) .fx-asset > .media');
  const slot = m?.closest<HTMLElement>('.slot');
  const pos = (POSITIONS.find((p) => slot?.classList.contains(`pos-${p}`)) ?? 'center') as Position;
  if (!m || !slot) return { stage, media: null, base: null, pos };
  const media = map(m.getBoundingClientRect());
  // 挪动写在 .slot 的 translate 上（画布像素），大小写在 .media 的 data-k 上
  const [tx = 0, ty = 0] = slot.style.translate.split(' ').map((x) => parseFloat(x) || 0);
  const s = st.offsetWidth ? stage.w / st.offsetWidth : 1;
  const unmoved = { ...media, x: media.x - tx * s, y: media.y - ty * s };
  return { stage, media, base: scaleRect(unmoved, 1 / (Number(m.dataset.k) || 1), pos), pos };
}

/** 把正在播放的上传素材挪到新位置、改成新大小（不重新播放）；没在播放时返回 false */
function nudge(x: number, y: number, size: number): boolean {
  if (!ready || !geom()?.media) return false;
  send({ type: 'nudge', x, y, size });
  return true;
}

/** 改正在播放的上传素材的上下羽化（不重新播放）；没在播放时返回 false */
function feather(pct: number): boolean {
  if (!ready || !geom()?.media) return false;
  send({ type: 'feather', pct });
  return true;
}

/** 拖动时让素材一直显示 */
function hold(): void {
  send({ type: 'hold' });
}

defineExpose({ play, stop, geom, nudge, hold, feather });
</script>

<template>
  <div :class="[cls, { alpha }]" style="position: relative">
    <iframe ref="frame" :src="src" title="特效预览" class="prev-frame" allow="autoplay" />
    <span v-if="label" class="stage-label">{{ label }}</span>
    <slot />
  </div>
</template>
