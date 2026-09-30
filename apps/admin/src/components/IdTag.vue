<script setup lang="ts">
// 观众身份标签：主播 / 大航海 / 房管 / 本直播间粉丝牌 / 普通。
// 传 viewer 时和 B 站弹幕里一样都显示：大航海又是房管，后面加一个「房」；大航海、房管戴着本直播间的粉丝牌，粉丝牌也显示
import { computed, ref } from 'vue';
import { isOwnMedal } from '@starfall/shared';
import { IDENTITY, identityOf, isAnchor } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { state } from '../lib/store.ts';
import type { Viewer } from '../lib/types.ts';
import Icon from './Icon.vue';
import Medal from './Medal.vue';

const props = defineProps<{ viewer?: Viewer; identity?: Identity; level?: number }>();
const anchorUid = computed(() => state.status?.room?.anchorUid);
const id = computed<Identity>(() => props.identity ?? (props.viewer ? identityOf(props.viewer, anchorUid.value) : 'nor'));
/** 主播本人：只显示「主播」 */
const anchor = computed(() => !props.identity && Boolean(props.viewer) && isAnchor(props.viewer!, anchorUid.value));
const guard = computed(() => id.value === 'gov' || id.value === 'adm' || id.value === 'cap');
/** 大航海又是房管 */
const alsoMod = computed(() => Boolean(props.viewer?.isMod) && guard.value);
/** 大航海、房管戴着本直播间的粉丝牌（只有粉丝牌的人本来就显示粉丝牌） */
const alsoMedal = computed(() => {
  const v = props.viewer;
  if (!v || (!guard.value && id.value !== 'mod')) return false;
  return anchorUid.value === undefined ? Boolean(v.medal && v.medal.level > 0) : isOwnMedal(v, anchorUid.value);
});
// 官方图标加载失败（断网、B 站改了地址）时换回自绘图标
const broken = ref(new Set<string>());
</script>

<template>
  <span class="idtags">
    <span v-if="anchor" class="tag anchor">主播</span>
    <template v-else>
      <Medal v-if="id === 'fan'" :name="viewer?.medal?.name" :level="viewer?.medal?.level ?? level ?? 1" :colors="viewer?.medal?.colors" />
      <span v-else class="tag" :class="id">
        <img v-if="IDENTITY[id].badge && !broken.has(id)" class="badge" :src="IDENTITY[id].badge" alt="" referrerpolicy="no-referrer" @error="broken = new Set(broken).add(id)" />
        <i v-else-if="id === 'mod'" class="fang" aria-hidden="true">房</i>
        <Icon v-else-if="IDENTITY[id].icon" :name="IDENTITY[id].icon!" />{{ IDENTITY[id].name }}
      </span>
      <i v-if="alsoMod" class="fang solo" title="房管">房</i>
      <Medal v-if="alsoMedal" :name="viewer!.medal!.name" :level="viewer!.medal!.level" :colors="viewer!.medal!.colors" :guard="guard" />
    </template>
  </span>
</template>
