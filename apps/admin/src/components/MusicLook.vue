<script setup lang="ts">
// 点歌 · 画面：预览（在 iframe 里运行真正的点歌窗口，不出声）、样子、对齐、字号、接下来几首、歌词；声音（音量、特效时调小）；点歌窗口地址
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MUSIC_HEIGHT, MUSIC_WIDTH } from '@starfall/shared/overlay';
import type { MusicSettings } from '@starfall/shared';
import type { MusicState } from '@starfall/shared/overlay';
import Icon from './Icon.vue';
import Switch from './Switch.vue';
import { music, saveMusic } from '../lib/music.ts';
import { state } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';

const s = computed(() => music.settings!);
const set = (patch: Partial<MusicSettings>, msg?: string) => void saveMusic(patch, msg);

// ---------- 预览 ----------
const frame = ref<HTMLIFrameElement | null>(null);
const K = 0.62;
let ready = false;
/** 有歌在放时预览真实的，没有时用示例 */
const SAMPLE: Omit<MusicState, 'display' | 'cmd' | 'volume' | 'enabled'> = {
  hold: null,
  now: {
    item: { id: -1, song: { source: 'local', id: '0', name: '示例歌曲', artists: '星临乐队', durationMs: 215_000 }, by: { uid: 0, name: '测试观众', guard: 3 }, at: 0 },
    posMs: 52_000,
    paused: false,
    lyric: [
      { t: 0, text: '这是一句示例歌词', tr: 'This is a sample lyric' },
      { t: 48_000, text: '真的点歌时显示歌的歌词', tr: 'Real songs show their own lyrics' },
      { t: 60_000, text: '下一句' },
    ],
    load: 1,
  },
  queue: [
    { id: -2, song: { source: 'local', id: '1', name: '第二首歌', artists: '某位歌手', durationMs: 200_000 }, by: { uid: 0, name: '夜猫子', guard: 0 }, at: 0 },
    { id: -3, song: { source: 'local', id: '2', name: '第三首歌', artists: '另一位歌手', durationMs: 200_000 }, by: { uid: 0, name: '路过的猫', guard: 0 }, at: 0 },
    { id: -4, song: { source: 'local', id: '3', name: '第四首歌', artists: '歌手', durationMs: 200_000 }, by: { uid: 0, name: '小星', guard: 0 }, at: 0 },
  ],
  total: 4,
};
const sample = ref(false);
const pvState = computed((): MusicState | null => {
  const st = music.state;
  if (!st || !music.settings) return null;
  const display = { style: s.value.style, side: s.value.side, size: s.value.size, showQueue: s.value.showQueue, lyrics: s.value.lyrics, lyricsTrans: s.value.lyricsTrans };
  const base = { enabled: true, cmd: s.value.cmdRequest, volume: s.value.volume, display };
  return sample.value || !st.now ? { ...SAMPLE, ...base } : { ...st, ...base, hold: null };
});
function send(): void {
  if (ready && pvState.value) frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify({ type: 'music', state: pvState.value, player: false })), location.origin);
}
function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || e.source !== frame.value?.contentWindow) return;
  if ((e.data as { type?: string })?.type !== 'starfall-preview-ready') return;
  ready = true;
  send();
}
watch(pvState, send, { deep: true });
onMounted(() => addEventListener('message', onMessage));
onBeforeUnmount(() => removeEventListener('message', onMessage));
function testNotice(): void {
  if (!ready) return;
  frame.value?.contentWindow?.postMessage({ type: 'music_notice', notice: { id: `t${Date.now()}`, ok: true, who: '测试观众', text: '点了《示例歌曲》，排在第 2 首', ts: Date.now() } }, location.origin);
}

