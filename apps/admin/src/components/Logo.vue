<script setup lang="ts">
// 星临 logo（G2 明珠 · 玻璃 · 靛金）。32 像素及以下自动用简化版；animated="once" 时播放一次降临动画。
// 每个实例的渐变编号独立：同一页面有多个 logo、或者某个 logo 被隐藏时，其他的颜色不会丢。
import { computed, onMounted, ref, useId } from 'vue';
import full from '../assets/brand/logo.tpl.svg?raw';
import animatedTpl from '../assets/brand/logo-animated.tpl.svg?raw';
import small from '../assets/brand/logo-small.tpl.svg?raw';

const props = withDefaults(defineProps<{ size?: number; animated?: 'none' | 'once' }>(), { size: 30, animated: 'none' });
const id = `sf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
const el = ref<HTMLElement | null>(null);
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const markup = computed(() => {
  let tpl = props.size <= 32 ? small : full;
  if (props.animated === 'once' && !reduced) {
    // 只播一次：星落下后停在王冠里
    tpl = animatedTpl
      .replaceAll('repeatCount="indefinite"', 'repeatCount="1" fill="freeze"')
      .replace('values="0; 1; 1; 1; 0" keyTimes="0; .12; .32; .88; 1"', 'values="0; 1; 1" keyTimes="0; .12; 1"')
      .replaceAll('dur="4s"', 'dur="2.6s"');
  }
  return tpl.replaceAll('__ID__', id).replace('<svg ', `<svg width="${props.size}" height="${props.size}" aria-hidden="true" `);
});

onMounted(() => {
  // 插入页面时从头播放（SVG 动画的时间从页面加载开始算）
  const svg = el.value?.querySelector('svg') as (SVGSVGElement & { setCurrentTime?: (t: number) => void }) | null;
  svg?.setCurrentTime?.(0);
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 内容是打包进来的 logo 图形，不含任何用户输入 -->
  <span ref="el" class="logo" :style="{ width: `${size}px`, height: `${size}px` }" v-html="markup" />
</template>

<style>
.logo { display: inline-block; flex-shrink: 0; line-height: 0; }
.logo svg { display: block; }
</style>
