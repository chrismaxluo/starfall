<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import PreviewStage from '../components/PreviewStage.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import { get } from '../lib/api.ts';
import { EV_ICON, describe, statusText } from '../lib/events.ts';
import { clock, duration } from '../lib/format.ts';
import { IDENTITY, SAMPLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { onLiveEvent } from '../lib/live.ts';
import { effectById, state } from '../lib/store.ts';
import type { EventDto, TodayStats, Viewer } from '../lib/types.ts';

const stats = ref<TodayStats | null>(null);
const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
const menu = ref<{ viewer: Viewer; x: number; y: number } | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

async function loadStats(): Promise<void> {
  stats.value = await get<TodayStats>('/api/stats/today').catch(() => stats.value);
}
// 有新事件时稍后刷新统计（避免每条都请求）
const off = onLiveEvent(() => {
  if (!timer) timer = setTimeout(() => ((timer = null), void loadStats()), 2000);
});
onMounted(() => {
  void loadStats();
  tick = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  off();
  if (timer) clearTimeout(timer);
  if (tick) clearInterval(tick);
});

const s = computed(() => state.status);
const feed = computed(() => state.feed.slice(0, 10));
const setupSteps = computed(() => [
  { name: '扫码登录 B 站', done: Boolean(s.value?.account.loggedIn), href: '#settings' },
  { name: '填写直播间号', done: Boolean(s.value?.room), href: '#settings' },
  { name: '把特效页加到直播软件', done: (s.value?.overlays ?? 0) > 0, href: '#obs' },
]);
const needSetup = computed(() => setupSteps.value.some((x) => !x.done));

const COMP: Array<[Identity, string]> = [['gov', 'var(--gov)'], ['adm', 'var(--adm)'], ['cap', 'var(--cap)'], ['mod', 'var(--mod)'], ['fan', '#C770A4'], ['nor', 'var(--line-strong)']];
const compTotal = computed(() => Object.values(stats.value?.composition ?? {}).reduce((a, b) => a + b, 0));

function rowText(e: EventDto): string {
  const parts = e.kind === 'enter' ? [] : [describe(e)];
  if (e.status === 'played' || e.status === 'queued') parts.push(`${e.status === 'played' ? '已播放' : '排队中'} ${effectById(e.effectId)?.name ?? ''}`);
  else if (e.rule) parts.push(`${statusText(e.status)}，未播放`);
  else parts.push(e.status === 'blacklist' ? '黑名单，未播放' : '未触发特效');
  return parts.join(' · ');
}

/** 预览：用这个身份在规则里对应的素材 */
function tierEffect(id: Identity): number | null {
  const r = state.enter;
  if (!r) return null;
  if (id === 'fan') return r.bands[r.bands.length - 1]?.effectId ?? null;
  return r.tiers[id].effectId;
}
function test(id: Identity): void {
  const eff = tierEffect(id);
  if (eff) void stage.value?.play(eff, SAMPLES[id]);
}
const queueText = computed(() => (state.queue.playing ? `播放中 · ${state.queue.playing.effectName}` : state.queue.items.length ? `${state.queue.items.length} 个排队` : '空闲'));
const connText = computed(() => {
  const l = s.value?.live;
  if (!l) return '—';
  if (l.connection === 'connected') return '已连接';
  if (l.reason === 'offline') return '未开播，未连接';
  if (l.reason === 'not_logged_in') return '未登录 B 站';
  if (l.reason === 'no_room') return '未设置直播间';
  return l.connectionDetail ?? '连接中';
});
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>总览</h1>
        <p>直播间动态，实时更新</p>
      </div>
    </div>

    <div v-if="needSetup" class="guide">
      <b>开始使用：</b>
      <ol>
        <li v-for="(x, i) in setupSteps" :key="x.name" :class="{ done: x.done }"><Icon :name="x.done ? 'i-check' : 'i-spark'" />{{ i + 1 }}. <a :href="x.href">{{ x.name }}</a></li>
      </ol>
    </div>

    <div class="bento">
      <div class="card span3">
        <div class="card-h"><h2>今日进场 · 去重</h2></div>
        <div class="kpi-row"><span class="kpi-v num">{{ stats?.enterUnique ?? '—' }}</span></div>
        <div class="delta">按主播时区计算，每天 0 点重新计数</div>
      </div>
      <div class="card span3">
        <div class="card-h"><h2>今日触发特效</h2></div>
        <div class="kpi-row"><span class="kpi-v num">{{ stats?.played ?? '—' }}</span></div>
        <div class="delta">其中大航海 <b class="num" style="color: var(--t1)">{{ stats?.guardPlayed ?? 0 }}</b> 次</div>
      </div>
      <div class="card span3">
        <div class="card-h"><h2>本场直播</h2></div>
        <div class="kpi-row"><span class="kpi-v num" style="font-size: 26px">{{ s?.live.live ? (s.live.liveSince ? duration(now - s.live.liveSince) : '直播中') : '未开播' }}</span></div>
        <div class="delta">{{ s?.live.live ? `房管 ${s.live.adminCount} 人` : '开播后自动连接直播间' }}</div>
      </div>
      <div class="card span3">
        <div class="card-h"><h2>连接</h2></div>
        <div class="conn">
          <div class="conn-row"><span>弹幕服务器</span><span :style="{ color: s?.live.connection === 'connected' ? 'var(--ok)' : '' }">{{ connText }}</span></div>
          <div class="conn-row"><span>特效页</span><span :style="{ color: (s?.overlays ?? 0) > 0 ? 'var(--ok)' : 'var(--gov)' }">{{ (s?.overlays ?? 0) > 0 ? `${s!.overlays} 个在线` : '不在线' }}</span></div>
          <div class="conn-row"><span>播放队列</span><span>{{ queueText }}</span></div>
        </div>
      </div>

      <div class="card span7" style="grid-row: span 2">
        <div class="card-h"><h2>实时动态</h2><span class="aside">点任意一行可设置专属特效<span v-if="s?.live.connection === 'connected'" class="live" style="height: 22px"><i />LIVE</span></span></div>
        <div class="feed">
          <div v-for="e in feed" :key="e.id" class="feed-row" @click="(ev) => (menu = { viewer: e.viewer, x: ev.clientX, y: ev.clientY })">
            <Avatar :name="e.uname" :face="e.viewer.face" />
            <span class="who">
              <b>{{ e.uname }}</b>
              <span><span v-if="e.kind !== 'enter'" class="ev" :style="{ background: EV_ICON[e.kind].bg }">{{ EV_ICON[e.kind].text }}</span>{{ rowText(e) }}</span>
            </span>
            <IdTag :viewer="e.viewer" />
            <time class="num">{{ clock(e.ts) }}</time>
            <span class="rowact" aria-hidden="true"><Icon name="i-more" /></span>
          </div>
          <div v-if="!feed.length" class="soon-box" style="border: 0; background: none">
            <b>还没有动态</b>开播后，观众进场、弹幕、礼物会实时出现在这里
          </div>
        </div>
      </div>

      <div class="card span5">
        <div class="card-h"><h2>特效预览</h2><span class="aside">只在这里播放，不上直播</span></div>
        <PreviewStage id="stage" ref="stage" cls="stage" label="直播画面" />
        <div class="tests">
          <button v-for="id in (['gov', 'adm', 'cap', 'mod', 'fan', 'nor'] as Identity[])" :key="id" class="btn" :disabled="!tierEffect(id)" @click="test(id)"><i :style="{ background: id === 'fan' ? '#C770A4' : `var(--${id})` }" />{{ IDENTITY[id].name }}</button>
        </div>
      </div>

      <div class="card span5">
        <div class="card-h"><h2>身份构成</h2><span class="aside">今日进场</span></div>
        <div class="stack">
          <template v-for="[k, c] in COMP" :key="k">
            <i v-if="stats && stats.composition[k]" :style="{ width: `${Math.max((stats.composition[k] / compTotal) * 100, 1.2)}%`, background: c }" />
          </template>
          <i v-if="!compTotal" style="width: 100%; background: var(--hover)" />
        </div>
        <div class="legend">
          <div v-for="[k, c] in COMP" :key="k"><i :style="{ background: c }" />{{ k === 'nor' ? '普通观众' : IDENTITY[k].name }}<b class="num">{{ stats?.composition[k] ?? 0 }}</b></div>
        </div>
      </div>
    </div>
    <ViewerMenu v-if="menu" :viewer="menu.viewer" :x="menu.x" :y="menu.y" @close="menu = null" />
  </section>
</template>
