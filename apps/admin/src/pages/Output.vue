<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ChatPreview from '../components/ChatPreview.vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import PreviewStage from '../components/PreviewStage.vue';
import { del, post, put } from '../lib/api.ts';
import { CHAT_MAX_LIMIT, CHAT_WIDTH, chatHeight } from '@starfall/shared/overlay';
import { clock, gcd } from '../lib/format.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { isFxLive, isFxView, overlayConfigOf, refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto, OverlayConfig, OverlayInfo } from '../lib/types.ts';

// 多个输出（F-OU-05）：记住上次选中的输出
const SEL_KEY = 'sf.output';
const readSel = () => {
  try {
    return Number(localStorage.getItem(SEL_KEY)) || 0;
  } catch {
    return 0;
  }
};
const selId = ref(readSel());
watch(selId, (id) => {
  try {
    localStorage.setItem(SEL_KEY, String(id));
  } catch {
    /* 隐私模式下不记住 */
  }
});
const o = computed(() => state.outputs.find((x) => x.id === selId.value) ?? state.outputs[0]);
const online = (id: number) => state.overlays.some((x) => x.outputId === id && isFxLive(x));
const cfg = computed<OverlayConfig | null>(() => {
  const x = o.value;
  return x ? overlayConfigOf(x) : null;
});

async function addOutput(): Promise<void> {
  // 还没有横屏输出时，新建的默认就是「横屏录播」
  const land = !state.outputs.some((x) => x.orient === 'landscape');
  const body = land
    ? { name: '横屏录播', app: 'obs', orient: 'landscape', width: 1920, height: 1080, safeTop: 0, safeBottom: 0, marginX: 3 }
    : { name: `输出 ${state.outputs.length + 1}` };
  const r = await attempt(() => post<OutputDto>('/api/outputs', body), `已新建输出：${body.name}，把它的地址加到对应的直播软件里`);
  if (!r) return;
  state.outputs.push(r);
  selId.value = r.id;
}
const renaming = ref(false);
async function rename(e: Event): Promise<void> {
  renaming.value = false;
  const el = e.target as HTMLInputElement;
  const name = el.value.trim();
  if (!name) {
    el.value = o.value?.name ?? '';
    return toast('名称不能为空', 'err');
  }
  if (name !== o.value?.name) await save({ name }, '已改名');
}
async function removeOutput(): Promise<void> {
  const x = o.value;
  if (!x) return;
  if (await attempt(() => del(`/api/outputs/${x.id}`), `已删除输出「${x.name}」，它的地址已失效`)) {
    state.outputs = state.outputs.filter((y) => y.id !== x.id);
    selId.value = state.outputs[0]?.id ?? 0;
  }
}
const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
const chatPv = ref<InstanceType<typeof ChatPreview> | null>(null);
const showSafe = ref(true);
const showKey = ref(false);
const showChatKey = ref(false);
const alphaBg = ref(false);

// 右侧预览：特效页 / 弹幕列表（记住上次看的）
const TAB_KEY = 'sf-out-tab';
const readTab = (): 'fx' | 'chat' => {
  try {
    return localStorage.getItem(TAB_KEY) === 'chat' ? 'chat' : 'fx';
  } catch {
    return 'fx';
  }
};
const ptab = ref<'fx' | 'chat'>(readTab());
watch(ptab, (t) => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* 隐私模式下不记住 */
  }
});

const PRESETS = {
  portrait: [[1080, 1920, '推荐'], [720, 1280, '省性能'], [1440, 2560, '2K']],
  landscape: [[1920, 1080, '推荐'], [1280, 720, '省性能'], [2560, 1440, '2K']],
} as const;

