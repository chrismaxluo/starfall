<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import PreviewStage from '../components/PreviewStage.vue';
import Switch from '../components/Switch.vue';
import { del, post, put } from '../lib/api.ts';
import { clock, gcd } from '../lib/format.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto, OverlayConfig } from '../lib/types.ts';

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
const online = (id: number) => state.overlays.some((x) => x.outputId === id);
const cfg = computed<OverlayConfig | null>(() => {
  const x = o.value;
  return x ? { outputId: x.id, name: x.name, app: x.app, orient: x.orient, width: x.width, height: x.height, safeTop: x.safeTop, safeBottom: x.safeBottom, marginX: x.marginX, scale: x.scale, liteMode: x.liteMode } : null;
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
async function rename(e: Event): Promise<void> {
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
const showSafe = ref(true);
const showKey = ref(false);
const alphaBg = ref(false);

const PRESETS = {
  portrait: [[1080, 1920, '推荐'], [720, 1280, '省性能'], [1440, 2560, '2K']],
  landscape: [[1920, 1080, '推荐'], [1280, 720, '省性能'], [2560, 1440, '2K']],
} as const;

async function save(patch: Partial<OutputDto>, msg?: string): Promise<void> {
  if (!o.value) return;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${o.value!.id}`, patch), msg);
  if (r) Object.assign(o.value, r);
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
const shownUrl = computed(() => (showKey.value || !o.value ? url.value : url.value.replace(o.value.key, '••••••••••')));
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(url.value);
    toast('已复制浏览器源地址');
  } catch {
    showKey.value = true;
    toast('浏览器不允许自动复制，请手动选中地址复制', 'info');
  }
}
async function resetKey(): Promise<void> {
  const r = await attempt(() => post<OutputDto>(`/api/outputs/${o.value!.id}/reset-key`), '已重置密钥：旧地址立即失效，请把新地址重新填到直播软件');
  if (r) Object.assign(o.value!, r);
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
const overlays = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id));
const stageStyle = computed(() => {
  if (!o.value) return {};
  const portrait = o.value.orient === 'portrait';
  return portrait ? { width: '300px', height: `${Math.round((300 * o.value.height) / o.value.width)}px` } : { width: '100%', aspectRatio: `${o.value.width} / ${o.value.height}` };
});
function caps(env: Record<string, unknown> | null): Array<[string, boolean]> {
  if (!env) return [];
  return [['透明视频', Boolean(env.webmVp9)], ['毛玻璃', Boolean(env.blur)], ['动态描边', Boolean(env.dynamicBorder)], ['声音', Boolean(env.audio)]];
}
</script>

<template>
  <section v-if="o" class="page">
    <div class="page-head">
      <div>
        <h1>直播软件输出</h1>
        <p>把特效页作为浏览器源加到 OBS 或 B站直播姬里。画布方向和分辨率要和直播软件里的宽高一致。</p>
      </div>
      <div class="actions">
        <span class="live" :class="overlays.length ? '' : 'off'"><i />{{ overlays.length ? `「${o.name}」特效页 ${overlays.length} 个在线` : `「${o.name}」特效页不在线` }}</span>
      </div>
    </div>

    <div class="obs">
      <div class="obs-col">
        <div class="card">
          <div class="card-h"><h2>输出</h2><span class="aside">可以为不同场景各建一个，比如竖屏直播 + 横屏录播</span></div>
          <div class="outs">
            <button v-for="x in state.outputs" :key="x.id" :aria-pressed="x.id === o.id" @click="selId = x.id"><span class="dot" :class="{ off: !online(x.id) }" />{{ x.name }}<span class="num" style="color: var(--t3); font-size: 12px">{{ x.width }}×{{ x.height }}</span></button>
            <button @click="addOutput"><Icon name="i-plus" />新建输出</button>
          </div>
          <div class="out-name">
            <label for="outName">名称</label>
            <input id="outName" :key="o.id" class="inp" :value="o.name" maxlength="40" @change="rename" @keydown.enter="(e) => (e.target as HTMLInputElement).blur()" />
            <ConfirmButton v-if="state.outputs.length > 1" label="删除这个输出" confirm-label="确认删除？地址会失效" cls="linkish" armed-cls="delb" @confirm="removeOutput" />
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>直播软件</h2><span class="aside">决定下方的添加步骤</span></div>
          <div class="orients">
            <button :aria-pressed="o.app === 'livehime'" @click="save({ app: 'livehime' })"><span class="shape" style="width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; font-weight: 700">B</span><span><b>B站直播姬</b><span>电脑版 · 浏览器素材</span></span></button>
            <button :aria-pressed="o.app === 'obs'" @click="save({ app: 'obs' })"><span class="shape" style="width: 26px; height: 26px; border-radius: 50%" /><span><b>OBS Studio</b><span>浏览器源</span></span></button>
          </div>
          <div class="field" style="margin-top: 16px">
            <div class="toggle-line">兼容模式 <span class="hint">关闭毛玻璃、粒子等较重的效果，旧版内核或电脑性能一般时使用</span>
              <select class="sel" style="width: 120px; margin-left: auto" aria-label="兼容模式" :value="o.liteMode" @change="(e) => save({ liteMode: (e.target as HTMLSelectElement).value as OutputDto['liteMode'] }, '兼容模式已修改')">
                <option value="auto">自动</option><option value="on">始终开启</option><option value="off">关闭</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>画布</h2></div>
          <div class="field">
            <span class="flabel">方向</span>
            <div class="orients">
              <button :aria-pressed="o.orient === 'portrait'" @click="setOrient('portrait')"><span class="shape" style="width: 18px; height: 30px" /><span><b>竖屏</b><span>手机直播 · 默认</span></span></button>
              <button :aria-pressed="o.orient === 'landscape'" @click="setOrient('landscape')"><span class="shape" style="width: 32px; height: 19px" /><span><b>横屏</b><span>电脑游戏直播</span></span></button>
            </div>
          </div>
          <div class="field" style="margin-top: 18px">
            <span class="flabel">分辨率</span>
            <div class="presets">
              <button v-for="p in PRESETS[o.orient]" :key="p[2]" :aria-pressed="p[0] === o.width && p[1] === o.height" @click="save({ width: p[0], height: p[1] }, `分辨率：${p[0]}×${p[1]}`)">{{ p[0] }}×{{ p[1] }}<small>{{ p[2] }}</small></button>
            </div>
            <div class="wh" style="margin-top: 4px">
              <div class="suffix"><input class="inp num" type="number" min="320" max="7680" :value="o.width" aria-label="宽" @change="(e) => setSize(e, 'width')" /><span>宽</span></div>
              <span>×</span>
              <div class="suffix"><input class="inp num" type="number" min="320" max="7680" :value="o.height" aria-label="高" @change="(e) => setSize(e, 'height')" /><span>高</span></div>
            </div>
            <span class="hint" style="font-size: 12px; color: var(--t3)">{{ ratio }}<span v-if="mismatch" style="color: var(--gov)">　宽高和方向不一致，请检查</span></span>
          </div>
        </div>

        <div v-if="o.orient === 'portrait'" class="card">
          <div class="card-h"><h2>竖屏安全区</h2><span class="aside">特效会自动避开这些区域</span></div>
          <div class="field">
            <div class="toggle-line">在预览中显示安全区 <Switch v-model="showSafe" label="显示安全区" /></div>
            <div class="slider-row"><label for="st">顶部信息栏</label><input id="st" v-model.number="o.safeTop" type="range" min="0" max="25" @change="save({ safeTop: o.safeTop })" /><output>{{ o.safeTop }}%</output></div>
            <div class="slider-row"><label for="sb">底部弹幕区</label><input id="sb" v-model.number="o.safeBottom" type="range" min="0" max="45" @change="save({ safeBottom: o.safeBottom })" /><output>{{ o.safeBottom }}%</output></div>
            <span class="hint" style="font-size: 12px; color: var(--t3)">B站手机端竖屏直播时，顶部是主播信息和在线人数，底部是弹幕和礼物栏。默认值按手机端实测（顶部 12%、底部 40%）。</span>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>特效外观</h2><span class="aside">作用于所有规则</span></div>
          <div class="field">
            <div class="slider-row"><label for="scale">整体缩放</label><input id="scale" v-model.number="o.scale" type="range" min="60" max="160" step="5" @change="save({ scale: o.scale })" /><output>{{ o.scale }}%</output></div>
            <div class="slider-row"><label for="mx">左右边距</label><input id="mx" v-model.number="o.marginX" type="range" min="0" max="15" @change="save({ marginX: o.marginX })" /><output>{{ o.marginX }}%</output></div>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>浏览器源地址</h2><span class="aside">地址里带访问密钥，不要公开</span></div>
          <div class="url">
            <input class="inp" :value="shownUrl" readonly aria-label="浏览器源地址" @focus="(e) => showKey && (e.target as HTMLInputElement).select()" />
            <button class="btn" @click="copy"><Icon name="i-copy" />复制</button>
            <button class="btn" @click="showKey = !showKey">{{ showKey ? '隐藏密钥' : '显示密钥' }}</button>
          </div>
          <div style="display: flex; gap: 16px; margin-top: 10px">
            <a class="linkish" :href="o.path" target="_blank" rel="noopener">在新标签页打开特效页</a>
            <ConfirmButton label="重置密钥" confirm-label="确认重置？旧地址会立即失效" cls="linkish" armed-cls="delb" @confirm="resetKey" />
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>{{ o.app === 'obs' ? '在 OBS 中添加' : '在 B站直播姬中添加' }}</h2><span v-if="o.app === 'livehime'" class="aside">菜单名称以实际版本为准</span></div>
          <ol v-if="o.app === 'obs'" class="steps">
            <li v-if="o.orient === 'portrait'"><span>竖屏推流时，OBS 的 <b>设置 → 视频 → 基础分辨率</b> 也要设成 <code>{{ o.width }}x{{ o.height }}</code>。</span></li>
            <li><span>在 OBS <b>来源</b> 里点 <b>+</b>，选择 <b>浏览器</b>，命名为「星临特效」。</span></li>
            <li><span><b>URL</b> 粘贴上面的地址（点「复制」）。</span></li>
            <li><span><b>宽度</b> 填 <code>{{ o.width }}</code>，<b>高度</b> 填 <code>{{ o.height }}</code>，要和这里的分辨率一致。</span></li>
            <li><span>勾选 <b>通过 OBS 控制音频</b>，特效的音效才会进入直播。</span></li>
            <li><span>取消勾选 <b>不可见时关闭源</b> 和 <b>场景变为活动状态时刷新浏览器</b>，避免切场景时漏播。</span></li>
            <li><span>把「星临特效」拖到来源列表 <b>最上方</b>，让特效盖在画面最上层。</span></li>
            <li><span>检查环境：用浏览器源打开 <a class="linkish" :href="`/overlay/?check=1&w=${o.width}&h=${o.height}`" target="_blank">兼容性自检页</a>。</span></li>
          </ol>
          <ol v-else class="steps">
            <li v-if="o.orient === 'portrait'"><span>在直播姬里切换到 <b>竖屏直播</b> 模式。</span></li>
            <li><span>点 <b>添加素材</b>，选择 <b>浏览器</b>（网页）类素材。</span></li>
            <li><span>地址栏粘贴上面的地址，宽高填 <code>{{ o.width }}</code> × <code>{{ o.height }}</code>。</span></li>
            <li><span>拖动素材 <b>铺满画面</b>，并放到 <b>图层最上方</b>。</span></li>
            <li><span>首次使用建议先用浏览器素材打开 <a class="linkish" :href="`/overlay/?check=1&w=${o.width}&h=${o.height}`" target="_blank">兼容性自检页</a>，确认特效和声音都正常。</span></li>
          </ol>
        </div>
      </div>

      <div class="obs-prev">
        <div class="card">
          <div class="card-h"><h2>实时预览</h2><span class="aside">{{ o.width }} × {{ o.height }} · 只在这里播放</span></div>
          <div class="ostage-wrap">
            <PreviewStage ref="stage" :key="o.id" cls="ostage" :config="cfg" :safe="showSafe && o.orient === 'portrait'" :alpha="alphaBg" :style="stageStyle" />
          </div>
          <div class="prev-tools">
            <button v-for="id in (['gov', 'cap', 'fan', 'nor'] as Identity[])" :key="id" class="btn" :disabled="!tierEffect(id)" @click="test(id)"><i :style="{ background: id === 'fan' ? '#C770A4' : `var(--${id})` }" />{{ { gov: '总督', cap: '舰长', fan: '粉丝牌', nor: '普通' }[id as 'gov'] }}</button>
            <button class="btn" style="margin-left: auto" @click="alphaBg = !alphaBg">{{ alphaBg ? '游戏画面背景' : '透明背景' }}</button>
          </div>
        </div>
        <div class="card" style="margin-top: 16px">
          <div class="card-h"><h2>已连接的特效页</h2><span class="aside">特效页会自动上报运行环境</span></div>
          <div class="clients">
            <div v-for="(c, i) in overlays" :key="i" class="client">
              <div class="top1">
                <span class="live" style="height: 20px; padding: 0 8px"><i />在线</span>{{ c.env?.host ?? '特效页' }}
                <span class="num">{{ c.env?.chrome ? `Chromium ${c.env.chrome}` : '' }}{{ c.env?.viewport ? ` · ${c.env.viewport}` : '' }} · {{ clock(c.since) }} 起</span>
              </div>
              <div class="caps">
                <span v-for="[name, ok] in caps(c.env)" :key="name" :class="ok ? 'cap-ok' : 'cap-mid'">{{ ok ? '✓' : '!' }} {{ name }}</span>
                <span v-if="c.env?.lite" class="cap-mid">兼容模式</span>
              </div>
              <div v-if="c.lastError" class="foot" style="color: var(--gov)">最近的问题：{{ c.lastError }}</div>
            </div>
            <div v-if="!overlays.length" class="soon-box" style="padding: 24px"><b>还没有特效页连上</b>按左边的步骤把地址加到直播软件，这里就会显示</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
