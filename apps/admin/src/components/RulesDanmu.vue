<script setup lang="ts">
// 弹幕规则（F-DM-01 ~ 04）：关键词、匹配方式、发送人条件、素材、所有人 / 每人多久内只播一次；从上到下匹配，可调整顺序
import { computed, nextTick, ref } from 'vue';
import { DANMU_WHO_ALL } from '@starfall/shared';
import { shadowedKeywords } from '@starfall/core/danmu';
import { del, post, put } from '../lib/api.ts';
import { sampleFor } from '../lib/danmu-who.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, refreshRules, state } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { DanmuRule, DanmuRuleDto, DanmuWho } from '../lib/types.ts';
import CdPick from './CdPick.vue';
import ConfirmButton from './ConfirmButton.vue';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import Switch from './Switch.vue';
import WhoPick from './WhoPick.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
const flash = ref<number | null>(null);
const list = ref<HTMLElement | null>(null);

async function patch(r: DanmuRuleDto, p: Partial<DanmuRule>, msg?: string): Promise<void> {
  const res = await attempt(() => put<DanmuRuleDto>(`/api/rules/danmu/${r.id}`, p), msg);
  if (res) Object.assign(r, res);
  // 保存失败：开关、选择框已经在界面上改了，重新读回服务端的真实状态
  else void refreshRules().catch(() => undefined);
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
const defaultEffect = () => state.effects.find((e) => e.name === '晶语')?.id ?? state.effects[0]?.id ?? null;
/** 一条规则最多几个关键词（和服务端一致） */
const KEYWORD_MAX = 20;
/** 一次输入或粘贴多个词：逗号、顿号、分号、空格都当分隔 */
const splitWords = (v: string) => [...new Set(v.split(/[,，、;；\s]+/).map((x) => x.trim().slice(0, 30)).filter(Boolean))];
async function add(keywords: string[]): Promise<boolean> {
  const r = await attempt(() => post<DanmuRuleDto>('/api/rules/danmu', { keywords, mode: 'contains', who: DANMU_WHO_ALL, effectId: defaultEffect(), globalCdSec: 10, userCdMin: 10, enabled: true }));
  if (!r) return false;
  state.danmu.push(r);
  flash.value = r.id;
  void refreshEffects();
  toast(`已添加：弹幕里有「${keywords.join('」或「')}」时播放`, 'ok');
  return true;
}
// 新建规则先是一张草稿卡：填了关键词才真正保存，免得没填完的规则在直播里起作用
const draft = ref(false);
const draftIn = ref<HTMLInputElement | null>(null);
async function startDraft(): Promise<void> {
  draft.value = true;
  await nextTick();
  draftIn.value?.focus();
}
async function saveDraft(): Promise<void> {
  const words = splitWords(draftIn.value?.value ?? '');
  if (!words.length) return toast('先填一个关键词，例如「晚安」', 'info');
  if (words.length > KEYWORD_MAX) return toast(`一条规则最多 ${KEYWORD_MAX} 个关键词`, 'info');
  if (await add(words)) draft.value = false;
}
async function remove(r: DanmuRuleDto): Promise<void> {
  const at = state.danmu.indexOf(r);
  if (!(await attempt(() => del(`/api/rules/danmu/${r.id}`)))) return;
  state.danmu = state.danmu.filter((x) => x.id !== r.id);
  void refreshEffects();
  undoable(`已删除弹幕规则「${r.keywords.join('」「')}」`, async () => {
    // 重新建一条一样的，再放回原来的位置
    const back = await post<DanmuRuleDto>('/api/rules/danmu', { keywords: r.keywords, mode: r.mode, who: r.who, effectId: r.effectId, globalCdSec: r.globalCdSec, userCdMin: r.userCdMin, enabled: r.enabled });
    const ids = state.danmu.map((x) => x.id);
    ids.splice(Math.min(at, ids.length), 0, back.id);
    const res = await put<{ rules: DanmuRuleDto[] }>('/api/rules/danmu/order', { ids });
    state.danmu = res.rules;
    void refreshEffects();
    toast('已恢复这条弹幕规则');
  });
}
async function move(i: number, d: -1 | 1): Promise<void> {
  const ids = state.danmu.map((r) => r.id);
  [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
  const res = await attempt(() => put<{ rules: DanmuRuleDto[] }>('/api/rules/danmu/order', { ids }));
  if (res) state.danmu = res.rules;
}
/** 添加关键词（回车或点别处都算）；同一关键词在别的规则里也有时提示（F-DM-04） */
async function addKeyword(r: DanmuRuleDto, e: Event): Promise<void> {
  const el = e.target as HTMLInputElement;
  const words = splitWords(el.value);
  if (!words.length) return;
  el.value = '';
  // 旧版本新建规则时的占位词"关键词"，在输入第一个真正的词时替换掉
  const base = r.keywords.length === 1 && r.keywords[0] === '关键词' ? [] : r.keywords;
  const fresh = words.filter((w) => !base.includes(w));
  if (!fresh.length) return;
  if (base.length + fresh.length > KEYWORD_MAX) {
    el.value = fresh.join('，');
    return toast(`一条规则最多 ${KEYWORD_MAX} 个关键词，可以再新建一条规则`, 'info');
  }
  await patch(r, { keywords: [...base, ...fresh] }, `已添加关键词「${fresh.join('」「')}」`);
  const dup = fresh.find((w) => state.danmu.some((x) => x.id !== r.id && x.keywords.includes(w)));
  if (dup) {
    const other = state.danmu.findIndex((x) => x.id !== r.id && x.keywords.includes(dup));
    toast(`「${dup}」也在第 ${other + 1} 条规则里，排在前面的那条优先`, 'info', 4000);
  }
  if (e.type !== 'keydown') return;
  await nextTick();
  (list.value?.querySelectorAll<HTMLInputElement>('.kwin')[state.danmu.indexOf(r)])?.focus();
}
function removeKeyword(r: DanmuRuleDto, k: string): void {
  if (r.keywords.length === 1) return toast('至少保留一个关键词，不需要可以删除整条规则', 'info');
  void patch(r, { keywords: r.keywords.filter((x) => x !== k) });
}
function setCd(r: DanmuRuleDto, key: 'globalCdSec' | 'userCdMin', v: number): void {
  void patch(r, { [key]: v }, key === 'globalCdSec' ? (v ? `所有人合计 ${v} 秒内只播一次` : '所有人合计：每次都播') : v ? `同一个人 ${v} 分钟内只播一次` : '同一个人：每次都播');
}
function preview(r: DanmuRuleDto): void {
  emit('preview', { effectId: r.effectId, viewer: sampleFor(r.who), label: `弹幕「${r.keywords[0]}」`, kind: 'danmu', vars: { text: r.keywords[0] } });
}
function setWho(r: DanmuRuleDto, who: DanmuWho): void {
  void patch(r, { who }, '已修改谁发的弹幕才算');
}
/** 被前面的规则抢先、永远轮不到的关键词（例如前面已经有「晚安」，这里的「晚安啦」就轮不到） */
const shadows = computed(() => shadowedKeywords(state.danmu));
const shadowed = (i: number, k: string) => shadows.value[i]?.some((x) => x.word === k) ?? false;
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
    <div class="rl-flow"><span>弹幕里有关键词就播放。多条规则都符合时，用编号最小（排在最上面）的一条，可以用箭头调整顺序。</span></div>
    <div class="rl-sec"><h3>关键词</h3><span v-if="state.danmu.length">{{ state.danmu.length }} 条</span><span class="r"><button class="btn primary" :disabled="draft" @click="startDraft"><Icon name="i-plus" />新建弹幕规则</button></span></div>
    <div ref="list" class="rl-list">
      <div v-for="(r, i) in state.danmu" :key="r.id" class="rl" :class="{ off: !r.enabled, flash: flash === r.id }">
        <span class="who"><span class="rl-no" :title="i === 0 ? '排在最上面，最先匹配' : `第 ${i + 1} 条：上面的规则都没对上时才看这条`">#{{ i + 1 }}</span></span>
        <span class="say">
          弹幕
          <select class="sel sm" :value="r.mode" aria-label="匹配方式" title="包含：弹幕里有这个词就算；整条就是：整条弹幕只能是这个词" @change="(e) => patch(r, { mode: (e.target as HTMLSelectElement).value as DanmuRule['mode'] }, '已修改匹配方式')">
            <option value="contains">包含</option><option value="exact">整条就是</option>
          </select>
          <span class="kwchips">
            <span v-for="(k, ki) in r.keywords" :key="k" class="kwwrap"><i v-if="ki" class="or">或</i><span class="kw" :title="shadowed(i, k) ? '前面的规则会先接走这个词，这条不会因为它触发' : clashes.has(k) ? '这个关键词也在别的规则里，排在前面的优先' : ''" :class="{ dim: shadowed(i, k) }" :style="clashes.has(k) || shadowed(i, k) ? 'box-shadow: inset 0 0 0 1px var(--gov)' : ''">
              {{ k }}<button :aria-label="`删除关键词 ${k}`" @click="removeKeyword(r, k)"><Icon name="i-x" style="width: 11px; height: 11px" /></button>
            </span></span>
            <input class="kwin" placeholder="+ 加关键词" title="输入后按回车或点别处就会添加；多个词用逗号或空格隔开" aria-label="添加关键词" maxlength="200" @keydown.enter.prevent="(e) => addKeyword(r, e)" @blur="(e) => addKeyword(r, e)" />
          </span>
          时，播放 <EffectPicker v-model="r.effectId" kind="danmu" @change="(id) => ((flash = r.id), patch(r, { effectId: id }, `改为播放「${effectById(id)?.name}」`))" />
          <span class="line2">
            <WhoPick :model-value="r.who" :people="r.people" :block-anchor="state.settings?.blockAnchor" @change="(w) => setWho(r, w)" />
            发的才算；所有人合计 <CdPick :model-value="r.globalCdSec" unit="sec" hint="不管谁发，这段时间里只播一次" after="内只播一次" @change="(v) => setCd(r, 'globalCdSec', v)" />，同一个人 <CdPick :model-value="r.userCdMin" hint="同一个人这段时间里再发，不重复播放" after="内只播一次" @change="(v) => setCd(r, 'userCdMin', v)" />
          </span>
          <span v-if="r.mode === 'exact'" class="line2 inline-hint">整条弹幕和关键词一样才算，例如「晚安」不包括「晚安~」「晚安啦」；英文不分大小写</span>
          <span v-for="x in shadows[i] ?? []" :key="x.word" class="line2 shadownote"><Icon name="i-info" />「{{ x.word }}」会先被 #{{ x.by + 1 }} 的「{{ x.byWord }}」接走，这条不会因为它触发；需要的话把这条往上移</span>
          <span v-if="!r.enabled" class="offnote">已关闭：这条规则不起作用</span>
        </span>
        <span class="acts">
          <button class="playmini" aria-label="上移（先匹配）" title="上移（先匹配）" :disabled="i === 0" @click="move(i, -1)"><Icon name="i-up" /></button>
          <button class="playmini" aria-label="下移" title="下移" :disabled="i === state.danmu.length - 1" @click="move(i, 1)"><Icon name="i-chev" /></button>
          <button class="playmini" :aria-label="`预览弹幕「${r.keywords[0]}」`" :title="`预览弹幕「${r.keywords[0]}」`" @click="preview(r)"><svg><use href="#i-play" /></svg></button>
          <ConfirmButton label="" confirm-label="删除" cls="playmini" armed-cls="delb" aria-label="删除这条规则" title="删除这条规则" @confirm="remove(r)"><Icon name="i-x" /></ConfirmButton>
          <Switch v-model="r.enabled" :label="`弹幕规则 ${i + 1}`" @change="(v) => patch(r, { enabled: v }, v ? '已打开这条弹幕规则' : '已关闭这条弹幕规则')" />
        </span>
      </div>
      <div v-if="draft" class="rl draft">
        <span class="who"><span class="rl-no">新</span></span>
        <span class="say">
          弹幕里有
          <input ref="draftIn" class="inp kwdraft" placeholder="输入关键词，多个用逗号隔开，例如：晚安，好梦" aria-label="新规则的关键词" maxlength="400" @keydown.enter.prevent="saveDraft" @keydown.esc="draft = false" />
          时播放特效
          <span class="line2 inline-hint">填好关键词才会保存；保存后可以再改特效、谁发的才算、多久内只播一次</span>
        </span>
        <span class="acts"><button class="btn" @click="draft = false">取消</button><button class="btn primary" @click="saveDraft">添加</button></span>
      </div>
    </div>
    <div v-if="!state.danmu.length && !draft" class="rl-empty">
      <h4>还没有弹幕规则</h4>
      <p>观众发的弹幕里有某个词时播放特效。点一个常用的直接添加，之后可以改：</p>
      <div class="tpls">
        <button v-for="t in TEMPLATES" :key="t.name" type="button" @click="add([...t.keywords])"><b>{{ t.name }}</b><span>{{ t.keywords.join('、') }}</span></button>
      </div>
    </div>
    <div v-else-if="unusedTemplates.length && !draft" class="rl-more">常用：<button v-for="t in unusedTemplates" :key="t.name" class="btn" @click="add([...t.keywords])">+ {{ t.name }}</button></div>
  </div>
</template>
