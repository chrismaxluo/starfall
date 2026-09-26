<script setup lang="ts">
// 弹幕规则（F-DM-01 ~ 04）：关键词、匹配方式、发送人条件、素材、全局 / 每人冷却；从上到下匹配，可调整顺序
import { computed, nextTick, ref } from 'vue';
import { DANMU_WHO_NAMES } from '@starfall/shared/labels';
import { del, post, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { DanmuRule, DanmuWho } from '../lib/types.ts';
import CdPick from './CdPick.vue';
import ConfirmButton from './ConfirmButton.vue';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import Switch from './Switch.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
const flash = ref<number | null>(null);
const list = ref<HTMLElement | null>(null);
const WHO = Object.entries(DANMU_WHO_NAMES) as Array<[DanmuWho, string]>;

async function patch(r: DanmuRule, p: Partial<DanmuRule>, msg?: string): Promise<void> {
  const res = await attempt(() => put<DanmuRule>(`/api/rules/danmu/${r.id}`, p), msg);
  if (res) Object.assign(r, res);
  void refreshEffects();
}
/** 常用的几条，点一下直接添加，之后可以改 */
const TEMPLATES = [
  { name: '生日快乐', keywords: ['生日快乐', '生快'] },
  { name: '晚安', keywords: ['晚安'] },
  { name: '签到', keywords: ['签到', '打卡'] },
  { name: '主播好', keywords: ['主播好', '晚上好'] },
];
const unusedTemplates = computed(() => TEMPLATES.filter((t) => !state.danmu.some((r) => r.keywords.includes(t.keywords[0]!))));
const defaultEffect = () => state.effects.find((e) => e.name === '弹幕回应')?.id ?? state.effects[0]?.id ?? null;
async function add(keywords: string[] = ['关键词']): Promise<void> {
  const r = await attempt(() => post<DanmuRule>('/api/rules/danmu', { keywords, mode: 'contains', who: 'all', effectId: defaultEffect(), globalCdSec: 10, userCdMin: 10, enabled: true }));
  if (!r) return;
  state.danmu.push(r);
  flash.value = r.id;
  void refreshEffects();
  if (keywords[0] !== '关键词') return toast(`已添加：弹幕里有「${keywords.join('」或「')}」时播放`, 'ok');
  toast('已添加弹幕规则，先把「关键词」换成你想要的词', 'info');
  await nextTick();
  const inputs = list.value?.querySelectorAll<HTMLInputElement>('.kwin');
  inputs?.[inputs.length - 1]?.focus();
}
async function remove(r: DanmuRule): Promise<void> {
  if (await attempt(() => del(`/api/rules/danmu/${r.id}`), '已删除弹幕规则')) {
    state.danmu = state.danmu.filter((x) => x.id !== r.id);
    void refreshEffects();
  }
}
async function move(i: number, d: -1 | 1): Promise<void> {
  const ids = state.danmu.map((r) => r.id);
  [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
  const res = await attempt(() => put<{ rules: DanmuRule[] }>('/api/rules/danmu/order', { ids }));
  if (res) state.danmu = res.rules;
}
/** 添加关键词；同一关键词在别的规则里也有时提示（F-DM-04） */
async function addKeyword(r: DanmuRule, e: KeyboardEvent): Promise<void> {
  const el = e.target as HTMLInputElement;
  const v = el.value.trim();
  if (!v) return;
  el.value = '';
  // 新规则的占位词"关键词"在输入第一个真正的词时替换掉
  const base = r.keywords.length === 1 && r.keywords[0] === '关键词' ? [] : r.keywords;
  if (base.includes(v)) return;
  await patch(r, { keywords: [...base, v] });
  const other = state.danmu.findIndex((x) => x.id !== r.id && x.keywords.includes(v));
  if (other >= 0) toast(`「${v}」也在第 ${other + 1} 条规则里，排在前面的那条优先`, 'info', 4000);
  await nextTick();
  (list.value?.querySelectorAll<HTMLInputElement>('.kwin')[state.danmu.indexOf(r)])?.focus();
}
function removeKeyword(r: DanmuRule, k: string): void {
  if (r.keywords.length === 1) return toast('至少保留一个关键词，不需要可以删除整条规则', 'info');
  void patch(r, { keywords: r.keywords.filter((x) => x !== k) });
}
function setCd(r: DanmuRule, key: 'globalCdSec' | 'userCdMin', v: number): void {
  void patch(r, { [key]: v }, key === 'globalCdSec' ? (v ? `全场 ${v} 秒内不重复` : '全场不限次数') : v ? `同一个人 ${v} 分钟内不重复` : '同一个人不限次数');
}
function preview(r: DanmuRule): void {
  emit('preview', { effectId: r.effectId, viewer: r.who === 'guard' ? SAMPLES.cap : r.who === 'mod' ? SAMPLES.mod : SAMPLES.fan, label: `弹幕「${r.keywords[0]}」`, kind: 'danmu', vars: { text: r.keywords[0] } });
}
const clashes = computed(() => {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const r of state.danmu) {
    for (const k of r.keywords) {
      if (seen.has(k)) out.add(k);
      else seen.set(k, r.id);
    }
  }
  return out;
});
</script>

<template>
  <div>
    <div class="rl-flow"><span>弹幕里有关键词就播放。多条规则都符合时，用排在最上面的一条，可以用箭头调整顺序。</span></div>
    <div class="rl-sec"><h3>关键词</h3><span v-if="state.danmu.length">{{ state.danmu.length }} 条</span><span class="r"><button class="btn primary" @click="add()"><Icon name="i-plus" />新建弹幕规则</button></span></div>
    <div ref="list" class="rl-list">
      <div v-for="(r, i) in state.danmu" :key="r.id" class="rl" :class="{ off: !r.enabled, flash: flash === r.id }">
        <span class="who"><span class="tag dm">弹幕</span></span>
        <span class="say">
          弹幕
          <select class="sel sm" :value="r.mode" aria-label="匹配方式" @change="(e) => patch(r, { mode: (e.target as HTMLSelectElement).value as DanmuRule['mode'] }, '已修改匹配方式')">
            <option value="contains">里有</option><option value="exact">就是</option>
          </select>
          <span class="kwchips">
            <span v-for="(k, ki) in r.keywords" :key="k" class="kwwrap"><i v-if="ki" class="or">或</i><span class="kw" :title="clashes.has(k) ? '这个关键词也在别的规则里，排在前面的优先' : ''" :style="clashes.has(k) ? 'box-shadow: inset 0 0 0 1px var(--gov)' : ''">
              {{ k }}<button :aria-label="`删除关键词 ${k}`" @click="removeKeyword(r, k)"><Icon name="i-x" style="width: 11px; height: 11px" /></button>
            </span></span>
            <input class="kwin" placeholder="+ 关键词，回车" aria-label="添加关键词" maxlength="30" @keydown.enter.prevent="(e) => addKeyword(r, e)" />
          </span>
          时，播放 <EffectPicker v-model="r.effectId" @change="(id) => ((flash = r.id), patch(r, { effectId: id }, `改为播放「${effectById(id)?.name}」`))" />
          <span class="line2">
            <select class="sel sm" :value="r.who" aria-label="谁发的弹幕才算" @change="(e) => patch(r, { who: (e.target as HTMLSelectElement).value as DanmuWho }, '已修改谁发的弹幕才算')">
              <option v-for="[k, name] in WHO" :key="k" :value="k">{{ name }}</option>
            </select>
            发的才算；全场 <CdPick :model-value="r.globalCdSec" unit="sec" hint="不管谁发，这段时间里只播一次" @change="(v) => setCd(r, 'globalCdSec', v)" /> 内、同一个人 <CdPick :model-value="r.userCdMin" hint="同一个人这段时间里再发，不重复播放" @change="(v) => setCd(r, 'userCdMin', v)" /> 内不重复
          </span>
          <span v-if="!r.enabled" class="offnote">已关闭：这条规则不起作用</span>
        </span>
        <span class="acts">
          <button class="playmini" aria-label="上移（先匹配）" :disabled="i === 0" @click="move(i, -1)"><Icon name="i-up" /></button>
          <button class="playmini" aria-label="下移" :disabled="i === state.danmu.length - 1" @click="move(i, 1)"><Icon name="i-down" /></button>
          <button class="playmini" :aria-label="`预览弹幕「${r.keywords[0]}」`" @click="preview(r)"><svg><use href="#i-play" /></svg></button>
          <ConfirmButton label="" confirm-label="删除" cls="playmini" armed-cls="delb" aria-label="删除这条规则" @confirm="remove(r)"><Icon name="i-x" /></ConfirmButton>
          <Switch v-model="r.enabled" :label="`弹幕规则 ${i + 1}`" @change="(v) => patch(r, { enabled: v }, v ? '已打开这条弹幕规则' : '已关闭这条弹幕规则')" />
        </span>
      </div>
    </div>
    <div v-if="!state.danmu.length" class="rl-empty">
      <h4>还没有弹幕规则</h4>
      <p>观众发的弹幕里有某个词时播放特效。点一个常用的直接添加，之后可以改：</p>
      <div class="tpls">
        <button v-for="t in TEMPLATES" :key="t.name" type="button" @click="add([...t.keywords])"><b>{{ t.name }}</b><span>{{ t.keywords.join('、') }}</span></button>
      </div>
    </div>
    <div v-else-if="unusedTemplates.length" class="rl-more">常用：<button v-for="t in unusedTemplates" :key="t.name" class="btn" @click="add([...t.keywords])">+ {{ t.name }}</button></div>
  </div>
</template>
