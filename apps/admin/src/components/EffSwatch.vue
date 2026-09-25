<script setup lang="ts">
import { computed } from 'vue';
import { ASSET_SWATCH, STYLES } from '../lib/identity.ts';
import type { EffectDto } from '../lib/types.ts';
import Icon from './Icon.vue';

const props = defineProps<{ effect?: EffectDto | undefined }>();
const bg = computed(() => {
  const e = props.effect;
  if (!e) return 'var(--hover)';
  return e.visual.type === 'builtin_style' ? (STYLES[e.visual.style]?.grad ?? ASSET_SWATCH) : ASSET_SWATCH;
});
</script>

<template>
  <span class="sw" :style="{ background: bg }"><Icon v-if="effect && effect.visual.type === 'asset'" name="i-image" /></span>
</template>
