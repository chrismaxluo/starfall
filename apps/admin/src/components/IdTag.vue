<script setup lang="ts">
// 观众身份标签：大航海 / 房管 / 本直播间粉丝牌 / 普通
import { computed, ref } from 'vue';
import { IDENTITY, identityOf } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { state } from '../lib/store.ts';
import type { Viewer } from '../lib/types.ts';
import Icon from './Icon.vue';
import Medal from './Medal.vue';

const props = defineProps<{ viewer?: Viewer; identity?: Identity; level?: number }>();
const id = computed<Identity>(() => props.identity ?? (props.viewer ? identityOf(props.viewer, state.status?.room?.anchorUid) : 'nor'));
// 官方图标加载失败（断网、B 站改了地址）时换回自绘图标
const broken = ref(new Set<string>());
</script>

<template>
  <Medal v-if="id === 'fan'" :name="viewer?.medal?.name" :level="viewer?.medal?.level ?? level ?? 1" :colors="viewer?.medal?.colors" />
  <span v-else class="tag" :class="id">
    <img v-if="IDENTITY[id].badge && !broken.has(id)" class="badge" :src="IDENTITY[id].badge" alt="" referrerpolicy="no-referrer" @error="broken = new Set(broken).add(id)" />
    <Icon v-else-if="IDENTITY[id].icon" :name="IDENTITY[id].icon!" />{{ IDENTITY[id].name }}
  </span>
</template>