// 请求返回前可能已经切到另一个输出：结果写回发请求时的那一个
async function save(patch: Partial<OutputDto>, msg?: string): Promise<void> {
  const target = o.value;
  if (!target) return;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${target.id}`, patch), msg);
  if (r) Object.assign(target, r);
  else await refreshOutputs();
}
function setOrient(orient: 'portrait' | 'landscape'): void {
  if (!o.value || o.value.orient === orient) return;
  const [w, h] = PRESETS[orient][0];
  // 横屏没有手机端的信息栏和弹幕区，安全区清零；左右边距也小一些
  void save(orient === 'portrait' ? { orient, width: w, height: h, safeTop: 12, safeBottom: 40, marginX: 9 } : { orient, width: w, height: h, safeTop: 0, safeBottom: 0, marginX: 3 }, orient === 'portrait' ? '已切换为竖屏' : '已切换为横屏');
}
function setSize(e: Event, k: 'width' | 'height'): void {
  const v = Math.round(Number((e.target as HTMLInputElement).value));
  if (!(v >= 320 && v <= 7680)) return toast('宽高要在 320 – 7680 之间', 'err');
  void save({ [k]: v }, '分辨率已修改，直播软件里的浏览器源宽高也要一起改');
}
const ratio = computed(() => {
  if (!o.value) return '';
  const g = gcd(o.value.width, o.value.height);
  return `比例 ${o.value.width / g}:${o.value.height / g}`;
});
const mismatch = computed(() => o.value && (o.value.orient === 'portrait') !== o.value.height > o.value.width);

const url = computed(() => (o.value ? `${location.origin}${o.value.path}` : ''));
const chatUrl = computed(() => (o.value ? `${location.origin}${o.value.chatPath}` : ''));
const mask = (u: string, show: boolean) => (show || !o.value ? u : u.replace(o.value.key, '••••••••••'));
const shownUrl = computed(() => mask(url.value, showKey.value));
const shownChatUrl = computed(() => mask(chatUrl.value, showChatKey.value));
/** 弹幕列表浏览器源的建议宽高（高度随条数、字号变） */
const chatWh = computed(() => (o.value ? { w: CHAT_WIDTH, h: chatHeight(o.value.chatMax, o.value.chatSize) } : { w: CHAT_WIDTH, h: 900 }));
function setChatMax(v: number): void {
  if (!o.value) return;
  const n = Math.round(v);
  if (!(n >= 1 && n <= CHAT_MAX_LIMIT)) return toast(`条数要在 1 – ${CHAT_MAX_LIMIT} 之间`, 'err');
  if (n === o.value.chatMax) return;
  void save({ chatMax: n }, `最多显示 ${n} 条；浏览器源的高度建议改成 ${chatHeight(n, o.value.chatSize)}`);
}
async function copy(which: 'fx' | 'chat'): Promise<void> {
  try {
    await navigator.clipboard.writeText(which === 'chat' ? chatUrl.value : url.value);
    toast(which === 'chat' ? `已复制弹幕列表地址，宽高填 ${chatWh.value.w} × ${chatWh.value.h}` : '已复制特效页地址');
  } catch {
    if (which === 'chat') showChatKey.value = true;
    else showKey.value = true;
    toast('浏览器不允许自动复制，请手动选中地址复制', 'info');
  }
}
async function resetKey(): Promise<void> {
  const target = o.value;
  if (!target) return;
  const r = await attempt(() => post<OutputDto>(`/api/outputs/${target.id}/reset-key`), '已重置密钥：特效页、弹幕列表的旧地址立即失效，请把新地址重新填到直播软件');
  if (r) Object.assign(target, r);
}

function tierEffect(id: Identity): number | null {
  const r = state.enter;
  if (!r) return null;
  return id === 'fan' ? (r.bands[r.bands.length - 1]?.effectId ?? null) : r.tiers[id].effectId;
}
function test(id: Identity): void {
  const e = tierEffect(id);
  if (e) void stage.value?.play(e, SAMPLES[id]);
}
const overlays = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && isFxLive(x)));
/** 「在浏览器里查看」打开的页面：能看特效，但不算加到了直播软件 */
const viewing = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && isFxView(x)));
const chats = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && x.role === 'chat'));
/** 在线状态：「在线 · 直播姬」，几个同时在线时写个数 */
function liveText(list: OverlayInfo[]): string {
  if (!list.length) return '不在线';
  if (list.length > 1) return `${list.length} 个在线`;
  const env = list[0]!.env;
  const host = String(env?.host ?? '');
  return host.startsWith('OBS') ? '在线 · OBS' : host === 'B站直播姬' ? '在线 · 直播姬' : '在线';
}
// 添加步骤：特效页还没连上时展开，连上了就收起（切换输出时重新判断）
const howtoOpen = ref(false);
watch(() => o.value?.id, () => (howtoOpen.value = !overlays.value.length), { immediate: true });
const stageStyle = computed(() => {
  if (!o.value) return {};
  const portrait = o.value.orient === 'portrait';
  return portrait ? { width: '300px', height: `${Math.round((300 * o.value.height) / o.value.width)}px` } : { width: '100%', aspectRatio: `${o.value.width} / ${o.value.height}` };
});
/** 特效页环境检测：只列出有问题的项目，每项写清楚影响和怎么办；全都正常时只说一句 */
const CAP_HINT: Record<string, { name: string; tip: string }> = {
  webmVp9: { name: '透明视频', tip: '透明 WebM 放不了：请更新直播软件；在这之前上传的视频会带背景' },
  blur: { name: '毛玻璃', tip: '不影响使用：玻璃质感的特效会简化成半透明' },
  dynamicBorder: { name: '玻璃描边', tip: '不影响使用：玻璃边缘的光效会简化' },
  audio: { name: '声音', tip: '声音可能出不来：OBS 里勾选「通过 OBS 控制音频」；直播姬里检查这个浏览器源的音量' },
};
function capIssues(env: Record<string, unknown> | null): Array<{ name: string; tip: string }> {
  if (!env) return [];
  return Object.keys(CAP_HINT).filter((k) => !env[k]).map((k) => CAP_HINT[k]!);
}
/** 特效页报的错误翻成大白话，写上怎么办 */
function plainError(msg: string): string {
  if (/play\(\) failed|user didn't interact|NotAllowedError|autoplay/i.test(msg)) return '声音被直播软件拦住了：OBS 里勾选「通过 OBS 控制音频」后，右键这个浏览器源点「刷新」；直播姬里检查这个素材的音量';
  if (/404|Failed to load|NotSupportedError|no supported source|MEDIA_ERR|加载失败/i.test(msg)) return `素材文件读不出来，可能被删了或者格式不支持：到素材库重新上传，或者换一个特效（${msg}）`;
  if (/超时|timeout/i.test(msg)) return `素材加载太慢：文件可能太大，或者网络不好（${msg}）`;
  return msg;
}
// 发一个测试特效到直播画面（直播软件里真的会出现），直播中要再点一次确认
async function sendTest(): Promise<void> {
  const e = state.enter?.tiers.cap.effectId ?? state.effects.find((x) => x.builtin)?.id;
  if (!e) return toast('还没有可以测试的特效', 'info');
  await attempt(() => post('/api/playback/test', { effectId: e }), '已发送：去直播软件里看看画面上有没有出现');
}
async function copyCheck(): Promise<void> {
  if (!o.value) return;
  const url = `${location.origin}/overlay/?check=1&w=${o.value.width}&h=${o.value.height}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('已复制自检地址：在直播软件里临时加一个浏览器源打开它，看完删掉');
  } catch {
    toast(url, 'info', 8000);
  }
}
/** 特效页运行环境（取直播软件里的那个，不取浏览器查看的） */
const fxEnv = computed(() => overlays.value[0]?.env ?? null);
const fxError = computed(() => overlays.value.find((x) => x.lastError)?.lastError ?? null);
</script>

