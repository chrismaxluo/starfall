<script setup lang="ts">
// 总览（开播时看的驾驶舱）：上面是直播间和「状态」（一切正常还是哪里有问题，问题旁边直接给修复按钮），
// 然后是本场 / 今天的数据；下面左边实时动态，右边快捷播放、点歌、切换面板（播放队列、在线观众、礼物榜、大航海）和身份构成
import EvIcon from '../components/EvIcon.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Avatar from '../components/Avatar.vue';
import Icon from '../components/Icon.vue';
import HonorMedal from '../components/HonorMedal.vue';
import IdTag from '../components/IdTag.vue';
import OvPanel from '../components/OvPanel.vue';
import QuickPad from '../components/QuickPad.vue';
import MusicMini from '../components/MusicMini.vue';
import Seg from '../components/Seg.vue';
import Switch from '../components/Switch.vue';
import ViewerMenu from '../components/ViewerMenu.vue';
import { togglePause } from '../lib/actions.ts';
import { get } from '../lib/api.ts';
import { describe, statusText } from '../lib/events.ts';
import { bigNum, clock, duration, hms, when } from '../lib/format.ts';
import { IDENTITY } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { onLiveEvent } from '../lib/live.ts';
import { useQuickHotkeys } from '../lib/quick.ts';
import { go } from '../lib/route.ts';
import { effectById, state, ui } from '../lib/store.ts';
import { music } from '../lib/music.ts';
import type { EventDto, StatsDto, TriggerKind, Viewer } from '../lib/types.ts';

useQuickHotkeys();

const stats = ref<StatsDto | null>(null);
const menu = ref<{ viewer: Viewer; x: number; y: number } | null>(null);
const now = ref(Date.now());
const coverFailed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

const s = computed(() => state.status);
const info = computed(() => state.roomInfo);
const live = computed(() => Boolean(s.value?.live.live));
/** 数据范围：默认看本场，没开播时看上一场（凌晨下播后看到的是完整的一场，不会被 0 点切开）；从来没开播过才看今天；手动选过就保持 */
const picked = ref<'live' | 'today' | null>(null);
/** 这个直播间还没有过完整的一场 */
const noSession = ref(false);
const scope = computed(() => picked.value ?? (live.value || !noSession.value ? 'live' : 'today'));

// 请求序号：本场 / 今天来回切时，只用最后一次的结果
let statsSeq = 0;
async function loadStats(): Promise<void> {
  const seq = ++statsSeq;
  const r = await get<StatsDto>(`/api/stats?scope=${scope.value}`).catch(() => null);
  if (!r || seq !== statsSeq) return;
  stats.value = r;
  // 没开播、也没有上一场：改看今天（会再读一次）
  if (scope.value === 'live' && !r.live && !r.lastSession && !picked.value) noSession.value = true;
}
// 换了直播间：重新看有没有上一场
watch(() => s.value?.room?.roomId, () => (noSession.value = false));
watch([scope, live, () => s.value?.room?.roomId, () => s.value?.live.liveSince], () => void loadStats());
// 有新事件时稍后刷新统计（避免每条都请求）
const off = onLiveEvent(() => {
  if (!timer) timer = setTimeout(() => ((timer = null), void loadStats()), 2000);
});
onMounted(() => {
  void loadStats();
  // 直播时长每秒更新
  tick = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  off();
  if (timer) clearTimeout(timer);
  if (tick) clearInterval(tick);
});

