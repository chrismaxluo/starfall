<script setup lang="ts">
// 素材快捷播放的按钮：big 为「素材快捷播放」页面的大按钮，否则是总览上的一排小按钮
import { computed } from 'vue';
import { pressed, playQuick, quickName } from '../lib/quick.ts';
import { effectById, state } from '../lib/store.ts';
import type { QuickButton } from '../lib/types.ts';
import EffThumb from './EffThumb.vue';
import Icon from './Icon.vue';

defineProps<{ big?: boolean }>();
const playing = computed(() => (state.queue.playing?.quick ? state.queue.playing.effectName : null));
const isOn = (b: QuickButton) => playing.value !== null && effectById(b.effectId)?.name === playing.value;
/** 现在按了也播不出来的原因 */
const blocked = computed(() => (state.status?.paused ? '已暂停所有特效，恢复播放后才能用快捷播放' : state.status && state.status.overlays === 0 ? '特效页不在线，直播软件里加上特效页后才能播放' : null));
const tip = (b: QuickButton) => `播放「${effectById(b.effectId)?.name ?? '素材已删除'}」${b.hotkey ? `（快捷键 ${b.hotkey}）` : ''}`;
</script>

<template>
  <div v-if="blocked" class="qp-warn"><Icon name="i-info" />{{ blocked }}<a v-if="!state.status?.paused" class="linkish" href="#obs">去看看 →</a></div>
  <div class="qp" :class="{ big }">
    <button v-for="b in state.quick" :key="b.id" type="button" class="qp-btn" :class="{ on: isOn(b), hit: pressed === b.id }" :title="tip(b)" @click="playQuick(b)">
      <EffThumb :effect="effectById(b.effectId)" />
      <span class="qp-name">{{ quickName(b) }}</span>
      <span v-if="b.hotkey" class="kbd" aria-hidden="true">{{ b.hotkey }}</span>
      <span v-if="isOn(b)" class="qp-live" aria-label="正在播放"><i /></span>
    </button>
  </div>
</template>
