<script setup lang="ts">
// 「加到直播软件」卡片：浏览器源地址（访问密钥默认打码）、复制、宽高、在浏览器里查看。弹幕列表、送礼名单页用
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import { toast } from '../lib/toast.ts';

const props = defineProps<{ name: string; path: string; secret: string; w: number; h: number }>();
const show = ref(false);
const full = computed(() => `${location.origin}${props.path}`);
const shown = computed(() => (show.value ? full.value : full.value.replace(props.secret, '••••••••••')));
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(full.value);
    toast(`已复制${props.name}地址，宽高填 ${props.w} × ${props.h}`);
  } catch {
    show.value = true;
    toast('浏览器不允许自动复制，请手动选中地址复制', 'info');
  }
}
defineExpose({ copy });
</script>

<template>
  <div class="card">
    <div class="card-h"><h2><span class="hicon"><Icon name="i-screen" /></span>加到直播软件</h2><span class="aside">地址里带访问密钥，不要公开</span></div>
    <p class="src-how">在直播软件里添加一个<b>浏览器</b>来源，粘贴下面的地址，宽高填 <code>{{ w }} × {{ h }}</code></p>
    <div class="src-url">
      <input class="inp" :value="shown" readonly :aria-label="`${name}地址`" @focus="(e) => show && (e.target as HTMLInputElement).select()" />
      <button class="btn primary" @click="copy"><Icon name="i-copy" />复制地址</button>
      <button class="btn ic" :title="show ? '隐藏密钥' : '显示密钥'" :aria-label="show ? '隐藏密钥' : '显示密钥'" @click="show = !show"><Icon :name="show ? 'i-eye-off' : 'i-eye'" /></button>
    </div>
    <a class="linkish src-view" :href="`${path}&view=1`" target="_blank" rel="noopener" title="深色背景，只用来查看；直播软件里请用上面的地址">在浏览器里查看<Icon name="i-ext" /></a>
  </div>
</template>

<style scoped>
.src-how { margin: 0 0 12px; font-size: var(--fs-sec); color: var(--t2); }
.src-how code { font-variant-numeric: tabular-nums; font-size: var(--fs-cap); padding: 1px 6px; border-radius: var(--r-xs); background: var(--hover); color: var(--t1); }
.src-view { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; font-size: var(--fs-sec); }
.src-view svg.i { width: 13px; height: 13px; }
</style>