// 第 3 步按「连上过一次」算：配好以后先打开星临、还没开直播软件时，不会又冒出来
const setupSteps = computed(() => [
  { name: '扫码登录 B站', done: Boolean(s.value?.account.loggedIn), href: '#settings', qr: true },
  { name: '填写直播间号', done: Boolean(s.value?.room), href: '#settings', qr: false },
  { name: '把特效页加到直播软件', done: (s.value?.overlays ?? 0) > 0 || Boolean(state.settings?.overlaySeen), href: '#obs', qr: false },
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

// ---------- 状态：弹幕连接、特效页、B站登录、暂停；有问题的排前面，旁边直接给修复按钮 ----------
type Level = 'ok' | 'warn' | 'bad' | 'off';
/** head：只有这一个问题时，状态卡片的标题 */
interface Check { key: string; name: string; text: string; level: Level; head?: string; action?: { label: string; run: () => void } }
const rescan = { label: '重新扫码', run: () => (ui.qr = true) };
const checks = computed((): Check[] => {
  const st = s.value;
  if (!st) return [];
  const l = st.live;
  const out: Check[] = [];
  if (l.connection === 'connected') out.push({ key: 'conn', name: '弹幕连接', text: '已连接', level: 'ok' });
  else if (l.reason === 'offline') out.push({ key: 'conn', name: '弹幕连接', text: '开播后自动连接', level: 'off' });
  else if (l.reason === 'no_room') out.push({ key: 'conn', name: '弹幕连接', text: '还没设置直播间', level: 'bad', head: '还没设置直播间', action: { label: '去设置', run: () => go('settings') } });
  else if (l.reason !== 'not_logged_in') out.push({ key: 'conn', name: '弹幕连接', text: l.connectionDetail ?? '正在连接', level: 'warn', head: '正在连接直播间' });
  const n = st.overlays ?? 0;
  if (n > 0) out.push({ key: 'fx', name: '特效页', text: `${n} 个在线`, level: 'ok' });
  else out.push({ key: 'fx', name: '特效页', text: live.value ? '不在线，观众看不到特效' : '不在线', level: live.value ? 'bad' : 'off', head: '特效页不在线', action: { label: '去检查', run: () => go('obs') } });
  const a = st.account;
  if (!a.loggedIn) out.push({ key: 'login', name: 'B站登录', text: '还没登录，收不到直播间消息', level: 'bad', head: '还没登录 B站', action: { label: '扫码登录', run: () => (ui.qr = true) } });
  else {
    const days = a.expiresAt ? Math.floor((a.expiresAt - now.value) / 86400_000) : null;
    if (l.loginInvalid) out.push({ key: 'login', name: 'B站登录', text: '已失效，收不到直播间消息', level: 'bad', head: 'B站登录已失效', action: rescan });
    else if (days !== null && days < 0) out.push({ key: 'login', name: 'B站登录', text: '已过期，收不到直播间消息', level: 'bad', head: 'B站登录已过期', action: rescan });
    else if (days !== null && days <= 3) out.push({ key: 'login', name: 'B站登录', text: `还剩 ${days} 天`, level: 'warn', head: `B站登录还剩 ${days} 天`, action: rescan });
    else out.push({ key: 'login', name: 'B站登录', text: days === null ? '有效' : `有效，还剩 ${days} 天`, level: 'ok' });
  }
  if (st.paused) out.push({ key: 'pause', name: '特效播放', text: '已暂停', level: 'warn', head: '特效已暂停', action: { label: '恢复播放', run: () => void togglePause() } });
  const rank: Record<Level, number> = { bad: 0, warn: 1, off: 2, ok: 3 };
  return out.sort((x, y) => rank[x.level] - rank[y.level]);
});
const health = computed((): { level: Level; title: string } => {
  const bad = checks.value.filter((c) => c.level === 'bad');
  const warn = checks.value.filter((c) => c.level === 'warn');
  const one = (c: Check) => c.head ?? `${c.name}${c.text}`;
  if (bad.length) return { level: 'bad', title: bad.length === 1 ? one(bad[0]!) : `有 ${bad.length} 个问题` };
  if (warn.length) return { level: 'warn', title: warn.length === 1 ? one(warn[0]!) : `有 ${warn.length} 项要注意` };
  return live.value ? { level: 'ok', title: '一切正常' } : { level: 'off', title: '未开播' };
});

// ---------- 数据 ----------
/** 数据卡片右上角写清楚算的是哪段时间（标题已经写了本场 / 上一场 / 今天） */
const scopeText = computed(() => {
  const x = stats.value;
  if (scope.value === 'today') return '0 点至今';
  if (!x || x.from === null) return '还没有直播记录';
  if (x.live) return `${when(x.from, now.value)} 开播至今`;
  return `${when(x.from, now.value)} – ${clock(x.to ?? x.from).slice(0, 5)}`;
});
const COMP: Array<[Identity, string]> = [['gov', 'var(--gov)'], ['adm', 'var(--adm)'], ['cap', 'var(--cap)'], ['mod', 'var(--mod)'], ['fan', '#C770A4'], ['nor', 'var(--line-strong)']];
const compTotal = computed(() => Object.values(stats.value?.composition ?? {}).reduce((a, b) => a + b, 0));
const HONOR: Array<['l1' | 'l21' | 'l41' | 'l61' | 'none', string, string]> = [['l1', '1 – 20 级', '#8FA3C8'], ['l21', '21 – 40 级', '#6D8BE8'], ['l41', '41 – 60 级', '#9A7BE8'], ['l61', '61 级以上', '#E0A43C'], ['none', '没有 / 不知道', 'var(--line-strong)']];
const honorTotal = computed(() => Object.values(stats.value?.honor ?? {}).reduce((a, b) => a + b, 0));

// ---------- 实时动态 ----------
const FEED_SHOW = 12;
const kind = ref<'all' | TriggerKind>('all');
/** 筛「礼物」时醒目留言也算（都是花钱的） */
const kindHit = (e: EventDto) => kind.value === 'all' || e.kind === kind.value || (kind.value === 'gift' && e.kind === 'sc');
const onlyGuard = ref(false);
/** 鼠标停在列表上时先不滚动（方便点人），移开后再显示新的 */
const frozen = ref<EventDto[] | null>(null);
const filtered = computed(() =>  state.feed.filter((e) => kindHit(e) && (!onlyGuard.value || Number((e.viewer as Viewer).guard) > 0)));
const feed = computed(() => frozen.value ?? filtered.value.slice(0, FEED_SHOW));
const newWhileFrozen = computed(() => {
  const f = frozen.value;
  if (!f) return 0;
  const top = f[0]?.id ?? 0;
  return filtered.value.filter((e) => e.id > top).length;
});
watch([kind, onlyGuard], () => frozen.value && (frozen.value = filtered.value.slice(0, FEED_SHOW)));
function rowText(e: EventDto): string {
  // 醒目留言只记录，不触发特效
  if (e.kind === 'sc') return describe(e);
  const parts = e.kind === 'enter' ? [] : [describe(e)];
  if (e.status === 'played' || e.status === 'queued') parts.push(`${e.status === 'played' ? '已播放' : '排队中'} ${effectById(e.effectId)?.name ?? ''}`);
  else if (e.rule) parts.push(`${statusText(e.status)}，未播放`);
  else parts.push(e.status === 'blacklist' ? '黑名单，未播放' : '未触发特效');
  return parts.join(' · ');
}
const pick = (viewer: Viewer, x: number, y: number) => (menu.value = { viewer, x, y });
</script>

<template>
  <section class="page ov">
    <h1 class="sr-only">总览</h1>
    <div v-if="needSetup" class="guide">
      <b>开始使用：</b>
      <ol>
        <li v-for="(x, i) in setupSteps" :key="x.name" :class="{ done: x.done }"><Icon :name="x.done ? 'i-check' : 'i-todo'" />{{ i + 1 }}. <a :href="x.href" @click="(e) => x.qr && !x.done && (e.preventDefault(), (ui.qr = true))">{{ x.name }}</a></li>
      </ol>
    </div>

    <div v-if="roomId" class="ov-top">
      <!-- 直播间 -->
      <div class="card ov-room">
        <div class="ov-cover" :class="{ off: !live }">
          <img v-if="cover" :src="cover" alt="" referrerpolicy="no-referrer" @error="coverFailed = true" />
          <div v-else class="ph"><Avatar :name="anchorName" :face="info?.anchor.face" /></div>
          <span class="badge" :class="{ off: !live }"><i v-if="live" />{{ live ? '直播中' : '未开播' }}</span>
          <span v-if="live && since" class="dur num">{{ hms(now - since) }}</span>
        </div>
        <div class="ov-meta">
          <div class="ov-title" :title="info?.title">{{ info?.title || '（正在获取直播间信息）' }}</div>
          <div class="ov-anchor">
            <Avatar :name="anchorName" :face="info?.anchor.face" />
            <b>{{ anchorName }}</b>
            <span v-if="area" class="sub">{{ area }}</span>
          </div>
          <div class="ov-tags">
            <span class="pill">{{ timeLine }}</span>
            <a class="pill" :href="`https://live.bilibili.com/${roomId}`" target="_blank" rel="noopener">房间 <b class="num">{{ s?.room?.shortId || roomId }}</b><Icon name="i-ext" /></a>
            <span v-if="live" class="pill">房管 <b class="num">{{ s?.live.adminCount }}</b> 人</span>
          </div>
        </div>
      </div>

      <!-- 状态：一切正常，还是哪里有问题 -->
      <div class="card ov-health" :class="health.level" role="status">
        <div class="oh-h"><span class="oh-dot" :class="{ pulse: health.level === 'ok' }" /><b>{{ health.title }}</b></div>
        <ul class="oh-list">
          <li v-for="c in checks" :key="c.key" :class="c.level">
            <span class="oh-n">{{ c.name }}</span>
            <span class="oh-t">{{ c.text }}</span>
            <button v-if="c.action && (c.level === 'bad' || c.level === 'warn')" class="btn sm" :class="{ primary: c.level === 'bad' }" type="button" @click="c.action.run">{{ c.action.label }}</button>
          </li>
        </ul>
      </div>
    </div>

    <!-- 数据：星临自己统计的两项 + B站直播间的四项（B站只标一次） -->
    <div v-if="roomId" class="card ov-kpis">
      <div class="card-h">
        <h2>{{ scope === 'today' ? '今天' : stats?.live || live ? '本场直播' : '上一场直播' }}</h2>
        <span class="aside">{{ scopeText }}<Seg :model-value="scope" label="数据范围" :options="[{ value: 'live', label: live ? '本场' : '上一场' }, { value: 'today', label: '今天' }]" @change="(v) => (picked = v)" /></span>
      </div>
      <div class="kstrip">
        <div class="kg">
          <div title="同一个人进场多次只算一次"><small>进场观众</small><span class="v num">{{ stats ? stats.enterUnique.toLocaleString('zh-CN') : '—' }}</span><div class="d">其中大航海 <b class="num">{{ stats?.guardUnique ?? 0 }}</b> 人</div></div>
          <div><small>播放特效</small><span class="v num">{{ stats ? stats.played.toLocaleString('zh-CN') : '—' }}</span><div class="d">其中大航海 <b class="num">{{ stats?.guardPlayed ?? 0 }}</b> 次</div></div>
        </div>
        <div class="kg bili">
          <span class="src">B站</span>
          <div><small>看过</small><span class="v num">{{ live ? bigNum(info?.watched) : '—' }}</span><div class="d">{{ live ? '本场累计' : '开播后显示' }}</div></div>
          <div><small>高能榜</small><span class="v num">{{ live ? bigNum(info?.rankCount) : '—' }}</span><div class="d">{{ live ? '在线并登录的观众' : '开播后显示' }}</div></div>
          <div><small>点赞</small><span class="v num">{{ live ? bigNum(info?.likes) : '—' }}</span><div class="d">{{ live ? '本场累计' : '开播后显示' }}</div></div>
          <div><small>粉丝</small><span class="v num">{{ bigNum(info?.followers) }}</span><div class="d"><template v-if="info?.fansClub">粉丝团 <b class="num">{{ bigNum(info.fansClub) }}</b> 人</template><template v-else>&nbsp;</template></div></div>
        </div>
      </div>
    </div>

    <div class="ov-main">
      <div class="card ov-feed">
        <div class="card-h"><h2>实时动态</h2><span class="aside"><span v-if="frozen" class="hold"><i />暂停滚动{{ newWhileFrozen ? ` · 新来 ${newWhileFrozen} 条` : '' }}</span><template v-else>点任意一行可设置专属特效</template><span v-if="s?.live.connection === 'connected'" class="live" style="height: 22px"><i />LIVE</span></span></div>
        <div class="fbar">
          <Seg v-model="kind" label="实时动态筛选" :options="[{ value: 'all', label: '全部' }, { value: 'enter', label: '进场' }, { value: 'danmu', label: '弹幕' }, { value: 'gift', label: '礼物 / SC' }, { value: 'guard', label: '上舰' }]" />
          <label>只看大航海<Switch v-model="onlyGuard" label="只看大航海" /></label>
        </div>
        <div class="feed" @mouseenter="frozen = feed.slice()" @mouseleave="frozen = null">
          <div v-for="e in feed" :key="e.id" class="feed-row" @click="(ev) => (menu = { viewer: e.viewer, x: ev.clientX, y: ev.clientY })">
            <Avatar :name="e.uname" :face="e.viewer.face" :guard="e.viewer.guard" />
            <span class="who">
              <b>{{ e.uname }}</b>
              <span><EvIcon v-if="e.kind !== 'enter'" :kind="e.kind" :img="e.payload?.icon" />{{ rowText(e) }}</span>
            </span>
            <span class="ids"><HonorMedal :level="e.viewer.honor" /><IdTag :viewer="e.viewer" /></span>
            <time class="num">{{ clock(e.ts) }}</time>
            <span class="rowact" aria-hidden="true"><Icon name="i-more" /></span>
          </div>
          <div v-if="!feed.length" class="soon-box" style="border: 0; background: none">
            <template v-if="kind !== 'all' || onlyGuard"><b>没有符合的动态</b>换个筛选试试（这里只看最近 {{ state.feed.length }} 条，更早的在「事件记录」里查）</template>
            <template v-else><b>还没有动态</b>开播后，观众进场、弹幕、礼物会实时出现在这里</template>
          </div>
        </div>
      </div>

      <div class="ov-col">
        <div class="card ov-quick">
          <div class="card-h"><h2>素材快捷播放</h2><span class="aside"><template v-if="state.quick.some((b) => b.hotkey)">按钮上的键也能按</template><a class="linkish" href="#quickplay">{{ state.quick.length ? '管理 →' : '去添加 →' }}</a></span></div>
          <QuickPad v-if="state.quick.length" no-warn />
          <p v-else class="qp-tip">把常用的素材做成按钮，直播时点一下就能播。</p>
        </div>

        <MusicMini v-if="music.settings?.enabled" />

        <div class="card ov-panel">
          <OvPanel :scope="scope" :guard-came="stats?.guardUnique" @pick="pick" />
        </div>

        <div class="card">
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
        <div class="sub-h">荣耀等级分布</div>
        <div class="stack">
          <template v-for="[k, , c] in HONOR" :key="k">
            <i v-if="stats && stats.honor[k]" :style="{ width: `${Math.max((stats.honor[k] / honorTotal) * 100, 1.2)}%`, background: c }" />
          </template>
          <i v-if="!honorTotal" style="width: 100%; background: var(--hover)" />
        </div>
        <div class="legend">
          <div v-for="[k, name, c] in HONOR" :key="k"><i :style="{ background: c }" />{{ name }}<b class="num">{{ stats?.honor[k] ?? 0 }}</b></div>
        </div>
        </div>
      </div>
    </div>
    <ViewerMenu v-if="menu" :viewer="menu.viewer" :x="menu.x" :y="menu.y" @close="menu = null" />
  </section>
</template>