<template>
  <section v-if="o" class="page">
    <div class="page-head">
      <div>
        <h1>直播软件输出</h1>
        <p>把特效页和弹幕列表加到直播软件里。每个输出对应直播软件里的一个画面，比如竖屏直播、横屏录播。</p>
      </div>
    </div>

    <div class="outbar" role="tablist" aria-label="输出">
      <button v-for="x in state.outputs" :key="x.id" class="otab" role="tab" :aria-selected="x.id === o.id" @click="selId = x.id"><span class="dot" :class="{ off: !online(x.id) }" />{{ x.name }}<span class="res num">{{ x.width }}×{{ x.height }}</span></button>
      <button class="otab add" @click="addOutput"><Icon name="i-plus" />新建输出</button>
      <div class="omore">
        <input v-if="renaming" :key="o.id" :ref="(el) => (el as HTMLInputElement | null)?.focus()" class="inp" :value="o.name" maxlength="40" aria-label="输出名称" @change="rename" @blur="renaming = false" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" @keydown.esc="renaming = false" />
        <button v-else class="linkish" @click="renaming = true">改名</button>
        <ConfirmButton v-if="state.outputs.length > 1" label="删除这个输出" confirm-label="确认删除？地址会失效" cls="linkish dim" armed-cls="delb" @confirm="removeOutput" />
      </div>
    </div>

    <div class="o2">
      <div class="o2-col">
        <!-- ① 加到直播软件 -->
        <div class="card">
          <div class="card-h">
            <h2>加到直播软件</h2>
            <span class="aside">
              <span class="seg" role="group" aria-label="直播软件">
                <button :aria-pressed="o.app === 'livehime'" @click="save({ app: 'livehime' })">B站直播姬</button>
                <button :aria-pressed="o.app === 'obs'" @click="save({ app: 'obs' })">OBS</button>
              </span>
            </span>
          </div>

          <div class="srcbox">
            <div class="src-h">
              <span class="src-ic fx"><Icon name="i-spark" /></span>
              <span class="src-t"><b>特效页</b><span>进场、礼物、上舰、弹幕回应的特效 · 铺满画面，放在最上层</span></span>
              <span class="right"><span class="live" :class="overlays.length ? '' : 'off'"><i />{{ liveText(overlays) }}</span></span>
            </div>
            <div class="src-url">
              <input class="inp" :value="shownUrl" readonly aria-label="特效页地址" @focus="(e) => showKey && (e.target as HTMLInputElement).select()" />
              <button class="btn primary" @click="copy('fx')"><Icon name="i-copy" />复制地址</button>
              <button class="btn ic" :title="showKey ? '隐藏密钥' : '显示密钥'" :aria-label="showKey ? '隐藏密钥' : '显示密钥'" @click="showKey = !showKey"><Icon :name="showKey ? 'i-eye-off' : 'i-eye'" /></button>
            </div>
            <div class="src-f">
              <span class="wh2">宽高填 <code>{{ o.width }} × {{ o.height }}</code></span>
              <span v-if="fxEnv" class="caps">
                <span v-if="!capIssues(fxEnv).length" class="ok" title="透明视频、毛玻璃、玻璃描边、声音都支持">✓ 环境正常</span>
                <span v-for="c in capIssues(fxEnv)" :key="c.name" class="mid" :title="c.tip">! {{ c.name }}</span>
                <span v-if="fxEnv.lite" class="mid" title="电脑性能不够时自动简化特效，保证不卡">兼容模式</span>
              </span>
              <span class="links">
                <a class="linkish" :href="`${o.path}&view=1`" target="_blank" rel="noopener" title="深色背景、显示安全区和连接状态；只用来查看，直播软件里请用上面的地址">在浏览器里查看</a>
                <ConfirmButton label="重置密钥" confirm-label="确认重置？两个地址都会失效" cls="linkish dim" armed-cls="delb" @confirm="resetKey" />
              </span>
            </div>
            <div v-if="viewing.length && !overlays.length" class="src-note">浏览器里正在查看特效页，但这不算加到了直播软件：直播画面里要另外添加上面的地址</div>
            <div v-if="capIssues(fxEnv).length" class="src-note">{{ capIssues(fxEnv).map((c) => `${c.name}：${c.tip}`).join('；') }}</div>
            <div v-if="fxError" class="src-err">最近的问题：{{ plainError(fxError) }}</div>
            <div v-if="overlays.length" class="src-test">
              <ConfirmButton v-if="state.status?.live.live" label="发一个测试特效到直播画面" confirm-label="确认？观众会看到" cls="btn" armed-cls="btn live-send" @confirm="sendTest" />
              <button v-else class="btn" type="button" @click="sendTest">发一个测试特效到直播画面</button>
              <span class="inline-hint">直播软件里真的会出现一次，用来确认加对了</span>
            </div>
          </div>

          <div class="srcbox" :class="{ off: !o.chatEnabled }">
            <div class="src-h">
              <span class="src-ic dm"><Icon name="i-chat" /></span>
              <span class="src-t"><b>弹幕列表</b><span>所有人的弹幕排成一列，最多 {{ o.chatMax }} 条 · 拖到画面左边或右边</span></span>
              <span class="right">
                <span class="live" :class="o.chatEnabled && chats.length ? '' : 'off'"><i />{{ o.chatEnabled ? liveText(chats) : '已关闭' }}</span>
                <button class="switch" role="switch" type="button" :aria-checked="o.chatEnabled" aria-label="启用弹幕列表" @click="save({ chatEnabled: !o.chatEnabled }, o.chatEnabled ? '已关闭弹幕列表：直播画面上不再显示' : '已打开弹幕列表')" />
              </span>
            </div>
            <div class="src-url">
              <input class="inp" :value="shownChatUrl" readonly aria-label="弹幕列表地址" @focus="(e) => showChatKey && (e.target as HTMLInputElement).select()" />
              <button class="btn primary" @click="copy('chat')"><Icon name="i-copy" />复制地址</button>
              <button class="btn ic" :title="showChatKey ? '隐藏密钥' : '显示密钥'" :aria-label="showChatKey ? '隐藏密钥' : '显示密钥'" @click="showChatKey = !showChatKey"><Icon :name="showChatKey ? 'i-eye-off' : 'i-eye'" /></button>
            </div>
            <div class="src-f">
              <span class="wh2">宽高填 <code>{{ chatWh.w }} × {{ chatWh.h }}</code></span>
              <span>高度按 {{ o.chatMax }} 条算好了，矮了就少显示几条</span>
              <span class="links"><a class="linkish" :href="`${o.chatPath}&view=1`" target="_blank" rel="noopener" title="深色背景，只用来查看；直播软件里请用上面的地址">在浏览器里查看</a></span>
            </div>
          </div>

          <details class="howto" :open="howtoOpen" @toggle="(e) => (howtoOpen = (e.target as HTMLDetailsElement).open)">
            <summary><Icon name="i-chev" /><span>{{ o.app === 'obs' ? '在 OBS 中添加' : '在 B站直播姬中添加' }}</span><span class="aside">特效页没连上时自动展开{{ o.app === 'livehime' ? ' · 菜单名称以实际版本为准' : '' }}</span></summary>
            <ol v-if="o.app === 'obs'" class="steps">
              <li v-if="o.orient === 'portrait'"><span>竖屏推流时，OBS 的 <b>设置 → 视频 → 基础分辨率</b> 也要设成 <code>{{ o.width }}x{{ o.height }}</code>。</span></li>
              <li><span><em class="tagsrc fx">特效页</em>在 <b>来源</b> 里点 <b>+</b> → <b>浏览器</b>，命名为「星临特效」，URL 粘贴特效页地址，宽 <code>{{ o.width }}</code> 高 <code>{{ o.height }}</code>，勾选 <b>通过 OBS 控制音频</b>（特效的音效才会进入直播）。</span></li>
              <li><span><em class="tagsrc fx">特效页</em>取消勾选 <b>不可见时关闭源</b> 和 <b>场景变为活动状态时刷新浏览器</b>，避免切场景时漏播；把它拖到来源列表 <b>最上方</b>。</span></li>
              <li v-if="o.chatEnabled"><span><em class="tagsrc dm">弹幕列表</em>再加一个 <b>浏览器</b> 来源，命名为「星临弹幕」，URL 粘贴弹幕列表地址，宽 <code>{{ chatWh.w }}</code> 高 <code>{{ chatWh.h }}</code>，拖到画面左边或右边。</span></li>
              <li><span>第一次用可以先检查直播软件支不支持：<button type="button" class="linkish" @click="copyCheck">复制兼容性自检地址</button>，在直播软件里临时加一个浏览器源打开它，看完删掉。加好特效页后，也可以点上面的「发一个测试特效到直播画面」。</span></li>
            </ol>
            <ol v-else class="steps">
              <li v-if="o.orient === 'portrait'"><span>在直播姬里切换到 <b>竖屏直播</b> 模式。</span></li>
              <li><span><em class="tagsrc fx">特效页</em>点 <b>添加素材 → 浏览器</b>，粘贴特效页地址，宽高填 <code>{{ o.width }}</code> × <code>{{ o.height }}</code>，拖动 <b>铺满画面</b>，放到 <b>图层最上方</b>。</span></li>
              <li v-if="o.chatEnabled"><span><em class="tagsrc dm">弹幕列表</em>再添加一个 <b>浏览器</b> 素材，粘贴弹幕列表地址，宽高填 <code>{{ chatWh.w }}</code> × <code>{{ chatWh.h }}</code>，拖到画面左边或右边。想改大小就改宽高数字或下面的「字号」，不要拉伸变形。</span></li>
              <li><span>第一次用可以先检查直播软件支不支持：<button type="button" class="linkish" @click="copyCheck">复制兼容性自检地址</button>，在直播软件里临时加一个浏览器源打开它，看完删掉。加好特效页后，也可以点上面的「发一个测试特效到直播画面」。</span></li>
            </ol>
          </details>
        </div>

        <!-- ② 特效页设置 -->
        <div class="card">
          <div class="card-h"><h2>特效页设置</h2><span class="aside">改了马上生效，不用刷新直播软件</span></div>
          <div class="srows">
            <div class="srow">
              <span class="lb">画布方向</span>
              <div class="ctl"><div class="line">
                <span class="seg" role="group" aria-label="画布方向">
                  <button :aria-pressed="o.orient === 'portrait'" @click="setOrient('portrait')"><span class="shp" style="width: 9px; height: 14px" />竖屏</button>
                  <button :aria-pressed="o.orient === 'landscape'" @click="setOrient('landscape')"><span class="shp" style="width: 15px; height: 9px" />横屏</button>
                </span>
                <span class="hint">{{ o.orient === 'portrait' ? '手机直播' : '电脑游戏直播' }}</span>
              </div></div>
            </div>
            <div class="srow">
              <span class="lb">分辨率<small>和直播软件里的宽高一致</small></span>
              <div class="ctl">
                <div class="presets">
                  <button v-for="p in PRESETS[o.orient]" :key="p[2]" :aria-pressed="p[0] === o.width && p[1] === o.height" @click="save({ width: p[0], height: p[1] }, `分辨率：${p[0]}×${p[1]}`)">{{ p[0] }}×{{ p[1] }}<small>{{ p[2] }}</small></button>
                </div>
                <div class="line">
                  <span class="wh3">
                    <input class="inp num" type="number" min="320" max="7680" :value="o.width" aria-label="宽" @change="(e) => setSize(e, 'width')" /><span>×</span>
                    <input class="inp num" type="number" min="320" max="7680" :value="o.height" aria-label="高" @change="(e) => setSize(e, 'height')" />
                  </span>
                  <span class="hint">{{ ratio }}<span v-if="mismatch" style="color: var(--gov)">　宽高和方向不一致，请检查</span></span>
                </div>
              </div>
            </div>
            <div v-if="o.orient === 'portrait'" class="srow">
              <span class="lb">竖屏安全区<small>特效自动避开</small></span>
              <div class="ctl">
                <div class="slider-row"><label for="st">顶部</label><input id="st" v-model.number="o.safeTop" type="range" min="0" max="25" @change="save({ safeTop: o.safeTop })" /><output>{{ o.safeTop }}%</output></div>
                <div class="slider-row"><label for="sb">底部</label><input id="sb" v-model.number="o.safeBottom" type="range" min="0" max="45" @change="save({ safeBottom: o.safeBottom })" /><output>{{ o.safeBottom }}%</output></div>
                <span class="hint">B站手机端竖屏直播时，顶部是主播信息，底部是弹幕和礼物栏。默认按实测：顶部 12%、底部 40%。<label class="inline-ck"><input v-model="showSafe" type="checkbox" />预览里显示</label></span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">特效大小<small>作用于所有规则</small></span>
              <div class="ctl">
                <div class="slider-row"><label for="scale">整体缩放</label><input id="scale" v-model.number="o.scale" type="range" min="60" max="160" step="5" @change="save({ scale: o.scale })" /><output>{{ o.scale }}%</output></div>
                <div class="slider-row"><label for="mx">左右边距</label><input id="mx" v-model.number="o.marginX" type="range" min="0" max="15" @change="save({ marginX: o.marginX })" /><output>{{ o.marginX }}%</output></div>
              </div>
            </div>
            <div class="srow">
              <span class="lb">兼容模式</span>
              <div class="ctl"><div class="line">
                <select class="sel" aria-label="兼容模式" :value="o.liteMode" @change="(e) => save({ liteMode: (e.target as HTMLSelectElement).value as OutputDto['liteMode'] }, '兼容模式已修改')">
                  <option value="auto">自动</option><option value="on">始终开启</option><option value="off">关闭</option>
                </select>
                <span class="hint">关掉毛玻璃、粒子等较重的效果。电脑性能一般或直播软件版本旧时用（弹幕列表也跟着用）。</span>
              </div></div>
            </div>
          </div>
        </div>

        <!-- ③ 弹幕列表设置 -->
        <div class="card" :class="{ dimmed: !o.chatEnabled }">
          <div class="card-h"><h2>弹幕列表设置</h2><span class="aside">{{ o.chatEnabled ? '改了马上生效' : '弹幕列表已关闭' }}</span></div>
          <div class="srows">
            <div class="srow">
              <span class="lb">对齐</span>
              <div class="ctl"><div class="line">
                <span class="seg" role="group" aria-label="对齐">
                  <button :aria-pressed="o.chatSide === 'left'" @click="save({ chatSide: 'left' })">靠左</button>
                  <button :aria-pressed="o.chatSide === 'right'" @click="save({ chatSide: 'right' })">靠右</button>
                </span>
                <span class="hint">放在画面左边选靠左，右边选靠右（头像跟着换边）</span>
              </div></div>
            </div>
            <div class="srow">
              <span class="lb">字号</span>
              <div class="ctl"><div class="line">
                <span class="seg" role="group" aria-label="字号">
                  <button :aria-pressed="o.chatSize === 'normal'" @click="save({ chatSize: 'normal' })">标准</button>
                  <button :aria-pressed="o.chatSize === 'large'" @click="save({ chatSize: 'large' })">大</button>
                </span>
                <span class="hint">字号改了，浏览器源的高度也跟着变（上面「宽高填」已经算好）</span>
              </div></div>
            </div>
            <div class="srow">
              <span class="lb">粉丝牌</span>
              <div class="ctl">
                <div class="line">
                  <span class="seg" role="group" aria-label="粉丝牌">
                    <button :aria-pressed="o.chatMedal === 'own'" @click="save({ chatMedal: 'own' })">只显示本直播间的</button>
                    <button :aria-pressed="o.chatMedal === 'all'" @click="save({ chatMedal: 'all' })">戴什么显示什么</button>
                  </span>
                </div>
                <span class="hint">{{ o.chatMedal === 'own' ? '戴别的直播间粉丝牌的观众，列表里不显示牌子' : '和 B 站直播间里一样，戴哪个直播间的牌子就显示哪个' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">条数</span>
              <div class="ctl">
                <div class="line">
                  <span class="stepper">
                    <button type="button" aria-label="少一条" :disabled="o.chatMax <= 1" @click="setChatMax(o.chatMax - 1)">−</button>
                    <input :key="`${o.id}-${o.chatMax}`" class="inp num" type="number" min="1" :max="CHAT_MAX_LIMIT" :value="o.chatMax" aria-label="最多显示几条" @change="(e) => setChatMax(Number((e.target as HTMLInputElement).value))" />
                    <button type="button" aria-label="多一条" :disabled="o.chatMax >= CHAT_MAX_LIMIT" @click="setChatMax(o.chatMax + 1)">+</button>
                  </span>
                  <span class="hint">最多显示几条（1 – {{ CHAT_MAX_LIMIT }}）</span>
                </div>
                <span class="hint">条数改了，浏览器源的高度也要跟着改（上面「宽高填」已经算好）。放不下时从最上面开始少显示几条。</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：实时预览 -->
      <div class="o2-prev">
        <div class="card">
          <div class="ptabs" role="tablist" aria-label="预览">
            <button role="tab" :aria-selected="ptab === 'fx'" @click="ptab = 'fx'">特效页</button>
            <button role="tab" :aria-selected="ptab === 'chat'" @click="ptab = 'chat'">弹幕列表</button>
            <span class="aside">{{ ptab === 'fx' ? `${o.width} × ${o.height} · 只在这里播放` : o.chatEnabled ? `${chatWh.w} × ${chatWh.h} · 实时弹幕` : '弹幕列表已关闭' }}</span>
          </div>
          <div class="ostage-wrap">
            <PreviewStage v-if="ptab === 'fx'" ref="stage" :key="o.id" cls="ostage" :config="cfg" :safe="showSafe && o.orient === 'portrait'" :alpha="alphaBg" :style="stageStyle" />
            <ChatPreview v-else-if="cfg" ref="chatPv" :key="`c${o.id}`" :config="cfg" :alpha="alphaBg" />
          </div>
          <div class="prev-tools">
            <template v-if="ptab === 'fx'">
              <button v-for="id in (['gov', 'cap', 'fan', 'nor'] as Identity[])" :key="id" class="btn" :disabled="!tierEffect(id)" @click="test(id)"><i :style="{ background: id === 'fan' ? '#C770A4' : `var(--${id})` }" />{{ { gov: '总督', cap: '舰长', fan: '粉丝牌', nor: '普通' }[id as 'gov'] }}</button>
            </template>
            <template v-else>
              <button class="btn" :disabled="!o.chatEnabled" @click="chatPv?.test('normal')"><i style="background: var(--nor)" />测试弹幕</button>
              <button class="btn" :disabled="!o.chatEnabled" @click="chatPv?.test('guard')"><i style="background: var(--gov)" />大航海发言</button>
            </template>
            <button class="btn" style="margin-left: auto" @click="alphaBg = !alphaBg">{{ alphaBg ? '游戏画面背景' : '透明背景' }}</button>
          </div>
          <p v-if="ptab === 'fx' && overlays.length" class="prev-note">特效页已连上 {{ clock(overlays[0]!.since) }} 起</p>
        </div>
      </div>
    </div>
  </section>
</template>
