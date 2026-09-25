<script setup lang="ts">
// 观众身份标签：大航海 / 房管 / 本直播间粉丝牌 / 普通
import { computed } from 'vue';
import { IDENTITY, identityOf } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { state } from '../lib/store.ts';
import type { Viewer } from '../lib/types.ts';
import Icon from './Icon.vue';
import Medal from './Medal.vue';

const props = defineProps<{ viewer?: Viewer; identity?: Identity; level?: number }>();
const id = computed<Identity>(() => props.identity ?? (props.viewer ? identityOf(props.viewer, state.status?.room?.anchorUid) : 'nor'));
</script>

<template>
  <Medal v-if="id === 'fan'" :name="viewer?.medal?.name" :level="viewer?.medal?.level ?? level ?? 1" :colors="viewer?.medal?.colors" />
  <span v-else class="tag" :class="id">
    <Icon v-if="IDENTITY[id].icon" :name="IDENTITY[id].icon!" />{{ IDENTITY[id].name }}
  </span>
</template>
