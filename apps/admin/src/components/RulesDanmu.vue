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
async function add(): Promise<void> {
  const eff = state.effects.find((e) => e.name === '弹幕回应')?.id ?? state.effects[0]?.id ?? null;
  const r = await attempt(() => post<DanmuRule>('/api/rules/danmu', { keywords: ['关键词'], mode: 'contains', who: 'all', effectId: eff, globalCdSec: 10, userCdMin: 10, enabled: true }));
  if (!r) return;
  state.danmu.push(r);
  flash.value = r.id;
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
function setCd(r: DanmuRule, key: 'globalCdSec' | 'userCdMin', e: Event): void {
  const el = e.target as HTMLInputElement;
  const v = Math.max(0, Math.min(key === 'globalCdSec' ? 3600 : 1440, Math.round(Number(el.value) || 0)));
  el.value = String(v);
  if (v !== r[key]) void patch(r, { [key]: v }, key === 'globalCdSec' ? `全局冷却 ${v} 秒` : `每人冷却 ${v} 分钟`);
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
    <div class="subbar">
      <span class="subhint">观众发的弹幕命中关键词就播放。从上到下匹配，命中第一条就停止；上下箭头可以调整顺序。</span>
      <button class="btn primary" style="margin-left: auto" @click="add"><Icon name="i-plus" />添加弹幕规则</button>
    </div>
    <div ref="list" class="tlist">
      <div v-for="(r, i) in state.danmu" :key="r.id" class="rcard" :class="{ off: !r.enabled, flash: flash === r.id }">
        <div class="l1">
          <span class="prio">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="lead">弹幕</span>
          <select class="sel sm" :value="r.mode" aria-label="匹配方式" @change="(e) => patch(r, { mode: (e.target as HTMLSelectElement).value as DanmuRule['mode'] })">
            <option value="contains">包含</option><option value="exact">完全一致</option>
          </select>
          <span class="kwchips">
            <span v-for="k in r.keywords" :key="k" class="kw" :title="clashes.has(k) ? '这个关键词也在别的规则里，排在前面的优先' : ''" :style="clashes.has(k) ? 'box-shadow: inset 0 0 0 1px var(--gov)' : ''">
              {{ k }}<button :aria-label="`删除关键词 ${k}`" @click="removeKeyword(r, k)"><Icon name="i-x" style="width: 11px; height: 11px" /></button>
            </span>
            <input class="kwin" placeholder="+ 关键词，回车" aria-label="添加关键词" maxlength="30" @keydown.enter.prevent="(e) => addKeyword(r, e)" />
          </span>
          <span class="tail">
            <button class="mvb" aria-label="上移" :disabled="i === 0" @click="move(i, -1)"><Icon name="i-up" style="width: 14px; height: 14px" /></button>
            <button class="mvb" aria-label="下移" :disabled="i === state.danmu.length - 1" @click="move(i, 1)"><Icon name="i-down" style="width: 14px; height: 14px" /></button>
            <Switch v-model="r.enabled" :label="`启用弹幕规则 ${i + 1}`" @change="(v) => patch(r, { enabled: v }, v ? '已启用' : '已停用')" />
            <button class="playmini" aria-label="在右侧预览" @click="preview(r)"><svg><use href="#i-play" /></svg></button>
            <ConfirmButton label="" confirm-label="确认删除" cls="moreb" aria-label="删除这条规则" @confirm="remove(r)"><Icon name="i-x" /></ConfirmButton>
          </span>
        </div>
        <div class="l2">
          <span class="grp">发送人
            <select class="sel sm" :value="r.who" aria-label="发送人" @change="(e) => patch(r, { who: (e.target as HTMLSelectElement).value as DanmuWho })">
              <option v-for="[k, name] in WHO" :key="k" :value="k">{{ name }}</option>
            </select>
          </span>
          <span class="grp eff">→ 播放
            <EffectPicker v-model="r.effectId" @change="(id) => ((flash = r.id), patch(r, { effectId: id }, `已换成素材「${effectById(id)?.name}」`), preview(r))" />
          </span>
          <span class="grp">全局冷却
            <span class="cdin" style="width: 84px"><input type="number" min="0" max="3600" :value="r.globalCdSec" aria-label="全局冷却秒" @change="(e) => setCd(r, 'globalCdSec', e)" /><span>秒</span></span>
          </span>
          <span class="grp">每人冷却
            <span class="cdin" style="width: 92px"><input type="number" min="0" max="1440" :value="r.userCdMin" aria-label="每人冷却分钟" @change="(e) => setCd(r, 'userCdMin', e)" /><span>分钟</span></span>
          </span>
        </div>
      </div>
      <div v-if="!state.danmu.length" class="soon-box"><b>还没有弹幕规则</b>点右上角「添加弹幕规则」，例如观众发"生日快乐"时播放一段特效</div>
    </div>
  </div>
</template>
