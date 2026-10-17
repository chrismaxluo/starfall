<script setup lang="ts">
// 总览上的点歌小卡片：正在放的歌、进度、暂停 / 继续、切歌、列表还有几首；网易云出问题（登录失效、会员快到期等）时右上角提醒。直播时不用切到「弹幕点歌」页
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';
import { HOLD_TEXT, mmss, music, neteaseIssues, skipSong, toggleMusicPause } from '../lib/music.ts';

const now = computed(() => music.state?.now ?? null);
const hold = computed(() => music.state?.hold ?? null);
const tick = ref(performance.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => (timer = setInterval(() => (tick.value = performance.now()), 1000)));
onBeforeUnmount(() => timer && clearInterval(timer));
const pos = computed(() => {
  const n = now.value;
  if (!n) return 0;
  return n.paused ? n.posMs : n.posMs + (tick.value - music.gotAt);
});
const issue = computed(() => neteaseIssues()[0] ?? null);
const pct = computed(() => (now.value?.item.song.durationMs ? Math.min(100, (pos.value / now.value.item.song.durationMs) * 100) : 0));
</script>

<template>
  <div class="card mm">
    <div class="card-h">
      <h2>弹幕点歌</h2>
      <span class="aside">
        <a v-if="issue" class="mm-warn" :class="issue.level" href="#music"><Icon name="i-info" />{{ issue.short }}</a>
        <span v-if="hold && hold !== 'disabled'" class="mm-hold">{{ HOLD_TEXT[hold] }}</span>
        <a class="linkish" href="#music">列表 {{ music.state?.total ?? 0 }} 首 →</a>
      </span>
    </div>
    <div class="mm-row">
      <template v-if="now">
        <img v-if="now.item.song.cover" class="mm-cover" :src="now.item.song.cover" alt="" referrerpolicy="no-referrer" />
        <span v-else class="mm-cover blank"><Icon name="i-music" /></span>
        <span class="mm-t">
          <b>{{ now.item.song.name }}<span> · {{ now.item.song.artists }}</span></b>
          <span class="mm-by"><Avatar :name="now.item.by.name" :face="now.item.by.face" :guard="now.item.by.guard" :size="16" />{{ now.item.by.name }} 点的 · <span class="num">{{ mmss(pos) }} / {{ mmss(now.item.song.durationMs) }}</span></span>
          <span class="mm-bar"><i :style="{ width: `${pct}%` }" /></span>
        </span>
      </template>
      <span v-else class="mm-empty"><Icon name="i-music" />{{ music.state?.total ? '列表里有歌，等能放的时候自动开始' : `还没有人点歌，观众发「${music.settings?.cmdRequest ?? '点歌'} 歌名」就能点` }}</span>
      <span class="mm-acts">
        <button class="btn sm" type="button" :title="hold === 'manual' ? '继续放歌' : '暂停：正在放的歌停在这里'" @click="toggleMusicPause"><Icon :name="hold === 'manual' ? 'i-play' : 'i-pause'" />{{ hold === 'manual' ? '继续' : '暂停' }}</button>
        <button class="btn sm" type="button" :disabled="!now" @click="skipSong"><Icon name="i-arrow" />切歌</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 和上面的「素材快捷播放」卡片一样的间距、内边距 */
.mm { margin-bottom: 16px; padding: 14px 16px; }
.mm .card-h { margin-bottom: 10px; }
.mm .card-h .aside { gap: 12px; }
.mm-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mm-cover { flex: none; width: 48px; height: 48px; border-radius: 10px; object-fit: cover; box-shadow: 0 0 0 1px var(--line); }
.mm-cover.blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.mm-cover.blank svg { width: 20px; height: 20px; }
.mm-t { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.mm-t b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-t b span { font-weight: 400; color: var(--t2); font-size: 13px; }
.mm-by { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--t2); white-space: nowrap; }
.mm-bar { position: relative; height: 3px; border-radius: 2px; background: var(--hover); overflow: hidden; margin-top: 2px; }
.mm-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); transition: width 1s linear; }
.mm-empty { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; font-size: 13px; color: var(--t2); }
.mm-empty svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
.mm-acts { display: flex; gap: 6px; flex: none; }
.mm-acts .btn.sm { height: 30px; padding: 0 12px; font-size: 12.5px; }
.mm-hold { color: var(--gov); }
.mm-warn { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 999px; background: var(--gov-soft); color: var(--gov); font-weight: 500; }
.mm-warn.bad { background: var(--bad-soft); color: var(--bad); }
.mm-warn svg { width: 13px; height: 13px; }
</style>
