<script setup lang="ts">
// 总览：正在监控的直播间（标题、分区、主播、开播时间）、本场 / 今天的数据、实时动态、播放队列
import EvIcon from '../components/EvIcon.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import IdTag from '../components/IdTag.vue';
import Seg from '../components/Seg.vue';
import Switch from '../components/Switch.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import { del, get, post, put } from '../lib/api.ts';
import { describe, statusText } from '../lib/events.ts';
import { bigNum, clock, duration, hms, when } from '../lib/format.ts';
import { IDENTITY } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { onLiveEvent } from '../lib/live.ts';
import { effectById, refreshSettings, state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';
import type { EventDto, StatsDto, Viewer } from '../lib/types.ts';

const PLAY_GAP_MS = 300;
const Q_SHOW = 5;
const stats = ref<StatsDto | null>(null);
const menu = ref<{ viewer: Viewer; x: number; y: number } | null>(null);
const now = ref(Date.now());
const coverFailed = ref(false);
const showQueueSet = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

const s = computed(() => state.status);
const info = computed(() => state.roomInfo);
const live = computed(() => Boolean(s.value?.live.live));
/** 数据范围：开播时默认看本场，没开播时默认看今天；手动选过就保持 */
const picked = ref<'live' | 'today' | null>(null);
const scope = computed(() => picked.value ?? (live.value ? 'live' : 'today'));

async function loadStats(): Promise<void> {
  stats.value = await get<StatsDto>(`/api/stats?scope=${scope.value}`).catch(() => stats.value);
}
watch([scope, live, () => s.value?.room?.roomId, () => s.value?.live.liveSince], () => void loadStats());
// 有新事件时稍后刷新统计（避免每条都请求）
const off = onLiveEvent(() => {
  if (!timer) timer = setTimeout(() => ((timer = null), void loadStats()), 2000);
});
onMounted(() => {
  void loadStats();
  // 直播时长、队列进度每秒更新
  tick = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  off();
  if (timer) clearTimeout(timer);
  if (tick) clearInterval(tick);
});

const setupSteps = computed(() => [
  { name: '扫码登录 B 站', done: Boolean(s.value?.account.loggedIn), href: '#settings' },
  { name: '填写直播间号', done: Boolean(s.value?.room), href: '#settings' },
  { name: '把特效页加到直播软件', done: (s.value?.overlays ?? 0) > 0, href: '#obs' },
]);
const needSetup = computed(() => setupSteps.value.some((x) => !x.done));

// ---------- 直播间 ----------
const roomId = computed(() => s.value?.room?.roomId ?? null);
const anchorName = computed(() => info.value?.anchor.name || s.value?.room?.anchorName || '主播');
const cover = computed(() => (coverFailed.value ? '' : (info.value?.cover ?? '')));
watch(() => info.value?.cover, () => (coverFailed.value = false));
const since = computed(() => s.value?.live.liveSince ?? null);
const area = computed(() => [info.value?.parentAreaName, info.value?.areaName].filter(Boolean).join(' · '));
const timeLine = computed(() => {
  if (live.value) return since.value ? `${when(since.value, now.value)} 开播 · 已播 ${duration(now.value - since.value)}` : '直播中';
  const l = stats.value?.lastSession;
  return l ? `上次直播 ${when(l.startedAt, now.value)} – ${clock(l.endedAt).slice(0, 5)}（${duration(l.endedAt - l.startedAt)}）` : '还没有直播记录';
});
const connText = computed(() => {
  const l = s.value?.live;
  if (!l) return '—';
  if (l.connection === 'connected') return '已连接';
  if (l.reason === 'offline') return '未开播，未连接';
  if (l.reason === 'not_logged_in') return '未登录 B 站';
  if (l.reason === 'no_room') return '未设置直播间';
  return l.connectionDetail ?? '连接中';
});

// ---------- 数据 ----------
const scopeText = computed(() => {
  const x = stats.value;
  if (scope.value === 'today') return '今天（0 点至今）';
  if (!x || x.from === null) return '本场直播（还没有直播记录）';
  if (x.live) return `本场直播（${when(x.from, now.value)} 开播至今）`;
  return `上一场直播（${when(x.from, now.value)} – ${clock(x.to ?? x.from).slice(0, 5)}）`;
});
const COMP: Array<[Identity, string]> = [['gov', 'var(--gov)'], ['adm', 'var(--adm)'], ['cap', 'var(--cap)'], ['mod', 'var(--mod)'], ['fan', '#C770A4'], ['nor', 'var(--line-strong)']];
const compTotal = computed(() => Object.values(stats.value?.composition ?? {}).reduce((a, b) => a + b, 0));

// ---------- 实时动态 ----------
const feed = computed(() => state.feed.slice(0, 12));
function rowText(e: EventDto): string {
  const parts = e.kind === 'enter' ? [] : [describe(e)];
  if (e.status === 'played' || e.status === 'queued') parts.push(`${e.status === 'played' ? '已播放' : '排队中'} ${effectById(e.effectId)?.name ?? ''}`);
  else if (e.rule) parts.push(`${statusText(e.status)}，未播放`);
  else parts.push(e.status === 'blacklist' ? '黑名单，未播放' : '未触发特效');
  return parts.join(' · ');
}

// ---------- 播放队列 ----------
const playing = computed(() => state.queue.playing);
const left = computed(() => (playing.value ? Math.max(0, playing.value.startedAt + playing.value.durationMs - now.value) : 0));
const progress = computed(() => (playing.value ? Math.min(100, ((now.value - playing.value.startedAt) / playing.value.durationMs) * 100) : 0));
/** 每一项大约多久后开始播 */
const upcoming = computed(() => {
  let t = playing.value ? left.value + PLAY_GAP_MS : 0;
  return state.queue.items.map((q) => {
    const eta = t;
    t += q.durationMs + PLAY_GAP_MS;
    return { ...q, eta };
  });
});
const eta = (ms: number) => (ms < 1000 ? '马上' : `约 ${Math.round(ms / 1000)} 秒后`);
async function skip(): Promise<void> {
  await attempt(() => post('/api/playback/skip'), '已跳过，开始播下一个');
}
async function clearQueue(): Promise<void> {
  await attempt(() => post<{ cleared: number }>('/api/playback/clear'), '已清空排队');
}
async function removeItem(id: string, name: string): Promise<void> {
  await attempt(() => del(`/api/playback/queue/${encodeURIComponent(id)}`), `已移出队列：${name}，这次不播放`);
}
async function saveSetting(patch: object, msg: string): Promise<void> {
  // 成功失败都重新读取：失败时开关要回到原来的状态
  await attempt(() => put('/api/settings', patch), msg);
  await refreshSettings().catch(() => undefined);
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>总览</h1>
        <p>正在监控的直播间和实时动态</p>
      </div>
    </div>

    <div v-if="needSetup" class="guide">
      <b>开始使用：</b>
      <ol>
        <li v-for="(x, i) in setupSteps" :key="x.name" :class="{ done: x.done }"><Icon :name="x.done ? 'i-check' : 'i-spark'" />{{ i + 1 }}. <a :href="x.href">{{ x.name }}</a></li>
      </ol>
    </div>

    <!-- 直播间 -->
    <div v-if="roomId" class="card ov-room">
      <div class="ov-cover" :class="{ off: !live }">
        <img v-if="cover" :src="cover" alt="" referrerpolicy="no-referrer" @error="coverFailed = true" />
        <div v-else class="ph"><Avatar :name="anchorName" :face="info?.anchor.face" /></div>
        <span class="badge" :class="{ off: !live }"><i v-if="live" />{{ live ? '直播中' : '未开播' }}</span>
        <span v-if="live && since" class="dur num">{{ hms(now - since) }}</span>
      </div>
      <div class="ov-meta">
        <div class="ov-anchor">
          <Avatar :name="anchorName" :face="info?.anchor.face" />
          <span><b>{{ anchorName }}</b><span class="sub">UID {{ s?.room?.anchorUid }}<template v-if="info && info.followers !== null"> · 粉丝 {{ bigNum(info.followers) }}</template></span></span>
        </div>
        <div class="ov-title" :title="info?.title">{{ info?.title || '（正在获取直播间信息）' }}</div>
        <div class="ov-tags">
          <span v-if="area" class="pill">{{ area }}</span>
          <a class="pill" :href="`https://live.bilibili.com/${roomId}`" target="_blank" rel="noopener">房间号 <b class="num">{{ s?.room?.shortId || roomId }}</b><Icon name="i-ext" /></a>
          <span class="pill">{{ timeLine }}</span>
        </div>
      </div>
      <div class="ov-side">
        <div class="row"><span>弹幕服务器</span><span :class="{ ok: s?.live.connection === 'connected' }">{{ connText }}</span></div>
        <div class="row"><span>特效页</span><span :class="(s?.overlays ?? 0) > 0 ? 'ok' : 'warn'">{{ (s?.overlays ?? 0) > 0 ? `${s!.overlays} 个在线` : '不在线' }}</span></div>
        <div v-if="live" class="row"><span>房管总数</span><span class="num">{{ s?.live.adminCount }} 人</span></div>
        <div class="row"><span>换直播间</span><a class="linkish" href="#settings">去设置 →</a></div>
      </div>
    </div>

    <div v-if="roomId" class="ov-scope">
      <span>下面的数据：<b>{{ scopeText }}</b> · 只算直播间 {{ roomId }}</span>
      <Seg :model-value="scope" label="数据范围" :options="[{ value: 'live', label: live ? '本场' : '上一场' }, { value: 'today', label: '今天' }]" @change="(v) => (picked = v)" />
    </div>

    <div class="bento">
      <div class="card span3">
        <div class="card-h"><h2>进场人数 · 去重</h2></div>
        <div class="kpi-row"><span class="kpi-v num">{{ stats ? stats.enterUnique.toLocaleString('zh-CN') : '—' }}</span></div>
        <div class="delta">其中大航海 <b class="num" style="color: var(--t1)">{{ stats?.guardUnique ?? 0 }}</b> 人</div>
      </div>
      <div class="card span3">
        <div class="card-h"><h2>触发特效</h2></div>
        <div class="kpi-row"><span class="kpi-v num">{{ stats ? stats.played.toLocaleString('zh-CN') : '—' }}</span></div>
        <div class="delta">其中大航海 <b class="num" style="color: var(--t1)">{{ stats?.guardPlayed ?? 0 }}</b> 次</div>
      </div>
      <div class="card span3 ov-kpi">
        <div class="card-h"><h2>看过 · 高能榜</h2><span class="src">B站</span></div>
        <div class="pair">
          <div><small>看过</small><span class="kpi-v num">{{ live ? bigNum(info?.watched) : '—' }}</span></div>
          <div><small>高能榜</small><span class="kpi-v num">{{ live ? bigNum(info?.rankCount) : '—' }}</span></div>
        </div>
        <div class="delta">{{ live ? 'B 站直播间的实时数据' : '开播后显示' }}</div>
      </div>
      <div class="card span3 ov-kpi">
        <div class="card-h"><h2>点赞 · 粉丝</h2><span class="src">B站</span></div>
        <div class="pair">
          <div><small>点赞</small><span class="kpi-v num">{{ live ? bigNum(info?.likes) : '—' }}</span></div>
          <div><small>粉丝</small><span class="kpi-v num">{{ bigNum(info?.followers) }}</span></div>
        </div>
        <div class="delta">{{ info?.fansClub ? `粉丝团 ${bigNum(info.fansClub)} 人` : live ? '点赞是本场累计' : '点赞开播后显示' }}</div>
      </div>

      <div class="card span7" style="grid-row: span 2">
        <div class="card-h"><h2>实时动态</h2><span class="aside">点任意一行可设置专属特效<span v-if="s?.live.connection === 'connected'" class="live" style="height: 22px"><i />LIVE</span></span></div>
        <div class="feed">
          <div v-for="e in feed" :key="e.id" class="feed-row" @click="(ev) => (menu = { viewer: e.viewer, x: ev.clientX, y: ev.clientY })">
            <Avatar :name="e.uname" :face="e.viewer.face" />
            <span class="who">
              <b>{{ e.uname }}</b>
              <span><EvIcon v-if="e.kind !== 'enter'" :kind="e.kind" :img="e.payload?.icon" />{{ rowText(e) }}</span>
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
        <div class="card-h">
          <h2>播放队列</h2>
          <span class="aside">{{ playing ? `正在播 1 条 · 排队 ${state.queue.items.length} 条` : state.queue.items.length ? `排队 ${state.queue.items.length} 条` : '空闲' }}</span>
        </div>
        <div v-if="playing" class="ov-now">
          <Avatar :name="playing.viewerName" :face="playing.viewerFace" />
          <div style="min-width: 0">
            <b>{{ playing.viewerName }}</b>
            <div class="what"><EvIcon v-if="playing.kind !== 'enter'" :kind="playing.kind" :img="playing.giftImg" />{{ playing.detail }} · 播放 <b>{{ playing.effectName }}</b></div>
          </div>
          <span class="left num">还剩 {{ (left / 1000).toFixed(1) }} 秒</span>
          <div class="bar"><i :style="{ width: `${progress}%` }" /></div>
        </div>
        <div v-if="upcoming.length" class="ov-q">
          <div v-for="(q, i) in upcoming.slice(0, Q_SHOW)" :key="q.id" class="qrow">
            <span class="n num">{{ i + 1 }}</span>
            <Avatar :name="q.viewerName" :face="q.viewerFace" />
            <span class="who"><b>{{ q.viewerName }}</b><span><EvIcon v-if="q.kind !== 'enter'" :kind="q.kind" :img="q.giftImg" />{{ q.detail }} · {{ q.effectName }}</span></span>
            <span class="eta num">{{ eta(q.eta) }}</span>
            <button class="x" :aria-label="`把 ${q.viewerName} 移出队列`" title="移出队列（这次不播）" @click="removeItem(q.id, q.viewerName)"><Icon name="i-x" /></button>
          </div>
        </div>
        <div v-if="!playing && !upcoming.length" class="ov-qempty"><b>现在没有排队</b>观众进场、送礼时会出现在这里，按顺序一个一个播放</div>
        <div class="ov-qfoot">
          <span v-if="upcoming.length > Q_SHOW">后面还有 <b class="num">{{ upcoming.length - Q_SHOW }}</b> 条</span>
          <button class="linkish" :aria-expanded="showQueueSet" @click="showQueueSet = !showQueueSet">排队设置</button>
          <span class="sp" />
          <button v-if="playing" class="btn" @click="skip">跳过当前</button>
          <ConfirmButton v-if="upcoming.length" label="清空排队" confirm-label="确认清空" cls="btn" @confirm="clearQueue" />
        </div>
        <div v-if="showQueueSet && state.settings" class="ov-qset">
          <div class="toggle-line">高价值插队 <span class="hint">上舰和 100 元以上的礼物排到最前面</span>
            <Switch v-model="state.settings.queueJump" label="高价值插队" @change="(v) => saveSetting({ queueJump: v }, v ? '已开启高价值插队' : '已关闭高价值插队')" />
          </div>
          <div class="slider-row">
            <label for="qMax">最多排队</label>
            <input id="qMax" v-model.number="state.settings.queueMax" type="range" min="3" max="30" @change="saveSetting({ queueMax: state.settings!.queueMax }, `最多排队 ${state.settings!.queueMax} 条`)" />
            <output>{{ state.settings.queueMax }} 条</output>
          </div>
          <span class="hint">播放顺序：上舰 → 礼物 → 进场 → 弹幕。排满后，先挤掉顺序最靠后、最早进来的一条。</span>
        </div>
      </div>

      <div class="card span5">
        <div class="card-h"><h2>身份构成</h2><span class="aside">{{ scope === 'live' ? (stats?.live ? '本场进场' : '上一场进场') : '今天进场' }}</span></div>
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
