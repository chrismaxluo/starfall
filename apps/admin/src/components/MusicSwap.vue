<script setup lang="ts">
// 换个版本：观众点到的不是想要的那版（翻唱、现场版、伴奏）时，搜一下换成别的版本。点歌人和位置不变；正在放的换完马上从头放
import { onMounted, ref } from 'vue';
import type { MusicItem, MusicSong } from '@starfall/shared/overlay';
import Icon from './Icon.vue';
import { get, post } from '../lib/api.ts';
import { useEsc } from '../lib/esc.ts';
import { mmss } from '../lib/music.ts';
import type { SearchHit } from '../lib/music.ts';
import { attempt } from '../lib/toast.ts';

const props = defineProps<{ item: MusicItem; playing: boolean }>();
const emit = defineEmits<{ close: [] }>();

const firstArtist = props.item.song.artists.split(/[/、,，&]/)[0]?.trim() ?? '';
const q = ref(`${props.item.song.name} ${firstArtist}`.trim());
const busy = ref(false);
const hits = ref<{ local: SearchHit[]; netease: SearchHit[]; neteaseError?: string } | null>(null);
async function search(): Promise<void> {
  const s = q.value.trim();
  if (!s) return;
  busy.value = true;
  hits.value = (await attempt(() => get<{ local: SearchHit[]; netease: SearchHit[]; neteaseError?: string }>(`/api/music/search?q=${encodeURIComponent(s)}`))) ?? null;
  busy.value = false;
}
onMounted(search);

const same = (h: SearchHit) => h.source === props.item.song.source && h.id === props.item.song.id;
async function choose(h: SearchHit): Promise<void> {
  const song: MusicSong = { source: h.source, id: h.id, name: h.name, artists: h.artists, ...(h.album ? { album: h.album } : {}), ...(h.cover ? { cover: h.cover } : {}), durationMs: h.durationMs };
  busy.value = true;
  const ok = await attempt(() => post(`/api/music/queue/${props.item.id}/swap`, { song }), props.playing ? `换成《${h.name}》（${h.artists}），从头开始放` : `换成《${h.name}》（${h.artists}）`);
  busy.value = false;
  if (ok) emit('close');
}
useEsc(() => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="dlg msw" role="dialog" aria-label="换个版本">
      <div class="qh"><b>换个版本</b><span class="msw-of">《{{ item.song.name }}》· {{ item.by.name }} 点的</span><button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button></div>
      <div class="msw-b">
        <form class="msw-s" @submit.prevent="search">
          <input v-model="q" class="inp" placeholder="歌名，或者 歌名 歌手" aria-label="搜歌" maxlength="60" />
          <button class="btn" type="submit" :disabled="busy || !q.trim()"><Icon name="i-search" />搜索</button>
        </form>
        <p class="inline-hint">点歌人和在列表里的位置不变{{ playing ? '；正在放的这首会换掉，新的从头放' : '' }}。</p>
        <div v-if="!hits" class="inline-hint">{{ busy ? '搜索中…' : '' }}</div>
        <div v-else class="msw-list">
          <template v-for="grp in [{ key: 'local', title: '本地歌库', list: hits.local }, { key: 'netease', title: '网易云', list: hits.netease }]" :key="grp.key">
            <h3 v-if="grp.list.length || (grp.key === 'netease' && hits.neteaseError)" class="msw-sub">{{ grp.title }}</h3>
            <p v-if="grp.key === 'netease' && hits.neteaseError" class="inline-hint err">{{ hits.neteaseError }}</p>
            <div v-for="h in grp.list" :key="`${h.source}${h.id}`" class="msw-hit" :class="{ dim: !h.playable }">
              <img v-if="h.cover" class="msw-th" :src="h.cover" alt="" referrerpolicy="no-referrer" />
              <span v-else class="msw-th blank"><Icon name="i-music" /></span>
              <span class="msw-t"><b>{{ h.name }}</b><span>{{ h.artists }}<template v-if="h.album"> · {{ h.album }}</template><template v-if="h.note"> · {{ h.note }}</template></span></span>
              <span class="msw-d num">{{ mmss(h.durationMs) }}</span>
              <span v-if="same(h)" class="msw-cur">现在这版</span>
              <button v-else class="btn sm" type="button" :disabled="busy || !h.playable" @click="choose(h)">换这个</button>
            </div>
          </template>
          <p v-if="!hits.local.length && !hits.netease.length && !hits.neteaseError" class="inline-hint">没有找到，换个关键词试试。</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg.msw { width: min(600px, calc(100vw - 32px)); max-height: calc(100vh - 48px); }
.msw .qh { flex-wrap: wrap; row-gap: 2px; }
.msw-of { font-size: 12.5px; color: var(--t2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msw-b { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.msw-s { display: flex; gap: 8px; }
.msw-s .inp { flex: 1; min-width: 0; }
.msw-list { overflow: auto; margin: 0 -6px; max-height: 56vh; }
.msw-sub { font-size: 12px; font-weight: 600; color: var(--t3); margin: 10px 6px 4px; }
.msw-hit { display: grid; grid-template-columns: 36px minmax(0, 1fr) 40px 72px; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 8px; font-size: 13px; }
.msw-hit + .msw-hit { border-top: 1px solid var(--line); }
.msw-hit:hover { background: var(--hover); }
.msw-hit.dim { opacity: .5; }
.msw-th { width: 36px; height: 36px; border-radius: 8px; object-fit: cover; }
.msw-th.blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.msw-th.blank svg { width: 16px; height: 16px; }
.msw-t { display: flex; flex-direction: column; min-width: 0; }
.msw-t b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msw-t span { font-size: 12px; color: var(--t2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msw-d { font-size: 12px; color: var(--t3); text-align: right; }
.msw-cur { font-size: 12px; color: var(--accent); text-align: center; }
.msw-hit .btn.sm { height: 28px; padding: 0 8px; font-size: 12px; justify-content: center; }
</style>
