<script setup lang="ts">
// 点歌主页 · 本场：正在直播时从开播算起，没开播时是上一场：点了几首、放完几首、几个人点歌、点得最多的歌、点歌最多的观众
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';
import { get } from '../lib/api.ts';
import { clock, duration, when } from '../lib/format.ts';
import { music } from '../lib/music.ts';
import type { MusicSessionStats } from '../lib/music.ts';
import { state } from '../lib/store.ts';

const s = ref<MusicSessionStats | null>(null);
const loaded = ref(false);
async function load(): Promise<void> {
  const r = await get<{ session: MusicSessionStats | null }>('/api/music/session').catch(() => null);
  if (!r) return;
  s.value = r.session;
  loaded.value = true;
}
// 有人点歌、换歌、开播下播时重新算
const sig = computed(() => `${music.state?.now?.item.id ?? ''}|${music.state?.total ?? 0}|${music.notices[0]?.id ?? ''}|${state.status?.live.live ?? ''}`);
watch(sig, () => void load());

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  timer = setInterval(() => (now.value = Date.now()), 60_000);
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div class="card ss">
    <div class="card-h">
      <h2><span class="hicon"><Icon name="i-chart" /></span>{{ !s || s.live ? '本场' : '上一场' }}</h2>
      <span v-if="s" class="aside">{{ s.live ? `开播 ${duration(now - s.startedAt)}` : `${when(s.startedAt, now)} – ${clock(s.endedAt!).slice(0, 5)}` }}</span>
    </div>
    <p v-if="loaded && !s" class="inline-hint">还没有直播记录。开播后这里会显示本场点了几首歌、谁点得最多。</p>
    <template v-else-if="s">
      <div class="ss-nums">
        <span class="ss-n"><b class="num">{{ s.requested }}</b><span>点了几首</span></span>
        <span class="ss-n"><b class="num">{{ s.played }}</b><span>放完</span></span>
        <span class="ss-n"><b class="num">{{ s.people }}</b><span>人点歌</span></span>
      </div>
      <div class="ss-top">
        <span class="ss-row">
          <span class="k">点得最多</span>
          <template v-if="s.topSong">
            <img v-if="s.topSong.song.cover" :src="s.topSong.song.cover" alt="" referrerpolicy="no-referrer" />
            <span v-else class="ss-blank"><Icon name="i-music" /></span>
            <b>{{ s.topSong.song.name }}</b><em>{{ s.topSong.count }} 次</em>
          </template>
          <span v-else class="ss-none">还没有被点两次的歌</span>
        </span>
        <span class="ss-row">
          <span class="k">点歌最多</span>
          <template v-if="s.topPerson"><Avatar :name="s.topPerson.name" :face="s.topPerson.face" :size="20" /><b>{{ s.topPerson.name }}</b><em>{{ s.topPerson.count }} 首</em></template>
          <span v-else class="ss-none">还没有观众点歌</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ss { display: flex; flex-direction: column; }
.ss-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.ss-n b { display: block; font-size: 28px; font-weight: 600; letter-spacing: -0.04em; line-height: 1.1; }
.ss-n span { font-size: var(--fs-cap); color: var(--t3); }
.ss-top { display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line); }
.ss-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sec); color: var(--t2); min-width: 0; }
.ss-row .k { width: 4.5em; flex: none; color: var(--t3); }
.ss-row b { font-weight: 600; color: var(--t1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ss-row em { font-style: normal; color: var(--t3); flex: none; }
.ss-row img, .ss-blank { width: 20px; height: 20px; border-radius: var(--r-xs); object-fit: cover; flex: none; }
.ss-blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.ss-blank svg { width: 12px; height: 12px; }
.ss-none { color: var(--t3); }
</style>
