<script setup lang="ts">
// 特效的缩略画面（小图，选特效的地方用）：内置样式、图片马上显示，视频 / SVGA / Lottie 取到一帧后再换上；取不到时显示色块
import { ref, watch } from 'vue';
import { ASSET_SWATCH, STYLES } from '../lib/identity.ts';
import { quickThumb, thumbOf } from '../lib/thumbs.ts';
import type { EffectDto } from '../lib/types.ts';
import Icon from './Icon.vue';

const props = defineProps<{ effect?: EffectDto | undefined }>();
const src = ref<string | null>(quickThumb(props.effect, true));
const failed = ref(false);
watch(
  () => props.effect?.visual.type === 'builtin_style' ? props.effect.visual.style : props.effect?.asset?.url,
  () => {
    failed.value = false;
    src.value = quickThumb(props.effect, true);
    if (!src.value) void thumbOf(props.effect, true).then((s) => (src.value = s));
  },
  { immediate: true },
);
const swatch = () => (props.effect?.visual.type === 'builtin_style' ? (STYLES[props.effect.visual.style]?.grad ?? ASSET_SWATCH) : ASSET_SWATCH);
</script>

<template>
  <span class="effthumb" :style="src && !failed ? undefined : { background: effect ? swatch() : 'var(--hover)' }">
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" @error="failed = true" />
    <Icon v-else-if="effect && effect.visual.type === 'asset'" name="i-image" />
  </span>
</template>
