<script setup lang="ts">
// 点歌 · 历史：最近 30 天点得最多的歌、点歌最多的观众；放过的歌（放完、切掉、取消、放不了），可以再点一次
import { computed, onMounted, ref, watch } from 'vue';
import type { MusicSong } from '@starfall/shared/overlay';
import Avatar from './Avatar.vue';
import Icon from './Icon.vue';
import RowMenu from './RowMenu.vue';
import { get, post } from '../lib/api.ts';
import { dateTime } from '../lib/format.ts';
import { banRequester, blockSong, music } from '../lib/music.ts';
import type { MusicHistoryRow } from '../lib/music.ts';
import { attempt } from '../lib/toast.ts';

interface Stats {
  songs: Array<{ song: MusicSong; count: number }>;
  people: Array<{ uid: number; name: string; face: string; count: number }>;
  total: number;
}
const stats = ref<Stats | null>(null);
const rows = ref<MusicHistoryRow[]>([]);
const more = ref(false);
const PAGE = 50;
async function load(): Promise<void> {
  const [s, h] = await Promise.all([attempt(() => get<Stats>('/api/music/stats?days=30')), attempt(() => get<{ items: MusicHistoryRow[] }>(`/api/music/history?limit=${PAGE}`))]);
  if (s) stats.value = s;
  if (h) {
    rows.value = h.items;
    more.value = h.items.length === PAGE;
  }
}
async function loadMore(): Promise<void> {
  const last = rows.value[rows.value.length - 1];
  if (!last) return;
  const h = await attempt(() => get<{ items: MusicHistoryRow[] }>(`/api/music/history?limit=${PAGE}&before=${last.id}`));
  if (!h) return;
  rows.value = [...rows.value, ...h.items];
  more.value = h.items.length === PAGE;
}
onMounted(load);
// 有歌放完、切掉时（列表里的歌变了）刷新
const sig = computed(() => `${music.state?.now?.item.id ?? ''}|${music.state?.total ?? 0}`);
watch(sig, () => void load());

const STATUS: Record<MusicHistoryRow['status'], { text: string; cls: string }> = {
  played: { text: '放完了', cls: 'ok' },
  skipped: { text: '切掉了', cls: '' },
  cancelled: { text: '取消了', cls: '' },
  failed: { text: '放不了', cls: 'bad' },
};
const inList = computed(() => new Set([...(music.state?.now ? [music.state.now.item] : []), ...music.queue].map((x) => `${x.song.source}:${x.song.id}`)));
async function again(song: MusicSong): Promise<void> {
  await attempt(() => post('/api/music/queue', { song }), `已加《${song.name}》到列表最后`);
}
</script>

<template>
  <div class="mh-grid">
    <div class="card">
      <div class="card-h"><h2>放过的歌</h2><span class="aside">保留天数和事件记录一样</span></div>
      <div v-if="!rows.length" class="inline-hint">还没有。</div>
      <div v-else class="mh-list">
        <div v-for="r in rows" :key="r.id" class="mh-row">
          <span class="t num">{{ dateTime(r.item.at) }}</span>
          <img v-if="r.item.song.cover" class="mh-thumb" :src="r.item.song.cover" alt="" referrerpolicy="no-referrer" />
          <span v-else class="mh-thumb blank"><Icon name="i-music" /></span>
          <span class="mh-t"><b>{{ r.item.song.name }}</b><span>{{ r.item.song.artists }}</span></span>
          <span class="mh-who"><Avatar :name="r.item.by.name" :face="r.item.by.face" :guard="r.item.by.guard" :size="20" /><span>{{ r.item.by.name }}</span></span>
          <span class="mh-st" :class="STATUS[r.status].cls" :title="r.note ?? ''">{{ STATUS[r.status].text }}<template v-if="r.note && r.status !== 'played'"> · {{ r.note }}</template></span>
          <span v-if="inList.has(`${r.item.song.source}:${r.item.song.id}`)" class="mh-in">在列表里</span>
          <button v-else class="btn sm" type="button" @click="again(r.item.song)">再点一次</button>
          <RowMenu :items="[{ icon: 'i-ban', label: `不让 ${r.item.by.name} 点歌`, run: () => void banRequester(r.item) }, { icon: 'i-x', label: '这首歌以后不收', run: () => void blockSong(r.item) }]" :label="`《${r.item.song.name}》：更多操作`" />
        </div>
      </div>
      <button v-if="more" class="btn mh-more" @click="loadMore">再往前看</button>
    </div>

    <div class="mh-col">
      <div class="card">
        <div class="card-h"><h2>最近 30 天点得最多的歌</h2><span class="aside">一共点了 {{ stats?.total ?? 0 }} 次</span></div>
        <div v-if="!stats?.songs.length" class="inline-hint">还没有。</div>
        <ol v-else class="mh-top">
          <li v-for="(x, i) in stats.songs" :key="`${x.song.source}${x.song.id}`">
            <span class="no num">{{ i + 1 }}</span>
            <span class="mh-t"><b>{{ x.song.name }}</b><span>{{ x.song.artists }}</span></span>
            <span class="n num">{{ x.count }} 次</span>
          </li>
        </ol>
      </div>
      <div class="card">
        <div class="card-h"><h2>最近 30 天点歌最多的观众</h2></div>
        <div v-if="!stats?.people.length" class="inline-hint">还没有。</div>
        <ol v-else class="mh-top">
          <li v-for="(p, i) in stats.people" :key="p.uid">
            <span class="no num">{{ i + 1 }}</span>
            <span class="mh-who"><Avatar :name="p.name" :face="p.face" :size="22" /><span>{{ p.name }}</span></span>
            <span class="n num">{{ p.count }} 首</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mh-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.mh-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1100px) { .mh-grid { grid-template-columns: 1fr; } }
.mh-list { display: flex; flex-direction: column; margin: 0 -6px; }
.mh-row { display: grid; grid-template-columns: 112px 34px minmax(0, 1fr) minmax(0, 8em) minmax(0, 11em) 80px 30px; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 8px; font-size: 13px; }
.mh-row + .mh-row { border-top: 1px solid var(--line); }
.mh-row:hover { background: var(--hover); }
.mh-row .t { font-size: 12px; color: var(--t3); }
.mh-thumb { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; }
.mh-thumb.blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.mh-thumb.blank svg { width: 15px; height: 15px; }
.mh-t { display: flex; flex-direction: column; min-width: 0; }
.mh-t b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-t span { font-size: 12px; color: var(--t2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-who { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; color: var(--t2); }
.mh-who span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-st { font-size: 12px; color: var(--t3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-st.ok { color: var(--ok); }
.mh-st.bad { color: #D64545; }
.mh-in { font-size: 12px; color: var(--t3); text-align: center; }
.mh-row .btn.sm { height: 28px; padding: 0 8px; font-size: 12px; justify-content: center; }
.mh-more { margin-top: 12px; }
.mh-top { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mh-top li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 0; font-size: 13px; }
.mh-top li + li { border-top: 1px solid var(--line); }
.mh-top .no { color: var(--t3); font-size: 12px; text-align: center; }
.mh-top li:nth-child(-n + 3) .no { color: var(--accent); font-weight: 600; }
.mh-top .n { font-size: 12px; color: var(--t2); }
</style>
