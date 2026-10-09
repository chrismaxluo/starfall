<script setup lang="ts">
// 弹幕规则（F-DM-01 ~ 04）：关键词、匹配方式、发送人条件、素材、所有人 / 每人多久内只播一次；从上到下匹配，可调整顺序
import { computed, nextTick, ref } from 'vue';
import { DANMU_WHO_DEFAULT } from '@starfall/shared';
import { shadowedKeywords } from '@starfall/core/danmu';
import { del, post, put } from '../lib/api.ts';
import { sampleFor } from '../lib/danmu-who.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { effectById, refreshEffects, refreshRules, state, ui } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { DanmuRule, DanmuRuleDto, DanmuWho } from '../lib/types.ts';
import CdPick from './CdPick.vue';
import EffectPicker from './EffectPicker.vue';
import Icon from './Icon.vue';
import RowMenu from './RowMenu.vue';
import type { MenuItem } from './RowMenu.vue';
import Switch from './Switch.vue';
import WhoPick from './WhoPick.vue';

const emit = defineEmits<{ preview: [p: PreviewRequest] }>();
/** 「怎么判断」展开（由页面传进来，换标签时收起） */
const help = defineModel<boolean>('help', { default: false });
/** 列宽：编号 | 开关 | 关键词 | 谁发的 | 特效 | 冷却 | 操作 */
const COLS = '34px 44px minmax(200px, 1.4fr) minmax(120px, 190px) minmax(170px, 250px) 150px 68px';
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
const defaultEffect = () => state.effects.find((e) => e.builtin && e.visual.type === 'builtin_style' && e.visual.style === 'glass-dm')?.id ?? state.effects[0]?.id ?? null;
/** 一条规则最多几个关键词（和服务端一致） */
const KEYWORD_MAX = 20;
/** 一次输入或粘贴多个词：逗号、顿号、分号、空格都当分隔 */
const splitWords = (v: string) => [...new Set(v.split(/[,，、;；\s]+/).map((x) => x.trim().slice(0, 30)).filter(Boolean))];
async function add(keywords: string[]): Promise<boolean> {
  const r = await attempt(() => post<DanmuRuleDto>('/api/rules/danmu', { keywords, mode: 'contains', who: DANMU_WHO_DEFAULT, effectId: defaultEffect(), globalCdSec: 10, userCdMin: 10, enabled: true }));
  if (!r) return false;
  state.danmu.push(r);
  flash.value = r.id;
  void refreshEffects();
  toast(`已添加：主播、房管或大航海发的弹幕里有「${keywords.join('」或「')}」时播放（谁发的才算可以改）`, 'ok');
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
  await moveTo(i, i + d);
}
/** 把第 from 条挪到第 to 条的位置（上下箭头、拖动共用） */
async function moveTo(from: number, to: number): Promise<void> {
  if (from === to || to < 0 || to >= state.danmu.length) return;
  const ids = state.danmu.map((r) => r.id);
  const [id] = ids.splice(from, 1);
  ids.splice(to, 0, id!);
  const res = await attempt(() => put<{ rules: DanmuRuleDto[] }>('/api/rules/danmu/order', { ids }), `已把这条挪到第 ${to + 1} 条`);
  if (res) state.danmu = res.rules;
}
// 按住左边的编号拖动排序
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i;
  e.dataTransfer?.setData('text/plain', String(i));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDrop(i: number): void {
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOver.value = null;
  if (from !== null) void moveTo(from, i);
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
const menu = (r: DanmuRuleDto, i: number): Array<MenuItem | null> => [
  { icon: 'i-up', label: '往上挪（先匹配）', disabled: i === 0, run: () => void move(i, -1) },
  { icon: 'i-chev', label: '往下挪', disabled: i === state.danmu.length - 1, run: () => void move(i, 1) },
  { icon: 'i-pen', label: '调整这个特效（素材设置）', disabled: !r.effectId, run: () => (ui.editorId = r.effectId) },
  null,
  { icon: 'i-trash', label: '删除（可以撤销）', danger: true, run: () => void remove(r) },
];
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
    <div class="rtool">
      <span class="say">弹幕里有关键词就播放。多条都符合时，用排在上面的一条。<button class="linkish" :aria-expanded="help" @click="help = !help"><Icon name="i-info" />怎么判断</button></span>
      <span class="sp" />
      <button class="btn primary" :disabled="draft" @click="startDraft"><Icon name="i-plus" />新建弹幕规则</button>
    </div>
    <div v-if="help" class="rhelp">
      <b>包含</b>：弹幕里带这个词就算，例如「晚安」也包括「主播晚安啦」。<b>整条就是</b>：整条弹幕和关键词一样才算，英文不分大小写。<br />
      <b>谁发的才算</b>：可以只让主播、房管、大航海、粉丝牌或荣耀等级够的人触发，也可以指定几个人。<br />
      <b>冷却</b>：「全体」是这条规则播放后，任何人再触发都要等多久；「每人」是同一个人再触发要等多久。按住左边的编号拖动，可以调整先后顺序。
    </div>

    <div v-if="state.danmu.length || draft" ref="list" class="rt">
      <div class="rt-h" :style="{ gridTemplateColumns: COLS }"><span /><span>开关</span><span>关键词</span><span>谁发的才算</span><span>播放的特效</span><span>冷却</span><span>操作</span></div>
      <div v-for="(r, i) in state.danmu" :key="r.id" class="rt-r" :class="{ off: !r.enabled, flash: flash === r.id, dragging: dragFrom === i, dropto: dragOver === i && dragFrom !== i }" :style="{ gridTemplateColumns: COLS }" @dragover.prevent="dragFrom !== null && (dragOver = i)" @dragleave="dragOver === i && (dragOver = null)" @drop.prevent="onDrop(i)">
        <div class="c-grip" draggable="true" :title="`${i === 0 ? '排在最上面，最先匹配' : `第 ${i + 1} 条：上面的规则都没对上时才看这条`}；按住拖动可以调整顺序`" @dragstart="(e) => onDragStart(e, i)" @dragend="(dragFrom = null), (dragOver = null)"><Icon name="i-grip" />{{ i + 1 }}</div>
        <div class="c-sw"><Switch v-model="r.enabled" :label="`弹幕规则 ${i + 1}`" @change="(v) => patch(r, { enabled: v }, v ? '已打开这条弹幕规则' : '已关闭这条弹幕规则')" /></div>
        <div class="c-kw">
          <select class="sel sm" :value="r.mode" aria-label="匹配方式" title="包含：弹幕里有这个词就算；整条就是：整条弹幕只能是这个词" @change="(e) => patch(r, { mode: (e.target as HTMLSelectElement).value as DanmuRule['mode'] }, '已修改匹配方式')">
            <option value="contains">包含</option><option value="exact">整条就是</option>
          </select>
          <span v-for="k in r.keywords" :key="k" class="kw" :class="{ dim: shadowed(i, k) }" :title="shadowed(i, k) ? '前面的规则会先接走这个词，这条不会因为它触发' : clashes.has(k) ? '这个关键词也在别的规则里，排在前面的优先' : ''" :style="clashes.has(k) || shadowed(i, k) ? 'box-shadow: inset 0 0 0 1px var(--gov)' : ''">
            {{ k }}<button :aria-label="`删除关键词 ${k}`" @click="removeKeyword(r, k)"><Icon name="i-x" style="width: 10px; height: 10px" /></button>
          </span>
          <input class="kwin" placeholder="+ 关键词" title="输入后按回车或点别处就会添加；多个词用逗号或空格隔开" aria-label="添加关键词" maxlength="200" @keydown.enter.prevent="(e) => addKeyword(r, e)" @blur="(e) => addKeyword(r, e)" />
        </div>
        <div style="min-width: 0"><WhoPick :model-value="r.who" :people="r.people" :block-anchor="state.settings?.blockAnchor" @change="(w) => setWho(r, w)" /></div>
        <div class="c-eff"><EffectPicker v-model="r.effectId" kind="danmu" @change="(id) => ((flash = r.id), patch(r, { effectId: id }, `改为播放「${effectById(id)?.name}」`))" /></div>
        <div class="cd2">
          <span>全体</span><CdPick :model-value="r.globalCdSec" unit="sec" hint="不管谁发，这段时间里只播一次" @change="(v) => setCd(r, 'globalCdSec', v)" />
          <span>每人</span><CdPick :model-value="r.userCdMin" hint="同一个人这段时间里再发，不重复播放" @change="(v) => setCd(r, 'userCdMin', v)" />
        </div>
        <div class="c-act"><button class="icon-btn play" :aria-label="`预览弹幕「${r.keywords[0]}」`" :title="`预览弹幕「${r.keywords[0]}」`" @click="preview(r)"><svg><use href="#i-play" /></svg></button><RowMenu :items="menu(r, i)" :label="`第 ${i + 1} 条弹幕规则：更多操作`" /></div>
        <div v-if="shadows[i]?.length" class="c-sub">
          <span v-for="x in shadows[i]" :key="x.word" class="shadownote"><Icon name="i-info" />「{{ x.word }}」会先被第 {{ x.by + 1 }} 条的「{{ x.byWord }}」接走，这条不会因为它触发；需要的话把这条往上挪</span>
        </div>
      </div>
      <div v-if="draft" class="rt-r" :style="{ gridTemplateColumns: '34px minmax(0, 1fr) auto' }">
        <div class="c-grip" style="cursor: default">新</div>
        <div class="c-kw"><input ref="draftIn" class="inp kwdraft" placeholder="输入关键词，多个用逗号隔开，例如：晚安，好梦" aria-label="新规则的关键词" maxlength="400" @keydown.enter.prevent="saveDraft" @keydown.esc="draft = false" /><span class="inline-hint">填好关键词才会保存；保存后再改特效、谁发的才算、冷却</span></div>
        <div class="c-act" style="gap: 8px"><button class="btn" @click="draft = false">取消</button><button class="btn primary" @click="saveDraft">添加</button></div>
      </div>
      <div v-if="unusedTemplates.length && !draft" class="rt-foot">常用：<button v-for="t in unusedTemplates" :key="t.name" class="btn" @click="add([...t.keywords])">+ {{ t.name }}</button></div>
    </div>
    <div v-else class="rl-empty">
      <h4>还没有弹幕规则</h4>
      <p>观众发的弹幕里有某个词时播放特效。点一个常用的直接添加，之后可以改：</p>
      <div class="tpls">
        <button v-for="t in TEMPLATES" :key="t.name" type="button" @click="add([...t.keywords])"><b>{{ t.name }}</b><span>{{ t.keywords.join('、') }}</span></button>
      </div>
    </div>
  </div>
</template>
