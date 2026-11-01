<script setup lang="ts">
// 弹幕列表：直播画面上所有人的弹幕排成一列。和送礼名单页一样的结构：
// 左边「显示什么」（改了马上生效）和「加到直播软件」；右边预览和外观（先改草稿，点「保存」才到直播画面，预览照着草稿显示）
import { computed, ref, watch } from 'vue';
import { CHAT_ALPHA_MAX, CHAT_ALPHA_MIN, CHAT_FADE_MAX, CHAT_FADE_OPTIONS, CHAT_LOOK_ALPHA, CHAT_MAX_LIMIT, CHAT_WIDTH, chatHeight } from '@starfall/shared/overlay';
import CdPick from '../components/CdPick.vue';
import ChatPreview from '../components/ChatPreview.vue';
import DraftBar from '../components/DraftBar.vue';
import Icon from '../components/Icon.vue';
import Seg from '../components/Seg.vue';
import SourceCard from '../components/SourceCard.vue';
import Switch from '../components/Switch.vue';
import { put } from '../lib/api.ts';
import { useDraft } from '../lib/draft.ts';
import { confirmLeave, go } from '../lib/route.ts';
import { overlayConfigOf, refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto, OverlayConfig } from '../lib/types.ts';

// ---------- 输出（只有一个输出时不显示切换） ----------
const selId = ref<number | null>(null);
const o = computed(() => state.outputs.find((x) => x.id === selId.value) ?? state.outputs[0]);
function pickOutput(e: Event): void {
  const el = e.target as HTMLSelectElement;
  if (confirmLeave()) selId.value = Number(el.value);
  else el.value = String(o.value?.id);
}