/** 常规三种在前，风格样式在后 */
const STYLE_GROUPS = [
  {
    name: '常规',
    list: [
      { value: 'card', label: '玻璃卡片', desc: '封面、歌名和点歌人，衬一圈封面颜色的柔光' },
      { value: 'vinyl', label: '黑胶唱片', desc: '封面印在转动的唱片上，暂停时唱臂抬起' },
      { value: 'capsule', label: '细长胶囊', desc: '一行显示，占地方最少' },
    ],
  },
  {
    name: '风格',
    list: [
      { value: 'glass', label: '流光', desc: '封面的颜色铺满整张卡片，像音乐 App 的播放页' },
      { value: 'journal', label: '手帐', desc: '日系手帐：方格纸、和纸胶带、拍立得、手写字' },
      { value: 'minimal', label: '灵动岛', desc: '玻璃小胶囊，换歌、有人点歌时弹性展开' },
    ],
  },
] as const;

// ---------- 声音 ----------
const vol = ref<number | null>(null);
const volShown = computed(() => vol.value ?? s.value.volume);
async function saveVol(): Promise<void> {
  if (vol.value === null) return;
  await saveMusic({ volume: vol.value });
  vol.value = null;
}

// ---------- 地址 ----------
async function copy(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${location.origin}${path}`);
    toast(`已复制：在直播软件里加一个浏览器源，宽高填 ${MUSIC_WIDTH} × ${MUSIC_HEIGHT}`);
  } catch {
    toast('浏览器不允许自动复制，请到「直播软件输出」页手动复制', 'info');
  }
}
const online = (id: number) => state.overlays.filter((x) => x.outputId === id && x.role === 'music' && !x.view).length;
</script>

<template>
  <div v-if="music.settings" class="ml-grid">
    <div class="card">
      <div class="card-h"><h2>预览</h2><span class="aside">只在这里显示，不出声</span></div>
      <div class="ml-pv" :style="{ width: `${MUSIC_WIDTH * K}px`, height: `${MUSIC_HEIGHT * K}px` }">
        <iframe ref="frame" src="/overlay/?music=1&preview=1" title="点歌窗口预览" :style="{ width: `${MUSIC_WIDTH}px`, height: `${MUSIC_HEIGHT}px`, transform: `scale(${K})` }" />
      </div>
      <div class="ml-pvt">
        <label class="ml-ck"><input v-model="sample" type="checkbox" :disabled="!music.state?.now" />用示例歌预览</label>
        <button class="btn" @click="testNotice">测试一条点歌提示</button>
      </div>
      <p class="inline-hint">{{ music.state?.now && !sample ? '正在显示真实在放的歌。' : '现在没歌在放，显示的是示例。' }}画面上没歌时会显示「发送弹幕 {{ s.cmdRequest }} 歌名 点歌」的提示。</p>
    </div>

    <div class="ml-col">
      <div class="card">
        <div class="card-h"><h2>外观</h2><span class="aside">改了马上生效</span></div>
        <template v-for="g in STYLE_GROUPS" :key="g.name">
          <h3 class="ml-grp">{{ g.name }}</h3>
          <div class="ml-styles" role="radiogroup" :aria-label="`${g.name}样子`">
            <button v-for="x in g.list" :key="x.value" type="button" class="ml-style" role="radio" :aria-checked="s.style === x.value" @click="set({ style: x.value }, `换成「${x.label}」`)">
              <span class="ml-ill" :class="x.value"><i /><b /><b /></span>
              <b>{{ x.label }}</b><span>{{ x.desc }}</span>
            </button>
          </div>
        </template>
        <div class="srows">
          <div class="srow">
            <span class="lb">对齐</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="对齐">
                <button :aria-pressed="s.side === 'left'" @click="set({ side: 'left' })">靠左</button>
                <button :aria-pressed="s.side === 'right'" @click="set({ side: 'right' })">靠右</button>
              </span>
              <span class="hint">放在画面哪边就选哪边</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">字号</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="字号">
                <button :aria-pressed="s.size === 'normal'" @click="set({ size: 'normal' })">标准</button>
                <button :aria-pressed="s.size === 'large'" @click="set({ size: 'large' })">大</button>
              </span>
              <span class="hint">{{ s.size === 'large' ? `浏览器源宽高建议 ${Math.round(MUSIC_WIDTH * 1.25)} × ${Math.round(MUSIC_HEIGHT * 1.25)}` : '' }}</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">接下来</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="显示接下来几首">
                <button v-for="n in [0, 1, 2, 3, 4, 5]" :key="n" :aria-pressed="s.showQueue === n" @click="set({ showQueue: n })">{{ n === 0 ? '不显示' : n }}</button>
              </span>
              <span class="hint">显示后面几首</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">歌词</span>
            <div class="ctl"><div class="line">
              <Switch :model-value="s.lyrics" label="显示歌词" @change="(v) => set({ lyrics: v })" /><span>滚动歌词</span>
              <span class="gap" />
              <Switch :model-value="s.lyricsTrans" :disabled="!s.lyrics" label="显示翻译" @change="(v) => set({ lyricsTrans: v })" /><span>外文歌显示中文翻译</span>
            </div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>声音</h2></div>
        <div class="srows">
          <div class="srow">
            <span class="lb">音量</span>
            <div class="ctl"><div class="line">
              <input class="ml-range" type="range" min="0" max="100" step="5" :value="volShown" aria-label="音量" @input="(e) => (vol = Number((e.target as HTMLInputElement).value))" @change="saveVol" /><span class="num">{{ volShown }}</span>
              <span class="hint">直播软件的混音器里也能单独调</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">特效时调小</span>
            <div class="ctl"><div class="line">
              <Switch :model-value="s.duck" label="特效时调小音乐" @change="(v) => set({ duck: v }, v ? '有带声音的特效时，音乐自动调小' : '特效时音乐不调小')" />
              <select class="sel" aria-label="调小到多少" :disabled="!s.duck" :value="s.duckPct" @change="set({ duckPct: Number(($event.target as HTMLSelectElement).value) })"><option v-for="p in [10, 20, 30, 40, 50, 60]" :key="p" :value="p">调到 {{ p }}%</option></select>
              <span class="hint">有带声音的特效在播时，音乐变小，播完慢慢恢复</span>
            </div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>点歌窗口地址</h2><span class="aside">宽高填 {{ MUSIC_WIDTH }} × {{ MUSIC_HEIGHT }}</span></div>
        <div v-for="o in state.outputs" :key="o.id" class="ml-url">
          <span class="ml-on" :class="{ on: online(o.id) }"><i />{{ o.name }} · {{ online(o.id) ? '已加上' : '还没加' }}</span>
          <button class="btn sm primary" @click="copy(o.musicPath)"><Icon name="i-copy" />复制地址</button>
          <a class="linkish" :href="`${o.musicPath}&view=1`" target="_blank" rel="noopener" title="深色背景，只用来查看，不出声；直播软件里请用复制的地址">在浏览器里查看</a>
        </div>
        <p class="inline-hint">在直播姬或 OBS 里加一个浏览器源，粘贴地址，拖到画面一侧。加了好几个也只有一个出声音。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ml-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: start; }
.ml-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1100px) { .ml-grid { grid-template-columns: 1fr; } }
.ml-pv { position: relative; overflow: hidden; border-radius: 12px; background: radial-gradient(60% 40% at 30% 30%, rgba(255, 170, 90, .4), transparent 70%), radial-gradient(60% 40% at 80% 80%, rgba(90, 160, 255, .38), transparent 70%), linear-gradient(170deg, #1a1b2e, #0c0d16); }
.ml-pv iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: transparent; }
.ml-pvt { display: flex; align-items: center; gap: 12px; margin: 12px 0 6px; }
.ml-ck { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--t2); }
.ml-grp { margin: 2px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .08em; color: var(--t3); }
.ml-styles + .ml-grp { margin-top: 14px; }
.ml-styles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 6px; }
@media (max-width: 1300px) { .ml-styles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ml-style { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--l2); color: var(--t1); font: inherit; text-align: left; cursor: pointer; }
.ml-style:hover { border-color: var(--line-strong); }
.ml-style[aria-checked='true'] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-ring); }
.ml-style > b { font-size: 13.5px; font-weight: 600; }
.ml-style > span:last-child { font-size: 12px; color: var(--t2); line-height: 1.5; }
/* 样子的小示意图 */
.ml-ill { position: relative; display: flex; align-items: center; gap: 6px; width: 100%; height: 44px; margin-bottom: 4px; padding: 0 8px; border-radius: 10px; overflow: hidden; background: linear-gradient(135deg, #2a2b45, #16172a); }
.ml-ill i { flex: none; width: 28px; height: 28px; border-radius: 7px; background: linear-gradient(135deg, #8d8bff, #e07ab5); }
.ml-ill b { height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .75); width: 38%; }
.ml-ill b + b { width: 20%; background: rgba(255, 255, 255, .35); }
.ml-ill em { display: none; }
.ml-ill.glass { background: radial-gradient(60% 120% at 20% 50%, rgba(224, 122, 181, .7), transparent), radial-gradient(60% 120% at 80% 50%, rgba(141, 139, 255, .6), transparent), #1d1c33; }
.ml-ill.journal { background: radial-gradient(circle at 1px 1px, rgba(120, 110, 90, .3) 1px, transparent 1.5px) 0 0 / 8px 8px, #fffdf6; box-shadow: inset 0 0 0 1px rgba(120, 100, 70, .15); }
.ml-ill.journal i { border-radius: 1px; background: linear-gradient(135deg, #8d8bff, #e07ab5) content-box, #fff; padding: 3px 3px 7px; width: 26px; height: 32px; transform: rotate(-6deg); box-shadow: 0 2px 4px rgba(60, 40, 20, .3); }
.ml-ill.journal b { background: linear-gradient(transparent 0 0), #34312c; box-shadow: 0 3px 0 rgba(141, 139, 255, .45); }
.ml-ill.journal b + b { background: #b3a98f; box-shadow: none; }
.ml-ill.card { background: radial-gradient(60% 120% at 15% 50%, rgba(141, 139, 255, .55), transparent), linear-gradient(135deg, #2a2b45, #16172a); }
.ml-ill.vinyl i { border-radius: 50%; background: radial-gradient(circle, #e07ab5 0 28%, #111 30% 100%); box-shadow: 0 0 0 1px rgba(255, 255, 255, .15); }
.ml-ill.capsule { height: 28px; margin: 6px 0 10px; border-radius: 999px; }
.ml-ill.capsule i { width: 18px; height: 18px; border-radius: 50%; }
.ml-ill.minimal { justify-content: center; background: linear-gradient(135deg, #3a3b5a, #20213a); }
.ml-ill.minimal i { width: 16px; height: 16px; border-radius: 50%; position: relative; z-index: 1; }
.ml-ill.minimal b { position: relative; z-index: 1; width: 30%; }
.ml-ill.minimal b + b { display: none; }
.ml-ill.minimal { background: linear-gradient(135deg, #6f86c8, #c98bb5 60%, #e9b48c); }
.ml-ill.minimal::before { content: ""; position: absolute; left: 18%; right: 18%; top: 12px; bottom: 12px; border-radius: 999px; background: linear-gradient(180deg, rgba(255, 255, 255, .35), rgba(255, 255, 255, .12)), rgba(20, 20, 30, .25); box-shadow: inset 0 1px 1px rgba(255, 255, 255, .7), inset 0 0 0 1px rgba(255, 255, 255, .35); }
.srow .line .gap { width: 12px; }
.srow .line > span:not(.seg):not(.hint):not(.gap) { font-size: 13px; color: var(--t2); }
.ml-range { width: 180px; accent-color: var(--accent); }
.ml-url { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13px; }
.ml-url + .ml-url { border-top: 1px solid var(--line); }
.ml-url .btn.sm { height: 28px; padding: 0 10px; font-size: 12.5px; margin-left: auto; }
.ml-on { display: inline-flex; align-items: center; gap: 8px; color: var(--t2); }
.ml-on i { width: 7px; height: 7px; border-radius: 50%; background: var(--t3); }
.ml-on.on i { background: var(--ok); }
</style>