async function save(patch: Partial<OutputDto>, msg?: string): Promise<boolean> {
  const target = o.value;
  if (!target) return false;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${target.id}`, patch), msg);
  if (r) Object.assign(target, r);
  else await refreshOutputs();
  return Boolean(r);
}

// ---------- 外观：草稿 ----------
const look = useDraft(() => o.value, ['chatLook', 'chatMascot', 'chatCreamFrame', 'chatGuardFrame', 'chatAlpha', 'chatSide', 'chatSize', 'chatMax'] as const, (p): Promise<boolean> => {
  const x = { ...o.value!, ...p };
  const h = chatHeight(x.chatMax, x.chatSize, x.chatLook);
  return save(p, h !== chatHeight(o.value!.chatMax, o.value!.chatSize, o.value!.chatLook) ? `已保存：浏览器源的高度建议改成 ${h}` : '已保存，直播画面已更新');
});
watch(() => o.value?.id, () => look.reset());
/** 已保存 + 外观草稿（模板里只在有输出时用） */
const v = computed(() => ({ ...o.value!, ...look.pending.value }));
const cfg = computed<OverlayConfig | null>(() => (o.value ? overlayConfigOf(v.value) : null));
/** 浏览器源宽高：按已保存的条数、字号、外观算（直播软件里填的是这个） */
const wh = computed(() => ({ w: CHAT_WIDTH, h: o.value ? chatHeight(o.value.chatMax, o.value.chatSize, o.value.chatLook) : 900 }));

/** 玻璃是原来的样子，另外五种是小八主题（头像框是小八的脑袋，气泡右上角是小八的头顶） */
const LOOKS: Array<{ value: OutputDto['chatLook']; label: string; hint: string }> = [
  { value: 'glass', label: '玻璃', hint: '毛玻璃气泡，大航海观众使用 B站头像框' },
  { value: 'jelly', label: '果冻玻璃', hint: '有厚度的透明玻璃气泡，小八头顶是蓝色果冻；大航海以边缘光的颜色区分' },
  { value: 'porcelain', label: '青花瓷', hint: '白釉气泡，钴蓝弦纹和青海波浪纹，朱红印章；提督、总督为描金' },
  { value: 'cream', label: '奶油贴纸', hint: '奶油色贴纸气泡，带蓝色缝线和粉色格子胶带' },
  { value: 'night', label: '星月夜空', hint: '深蓝色夜空气泡，带发光描边、月亮和星星' },
  { value: 'pixel', label: '像素小屋', hint: '像素风格气泡，小八也是像素画，动作按像素游戏的节奏播放' },
];
const MASCOTS: Array<{ value: OutputDto['chatMascot']; label: string; hint: string }> = [
  { value: 'hop', label: '先在框中间露脸', hint: '弹幕进来时，小八先在头像框中间出现约 1 秒，再移到头像右下角' },
  { value: 'corner', label: '一直在右下角', hint: '头像一开始就显示，小八从头像后面探出，停在右下角' },
  { value: 'off', label: '不显示', hint: '' },
];
const themed = computed(() => v.value.chatLook !== 'glass');
/** 气泡浓淡：0 为跟随外观，滑块显示外观的默认值 */
const alphaShown = computed(() => (v.value.chatLook !== 'glass' ? v.value.chatAlpha || CHAT_LOOK_ALPHA[v.value.chatLook] : 0));
const num = (e: Event) => Number((e.target as HTMLInputElement).value);
function setMax(x: number): void {
  const n = Math.round(x);
  if (!(n >= 1 && n <= CHAT_MAX_LIMIT)) return toast(`条数要在 1 – ${CHAT_MAX_LIMIT} 之间`, 'err');
  look.set({ chatMax: n });
}

// ---------- 显示什么：改了马上生效 ----------
function setMedal(m: OutputDto['chatMedal']): void {
  if (m !== o.value?.chatMedal) void save({ chatMedal: m }, m === 'own' ? '弹幕列表只显示本直播间的粉丝牌' : '弹幕列表显示观众戴着的粉丝牌');
}
/** 自动消失：0 为一直显示；打开时用上次选的秒数（默认 10 秒） */
const lastFade = ref(10);
watch(() => o.value?.chatFadeSec ?? 0, (x) => x && (lastFade.value = x), { immediate: true });
function setFade(x: number): void {
  if (x !== o.value?.chatFadeSec) void save({ chatFadeSec: x }, x ? `没人发弹幕 ${x} 秒后，弹幕开始依次消失` : '弹幕一直显示，只被新弹幕顶走');
}
function setHideBlocked(x: boolean): void {
  void save({ chatHideBlocked: x }, x ? '黑名单里的人发的弹幕不再显示在弹幕列表' : '弹幕列表显示所有人的弹幕');
}

// ---------- 预览 ----------
const pv = ref<InstanceType<typeof ChatPreview> | null>(null);
const src = ref<InstanceType<typeof SourceCard> | null>(null);
const alphaBg = ref(false);
const online = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && x.role === 'chat').length);
</script>

<template>
  <section v-if="o && cfg" class="page">
    <div class="page-head">
      <div><h1>弹幕列表</h1><p>所有人的弹幕排成一列，显示在直播画面上。</p></div>
      <div class="wp-head-r">
        <select v-if="state.outputs.length > 1" class="sel" aria-label="输出" :value="o.id" @change="pickOutput"><option v-for="x in state.outputs" :key="x.id" :value="x.id">{{ x.name }}</option></select>
        <span class="live" :class="o.chatEnabled && online ? '' : 'off'"><i />{{ !o.chatEnabled ? '已关闭' : online ? '直播软件里已加上' : '直播软件里还没加' }}</span>
        <button class="btn" :title="`在直播软件里加一个浏览器源，宽高填 ${wh.w} × ${wh.h}`" @click="src?.copy()"><Icon name="i-copy" />复制地址</button>
        <Switch :model-value="o.chatEnabled" label="弹幕列表开关" @change="(x) => save({ chatEnabled: x }, x ? '已打开弹幕列表' : '已关闭弹幕列表：直播画面上不再显示')" />
      </div>
    </div>

    <div class="wp-grid">
      <div class="wp-col">
        <div class="card" :class="{ dimmed: !o.chatEnabled }">
          <div class="card-h"><h2><span class="hicon"><Icon name="i-todo" /></span>显示什么</h2></div>
          <div class="srows">
            <div class="srow">
              <span class="lb">粉丝牌</span>
              <div class="ctl">
                <Seg :model-value="o.chatMedal" label="粉丝牌" :options="[{ value: 'own', label: '只显示本直播间的' }, { value: 'all', label: '戴什么显示什么' }]" @change="setMedal" />
                <span class="hint">{{ o.chatMedal === 'own' ? '戴别的直播间粉丝牌的观众，不显示牌子' : '和 B站直播间里一样，戴哪个牌子显示哪个' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">自动消失</span>
              <div class="ctl">
                <div class="line">
                  <Switch :model-value="o.chatFadeSec > 0" label="弹幕自动消失" @change="(x) => setFade(x ? lastFade : 0)" />
                  <template v-if="o.chatFadeSec > 0">
                    <span class="hint">没人发弹幕</span>
                    <CdPick :model-value="o.chatFadeSec" unit="sec" :options="CHAT_FADE_OPTIONS" :max="CHAT_FADE_MAX" :allow-zero="false" hint="最后一条弹幕之后过多久开始消失" after="后开始消失" @change="setFade" />
                  </template>
                </div>
                <span class="hint">{{ o.chatFadeSec > 0 ? '从最旧的一条开始，每 2 秒淡出一条；有新弹幕时重新计时' : '弹幕一直显示，只被新弹幕顶走' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">黑名单</span>
              <div class="ctl">
                <div class="line"><Switch :model-value="o.chatHideBlocked" label="黑名单里的人不显示在弹幕列表" @change="setHideBlocked" /><span class="hint">不显示黑名单里的人发的弹幕（例如欢迎机器人）</span></div>
                <a class="linkish wp-link" href="#settings" @click.prevent="go('settings')">管理黑名单 →</a>
              </div>
            </div>
          </div>
        </div>
        <SourceCard ref="src" name="弹幕列表" :path="o.chatPath" :secret="o.key" :w="wh.w" :h="wh.h" />
      </div>

      <div class="card">
        <div class="card-h"><h2><span class="hicon"><Icon name="i-eye" /></span>预览</h2><span class="aside">只在这里显示</span></div>
        <div class="wp-pv"><ChatPreview ref="pv" :key="`c${o.id}`" :config="cfg" :alpha="alphaBg" /></div>
        <div class="prev-tools">
          <button class="btn" :disabled="!o.chatEnabled" @click="pv?.test('normal')"><i style="background: var(--nor)" />测试弹幕</button>
          <button class="btn" :disabled="!o.chatEnabled" @click="pv?.test('guard')"><i style="background: var(--gov)" />大航海发言</button>
          <span class="prev-bg"><span>背景</span><Seg :model-value="alphaBg ? 'alpha' : 'game'" label="预览背景" :options="[{ value: 'game', label: '游戏画面' }, { value: 'alpha', label: '透明' }]" @change="(x) => (alphaBg = x === 'alpha')" /></span>
        </div>

        <h3 class="wp-sub">外观</h3>
        <div class="srows" :class="{ dimmed: !o.chatEnabled }">
          <div class="srow">
            <span class="lb">样式</span>
            <div class="ctl">
              <span class="seg wrap" role="group" aria-label="样式">
                <button v-for="x in LOOKS" :key="x.value" :aria-pressed="v.chatLook === x.value" @click="look.set({ chatLook: x.value })">{{ x.label }}</button>
              </span>
              <span class="hint">{{ LOOKS.find((x) => x.value === v.chatLook)?.hint }}</span>
            </div>
          </div>
          <template v-if="themed">
            <div class="srow">
              <span class="lb">小八出场</span>
              <div class="ctl">
                <span class="seg wrap" role="group" aria-label="小八出场">
                  <button v-for="x in MASCOTS" :key="x.value" :aria-pressed="v.chatMascot === x.value" @click="look.set({ chatMascot: x.value })">{{ x.label }}</button>
                </span>
                <span v-if="MASCOTS.find((x) => x.value === v.chatMascot)?.hint" class="hint">{{ MASCOTS.find((x) => x.value === v.chatMascot)?.hint }}</span>
              </div>
            </div>
            <div v-if="v.chatLook === 'cream'" class="srow">
              <span class="lb">头像框</span>
              <div class="ctl">
                <Seg :model-value="v.chatCreamFrame" label="奶油贴纸的头像框" :options="[{ value: 'hachi', label: '小八风' }, { value: 'lace', label: '格子花边' }]" @change="(x) => look.set({ chatCreamFrame: x })" />
              </div>
            </div>
            <div class="srow">
              <span class="lb">大航海头像框</span>
              <div class="ctl">
                <Seg :model-value="v.chatGuardFrame" label="大航海头像框" :options="[{ value: 'theme', label: '主题头像框' }, { value: 'bili', label: 'B站头像框' }]" @change="(x) => look.set({ chatGuardFrame: x })" />
                <span class="hint">{{ v.chatGuardFrame === 'theme' ? '按身份区分颜色，并加上星星或皇冠' : '加载不了时改用主题头像框；其他观众照样用主题头像框' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">气泡浓淡</span>
              <div class="ctl">
                <div class="slider-row"><label for="cAlpha">底色</label><input id="cAlpha" :value="alphaShown" type="range" :min="CHAT_ALPHA_MIN" :max="CHAT_ALPHA_MAX" step="5" @input="look.set({ chatAlpha: num($event) })" /><output>{{ alphaShown }}%</output></div>
                <div class="line"><button class="btn sm" type="button" :disabled="v.chatAlpha === 0" @click="look.set({ chatAlpha: 0 })">跟随外观</button><span class="hint">{{ v.chatAlpha === 0 ? `当前跟随外观（${alphaShown}%）` : '已自定义' }}</span></div>
              </div>
            </div>
          </template>
          <div class="srow">
            <span class="lb">对齐</span>
            <div class="ctl">
              <Seg :model-value="v.chatSide" label="对齐" :options="[{ value: 'left', label: '靠左' }, { value: 'right', label: '靠右' }]" @change="(x) => look.set({ chatSide: x })" />
              <span class="hint">放在画面右边时选靠右，头像跟着换边</span>
            </div>
          </div>
          <div class="srow">
            <span class="lb">字号</span>
            <div class="ctl">
              <Seg :model-value="v.chatSize" label="字号" :options="[{ value: 'normal', label: '标准' }, { value: 'large', label: '大' }]" @change="(x) => look.set({ chatSize: x })" />
            </div>
          </div>
          <div class="srow">
            <span class="lb">条数</span>
            <div class="ctl">
              <div class="line">
                <span class="stepper">
                  <button type="button" aria-label="少一条" :disabled="v.chatMax <= 1" @click="setMax(v.chatMax - 1)">−</button>
                  <input :key="`${o.id}-${v.chatMax}`" class="inp num" type="number" min="1" :max="CHAT_MAX_LIMIT" :value="v.chatMax" aria-label="最多显示几条" @change="(e) => setMax(num(e))" />
                  <button type="button" aria-label="多一条" :disabled="v.chatMax >= CHAT_MAX_LIMIT" @click="setMax(v.chatMax + 1)">+</button>
                </span>
                <span class="hint">最多 {{ CHAT_MAX_LIMIT }} 条；条数和字号决定浏览器源的高度</span>
              </div>
            </div>
          </div>
        </div>
        <DraftBar :dirty="look.dirty.value" :saving="look.saving.value" @save="look.commit" @discard="look.reset" />
      </div>
    </div>
  </section>
</template>
