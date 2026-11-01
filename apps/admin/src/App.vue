<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import Sprite from './components/Sprite.vue';
import Icon from './components/Icon.vue';
import Avatar from './components/Avatar.vue';
import Logo from './components/Logo.vue';
import EffectEditor from './components/EffectEditor.vue';
import DesktopUpdateBar from './components/DesktopUpdateBar.vue';
import QuickExclusive from './components/QuickExclusive.vue';
import Palette from './components/Palette.vue';
import PreviewModal from './components/PreviewModal.vue';
import QrLogin from './components/QrLogin.vue';
import Wizard from './components/Wizard.vue';
import PageSkel from './components/PageSkel.vue';
import Login from './pages/Login.vue';
import Overview from './pages/Overview.vue';
import QuickPlay from './pages/QuickPlay.vue';
import Music from './pages/Music.vue';
import Rules from './pages/Rules.vue';
import Assets from './pages/Assets.vue';
import Events from './pages/Events.vue';
import Chat from './pages/Chat.vue';
import GiftList from './pages/GiftList.vue';
import Output from './pages/Output.vue';
import SettingsPage from './pages/Settings.vue';
import About from './pages/About.vue';
import { pauseBusy, pauseOnly, togglePause } from './lib/actions.ts';
import { get, post, setUnauthorizedHandler } from './lib/api.ts';
import { desktop } from './lib/desktop.ts';
import type { FxHint } from './lib/desktop.ts';
import { clock as clockText, duration } from './lib/format.ts';
import { startLive, stopLive } from './lib/live.ts';
import { confirmLeave, go, route } from './lib/route.ts';
import type { Page } from './lib/route.ts';
import { loadAll, output, refreshStatus, state, ui } from './lib/store.ts';
import { loadMusic, neteaseIssues } from './lib/music.ts';
import { toggleTheme } from './lib/theme.ts';
import { canAnimate } from './lib/motion.ts';
import { checkWhatsNew, seenWhatsNew, whatsNew } from './lib/whatsnew.ts';
import { attempt, runAction, toast, toasts } from './lib/toast.ts';

/** 侧栏按用途分组：开播时看的、特效、直播画面上的东西 */
const NAV_GROUPS: Array<{ label: string; items: Array<{ page: Page; name: string; icon: string }> }> = [
  { label: '工作台', items: [{ page: 'overview', name: '总览', icon: 'i-grid' }, { page: 'logs', name: '事件记录', icon: 'i-list' }] },
  { label: '特效', items: [{ page: 'rules', name: '触发规则', icon: 'i-wand' }, { page: 'assets', name: '素材库', icon: 'i-image' }, { page: 'quickplay', name: '素材快捷播放', icon: 'i-bolt' }] },
  {
    label: '直播画面',
    items: [{ page: 'chat', name: '弹幕列表', icon: 'i-chat' }, { page: 'giftlist', name: '送礼名单', icon: 'i-gift' }, { page: 'music', name: '弹幕点歌', icon: 'i-music' }, { page: 'obs', name: '直播软件输出', icon: 'i-screen' }],
  },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);
/** 手机底部导航的短名称 */
const SHORT: Partial<Record<Page, string>> = { overview: '总览', rules: '规则', assets: '素材', logs: '记录' };
/** 手机底部导航直接放的几页，其他的在「更多」里 */
const TABS = NAV.filter((n) => n.page in SHORT);
const moreOpen = ref(false);
// 自己打开了「关于」：更新提示算看过了
watch(() => route.value.page, (p) => p === 'about' && whatsNew.value && seenWhatsNew());
// 换了页面（包括点底栏其他标签）就收起
watch(() => route.value.page, () => (moreOpen.value = false));
// ---------- 页面：换页有过渡；回来时还在原来的位置 ----------
const PAGE_OF: Record<Page, Component> = { overview: Overview, quickplay: QuickPlay, music: Music, rules: Rules, assets: Assets, logs: Events, chat: Chat, giftlist: GiftList, obs: Output, settings: SettingsPage, about: About };
/** 换走以后留着的页面（回来时筛选、读过的记录都还在，不重新读）。有预览窗口、草稿的页面不留，省电脑资源 */
const KEEP = ['Overview', 'Events', 'Rules', 'Assets'];
const pageComp = computed(() => (state.ready ? PAGE_OF[route.value.page] : PageSkel));
/** 每一页离开时滚到哪里 */
const scrollPos = new Map<Page, number>();
watch(
  () => route.value.page,
  (_, old) => {
    const el = document.querySelector<HTMLElement>('.main > .page');
    if (old && el) scrollPos.set(old, el.scrollTop);
  },
  { flush: 'pre' },
);
function onPageEnter(el: Element): void {
  const p = el as HTMLElement;
  // 地址里带了要看的那一块（例如 #about/changelog）：滚到那里；否则回到上次的位置
  const sub = route.value.sub;
  const target = sub && /^[a-z-]+$/.test(sub) ? p.querySelector<HTMLElement>(`#${sub}`) : null;
  if (target) void nextTick(() => target.scrollIntoView({ block: 'start' }));
  else p.scrollTop = scrollPos.get(route.value.page) ?? 0;
}
/** 换页过渡：窗口藏着、设置了减少动画时不播 */
const pageTrans = () => (canAnimate() ? 'pg' : 'pg-off');

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function boot(): Promise<void> {
  try {
    state.desktop = (await get<{ desktop?: boolean }>('/api/auth/me')).desktop === true;
  } catch {
    state.authed = false;
    return;
  }
  state.authed = true;
  await attempt(loadAll);
  state.ready = true;
  checkWhatsNew(Boolean(state.settings?.onboarded));
  // 点歌：总览的小卡片、顶部的网易云登录提醒要用（读不到不影响别的）
  void loadMusic().catch(() => undefined);
  startLive();
  // 首次使用、还没设置好时自动打开新手引导（跳过或完成后不再弹出）
  const s = state.status;
  if (state.settings && !state.settings.onboarded && s && (!s.account.loggedIn || !s.room)) ui.wizard = true;
}

setUnauthorizedHandler(() => {
  if (state.authed === false) return;
  state.authed = false;
  stopLive();
});

async function logout(): Promise<void> {
  // 有没保存的修改：先问一下（退出图标就在主题按钮旁边，容易点错）
  if (!confirmLeave()) return;
  await attempt(() => post('/api/auth/logout'));
  stopLive();
  state.authed = false;
}

const paused = computed(() => state.status?.paused ?? false);

function onKey(e: KeyboardEvent): void {
  if (!state.authed) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && k === 'p') {
    e.preventDefault();
    // 按住不放时浏览器会连续触发，只认第一下
    if (!e.repeat) void pauseOnly();
  } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'k') {
    e.preventDefault();
    ui.palette = !ui.palette;
  }
}

// 和星临的实时连接：刚打开页面时还没连上不算断开；断开超过 5 秒才提醒
const wsDownLong = ref(false);
let wsTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => state.wsOnline,
  (on) => {
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = null;
    if (on) wsDownLong.value = false;
    else wsTimer = setTimeout(() => (wsDownLong.value = true), 5000);
  },
  { immediate: true },
);

/** 顶栏的连接状态：只写短词，完整原因放在鼠标悬停提示里 */
/** 查开播状态连着失败 3 分钟以上（偶尔一次不算） */
const checkFailing = computed(() => {
  const e = state.status?.live.checkError;
  return Boolean(e && now.value - e.since >= 3 * 60_000);
});
const conn = computed((): { cls: string; text: string; title?: string } => {
  const l = state.status?.live;
  if (!state.wsOnline) return wsDownLong.value ? { cls: 'warn', text: '和星临的连接断了' } : { cls: 'off', text: '正在连接…' };
  if (!l) return { cls: 'off', text: '…' };
  if (l.reason === 'no_room') return { cls: 'warn', text: '未设置直播间' };
  if (l.reason === 'not_logged_in') return { cls: 'warn', text: '未登录 B站' };
  if (l.reason === 'offline' && checkFailing.value) return { cls: 'warn', text: '查不到开播状态', title: l.checkError!.text };
  if (l.reason === 'offline') return { cls: 'off', text: '待机 · 开播后自动连接' };
  if (l.loginInvalid) return { cls: 'warn', text: 'B站登录失效', title: l.connectionDetail ?? undefined };
  if (l.connection === 'connected') return { cls: '', text: '已连接' };
  return { cls: 'warn', text: l.connection === 'reconnecting' ? '重连中' : '连接中', title: l.connectionDetail ?? undefined };
});

/** 特效页（直播软件里的浏览器源）在不在线 */
const fxOnline = computed(() => (state.status?.overlays ?? 0) > 0);
const isLive = computed(() => Boolean(state.status?.live.live));
// 直播氛围：开播时在总览把直播间封面模糊后铺在窗口顶部当光源，侧栏、顶栏、卡片半透明能透出光。
// 只在总览：那里看得到封面；其他页面是改设置的地方，保持安静，也少占显卡。封面加载失败就不显示
const ambFailed = ref(false);
const liveCover = computed(() => (isLive.value && route.value.page === 'overview' && !ambFailed.value ? (state.roomInfo?.cover ?? '') : ''));
watch(() => state.roomInfo?.cover, () => (ambFailed.value = false));
// 直播中特效页一直不在线才提醒（特效页自动更新、刷新会断开一两秒，不算）
const fxDownLong = ref(false);
let fxTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => isLive.value && state.wsOnline && !fxOnline.value,
  (bad) => {
    if (fxTimer) clearTimeout(fxTimer);
    fxTimer = null;
    if (!bad) fxDownLong.value = false;
    else fxTimer = setTimeout(() => (fxDownLong.value = true), 20_000);
  },
  { immediate: true },
);

// 桌面版：直播软件开着但特效页一直没连上、这次端口变了时，桌面版告诉后台怎么办（apps/desktop/src/main.ts watchFx）
const fxHint = ref<FxHint | null>(null);
void desktop?.fxHint?.().then((h) => (fxHint.value = h), () => undefined);
const offFxHint = desktop?.onFxHint?.((h) => (fxHint.value = h));
onBeforeUnmount(() => offFxHint?.());
const portMoved = computed(() => (fxHint.value && fxHint.value.port !== fxHint.value.home ? fxHint.value : null));

/** 顶部提醒条：会让特效播不出来的情况 */
type Alert = { key: string; level: 'red' | 'amber'; title: string; text: string; action?: { label: string; run: () => void } };
const dismissed = ref<string[]>([]);
const alerts = computed((): Alert[] => {
  const out: Alert[] = [];
  const s = state.status;
  if (wsDownLong.value) {
    out.push({ key: 'ws', level: 'amber', title: '和星临的连接断了', text: '正在自动重连，页面上的状态可能不是最新的。' });
    return out;
  }
  if (!s) return out;
  const a = s.account;
  const days = a.loggedIn && a.expiresAt ? Math.floor((a.expiresAt - now.value) / 86400_000) : null;
  const rescan = { label: '重新扫码', run: () => (ui.qr = true) };
  if (s.live.loginInvalid) out.push({ key: 'login', level: 'red', title: 'B站登录失效了', text: '收不到直播间的消息，特效不会播放。扫码重新登录就能恢复。', action: rescan });
  else if (days !== null && days < 0) out.push({ key: 'login', level: 'red', title: 'B站登录已过期', text: '收不到直播间的消息，特效不会播放。扫码重新登录就能恢复。', action: rescan });
  else if (s.room && !a.loggedIn && s.live.live) out.push({ key: 'login', level: 'red', title: '还没登录 B站', text: '收不到直播间的消息，特效不会播放。', action: { label: '扫码登录', run: () => (ui.qr = true) } });
  if (checkFailing.value && !s.live.live) out.push({ key: 'check', level: 'amber', title: '查不到开播状态', text: `从 ${clockText(s.live.checkError!.since).slice(0, 5)} 起一直查不到（${s.live.checkError!.text}）。这期间开播了也发现不了，特效不会播放。多半是 B 站暂时限制了这台服务器，通常会自己恢复；一直不好可以在设置里把「连接直播间」改成「一直连接」。` });
  else if (days !== null && days <= 3) out.push({ key: `expire${days}`, level: 'amber', title: `B站登录还剩 ${days} 天`, text: '到期后收不到直播间的消息，建议现在就重新扫码。', action: rescan });
  // 点歌页自己会提醒
  if (route.value.page !== 'music' && neteaseIssues(now.value).some((x) => x.key === 'invalid')) out.push({ key: 'netease', level: 'amber', title: '网易云登录失效了', text: '点歌时会员歌放不了，免费歌照常。重新扫码就能恢复。', action: { label: '去看看', run: () => go('music') } });
  const h = fxHint.value;
  const toObs = { label: portMoved.value ? '去复制新地址' : '去检查', run: () => go('obs') };
  if (fxDownLong.value) out.push({ key: 'fx', level: 'red', title: '正在直播，但特效页没连上', text: `直播软件里的特效页不在线，观众看不到特效。${h?.fix ?? '可以在直播软件里右键特效源，点「刷新」。'}`, action: toObs });
  else if (h?.app && !fxOnline.value) out.push({ key: 'fxapp', level: 'amber', title: `${h.app}已经打开，但特效页没连上`, text: h.fix, action: portMoved.value ? toObs : undefined });
  else if (portMoved.value && !fxOnline.value) {
    const p = portMoved.value;
    out.push({ key: 'port', level: 'amber', title: `这次星临改用 ${p.port} 端口`, text: `${p.home} 被别的程序占用。特效页连不上的话，到「直播软件输出」复制新地址换上，以后新旧地址都能用。`, action: toObs });
  }
  // 总览的状态卡片里已经写着特效页、B站登录的问题（带修复按钮），总览上不再重复显示横幅
  const inCard = (k: string) => route.value.page === 'overview' && (k === 'fx' || k === 'login' || k.startsWith('expire'));
  return out.filter((x) => !inCard(x.key) && (x.level === 'red' || !dismissed.value.includes(x.key)));
});

/** 导航「弹幕点歌」旁的小圆点：网易云快到期（橙）、出问题（红） */
const musicIssues = computed(() => neteaseIssues(now.value));
const musicDot = computed(() => musicIssues.value[0]?.level ?? null);
const musicIssue = computed(() => musicIssues.value.map((x) => x.short).join('；'));

const liveText = computed(() => {
  const l = state.status?.live;
  if (!l?.live) return '未开播';
  return l.liveSince ? `直播中 · ${duration(now.value - l.liveSince)}` : '直播中';
});
const acct = computed(() => state.status?.account);
const acctDays = computed(() => {
  const a = acct.value;
  if (!a?.loggedIn || !a.expiresAt) return '';
  const d = Math.floor((a.expiresAt - now.value) / 86400_000);
  if (state.status?.live.loginInvalid) return '登录已失效，点这里重新扫码';
  return d >= 0 ? `登录有效 · 剩余 ${d} 天` : '登录已过期，点这里重新扫码';
});
/** 侧边栏账号：没登录或登录失效时直接弹出扫码 */
function onAcct(e: MouseEvent): void {
  const a = acct.value;
  const bad = !a?.loggedIn || state.status?.live.loginInvalid || (a.expiresAt !== undefined && a.expiresAt !== null && a.expiresAt < now.value);
  if (!bad) return;
  e.preventDefault();
  ui.qr = true;
}

// 预览区域按输出方向显示（竖屏 / 横屏）
watch(
  () => output()?.orient,
  (o) => (document.documentElement.dataset.orient = o ?? 'portrait'),
  { immediate: true },
);
document.documentElement.dataset.safe = 'on';

// 文件拖到不接收的地方：不让浏览器直接打开文件、离开后台
function onWinDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files') && !e.defaultPrevented) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  }
}
function onWinDrop(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files') || e.defaultPrevented) return;
  e.preventDefault();
  toast('要上传素材的话，请把文件拖到「素材库」页面', 'info', 3500, { label: '去素材库', run: () => go('assets') });
}

onMounted(() => {
  void boot();
  addEventListener('dragover', onWinDragOver);
  addEventListener('drop', onWinDrop);
  addEventListener('keydown', onKey);
  clock = setInterval(() => (now.value = Date.now()), 30_000);
  // 账号有效期、开播状态等每分钟校对一次（实时连接断开时也能恢复）
  poll = setInterval(() => state.authed && void refreshStatus().catch(() => undefined), 60_000);
});
onBeforeUnmount(() => {
  removeEventListener('keydown', onKey);
  removeEventListener('dragover', onWinDragOver);
  removeEventListener('drop', onWinDrop);
  if (clock) clearInterval(clock);
  if (poll) clearInterval(poll);
  if (wsTimer) clearTimeout(wsTimer);
  if (fxTimer) clearTimeout(fxTimer);
});

/** 刷新后台页面（有没保存的修改时浏览器会先确认） */
function reloadPage(): void {
  location.reload();
}
</script>

<template>
  <Sprite />
  <div v-if="state.authed === null" class="login"><span class="spin" /></div>
  <Login v-else-if="!state.authed" @done="boot" />
  <template v-else>
    <div class="app" :class="{ stale: wsDownLong, lit: Boolean(liveCover) }">
      <img v-if="liveCover" class="amb" :src="liveCover" alt="" aria-hidden="true" referrerpolicy="no-referrer" @error="ambFailed = true" />
      <aside class="side">
        <div class="brand">
          <Logo :size="32" />
          <span><div class="brand-name">星临</div><div class="brand-sub">STARFALL</div></span>
        </div>
        <div v-for="g in NAV_GROUPS" :key="g.label">
          <div class="nav-label">{{ g.label }}</div>
          <nav class="nav" :aria-label="g.label">
            <a v-for="n in g.items" :key="n.page" :href="`#${n.page}`" :aria-current="route.page === n.page ? 'page' : 'false'"><Icon :name="n.icon" />{{ n.name }}<span v-if="n.page === 'music' && musicDot" class="ndot" :class="musicDot" :title="musicIssue" /></a>
          </nav>
        </div>
        <div>
          <div class="nav-label">其他</div>
          <nav class="nav" aria-label="其他">
            <a href="#about" :aria-current="route.page === 'about' ? 'page' : 'false'"><Icon name="i-info" />关于</a>
            <a href="#settings" :aria-current="route.page === 'settings' ? 'page' : 'false'"><Icon name="i-gear" />设置</a>
          </nav>
        </div>
        <div class="side-foot">
          <span v-if="!state.status" class="acct skel-acct" aria-hidden="true"><span class="skel round" style="width: 32px; height: 32px; flex: none" /><span class="acct-meta" style="gap: 6px; flex: 1"><span class="skel line" style="width: 60%" /><span class="skel line" style="width: 85%; height: 10px" /></span></span>
          <a v-else class="acct" href="#settings" @click="onAcct">
            <template v-if="acct?.loggedIn">
              <Avatar :name="acct.name" :face="acct.face" />
              <span class="acct-meta"><b>{{ acct.name }}</b><span>{{ acctDays || `UID ${acct.uid}` }}</span></span>
            </template>
            <template v-else>
              <span class="avatar" style="background: var(--line-strong)"><Icon name="i-user" /></span>
              <span class="acct-meta"><b>未登录 B站</b><span>点这里扫码登录</span></span>
            </template>
          </a>
        </div>
      </aside>

      <div class="main">
        <header class="top">
          <div v-if="state.status && !state.status.room" class="crumb"><a class="linkish" href="#settings">设置直播间</a></div>
          <span v-if="!state.status" class="skel pill" style="width: 260px; height: 30px" aria-hidden="true" />
          <span v-else class="status-group">
            <span class="live" :class="conn.cls" :title="conn.title"><i />{{ conn.text }}</span>
            <span class="livestate" :class="{ on: state.status?.live.live }"><i />{{ liveText }}</span>
            <a v-if="state.status" class="live fxlamp" :class="fxOnline ? '' : isLive ? 'warn' : 'off'" href="#obs" :title="fxOnline ? '直播软件里的特效页在线' : '直播软件里的特效页不在线，点这里查看怎么添加'"><i />特效页{{ fxOnline ? '在线' : '不在线' }}</a>
          </span>
          <button class="search" aria-label="打开命令面板" @click="ui.palette = true"><Icon name="i-search" />搜索或执行命令<span class="kbd">Ctrl K</span></button>
          <button class="pausebtn" :class="{ busy: pauseBusy }" :aria-pressed="paused" :aria-busy="pauseBusy" title="快捷键 Ctrl + Shift + P（快捷键只暂停，恢复请点按钮）" @click="togglePause"><Icon name="i-pause" /><span>{{ paused ? '已暂停' : '暂停所有特效' }}</span></button>
          <button class="icon-btn" aria-label="切换亮色 / 暗色" @click="(e) => toggleTheme((e.currentTarget as HTMLElement).getBoundingClientRect().left + 17, (e.currentTarget as HTMLElement).getBoundingClientRect().top + 17)">
            <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
          </button>
          <button v-if="!state.desktop" class="icon-btn" aria-label="退出后台登录" title="退出后台登录" @click="logout"><Icon name="i-logout" /></button>
        </header>
        <!-- 「关于」页里有同样的一份，在那一页时顶部不重复显示 -->
        <DesktopUpdateBar v-if="state.desktop && route.page !== 'about'" />
        <!-- 顶部提示条：滑下来，页面跟着让开；收起时滑回去 -->
        <TransitionGroup :name="canAnimate() ? 'bar' : 'bar-off'">
          <div v-if="whatsNew" key="whatsnew" class="bar-wrap">
            <div class="verbar" role="status">
              <Icon name="i-update" /><b>星临已更新到 v{{ whatsNew }}</b><span>这次新增和改进的内容可以在「关于」的更新记录里查看。</span>
              <button class="btn" @click="seenWhatsNew">知道了</button><button class="btn primary" @click="(seenWhatsNew(), go('about', 'changelog'))">看看改了什么</button>
            </div>
          </div>
          <div v-if="ui.newVersion && ui.newVersion !== ui.dismissedVersion" key="newver" class="bar-wrap">
            <div class="verbar" role="status">
              <Icon name="i-update" /><b>后台有新版本</b><span>刷新后就能用上新功能。正在编辑的内容请先保存。</span>
              <button class="btn" @click="ui.dismissedVersion = ui.newVersion">稍后</button><button class="btn primary" @click="reloadPage">刷新</button>
            </div>
          </div>
          <div v-for="a in alerts" :key="`alert-${a.key}`" class="bar-wrap">
            <div class="alertbar" :class="a.level" role="alert">
              <Icon :name="a.level === 'red' ? 'i-ban' : 'i-info'" /><b>{{ a.title }}</b><span>{{ a.text }}</span>
              <button v-if="a.level === 'amber' && a.key !== 'ws'" class="btn" @click="dismissed.push(a.key)">知道了</button>
              <button v-if="a.action" class="btn primary" @click="a.action.run">{{ a.action.label }}</button>
            </div>
          </div>
          <div v-if="paused" key="paused" class="bar-wrap">
            <div class="pausebar">
              <Icon name="i-pause" /><b>所有特效已暂停</b><span>正在播放的特效已经停下，排队的也清空了；观众暂时看不到任何特效，事件照常记录。</span>
              <button class="btn primary" :disabled="pauseBusy" @click="togglePause">恢复播放</button>
            </div>
          </div>
        </TransitionGroup>
        <Transition :name="pageTrans()" mode="out-in" @enter="onPageEnter">
          <KeepAlive :include="KEEP">
            <component :is="pageComp" />
          </KeepAlive>
        </Transition>
      </div>
    </div>

    <nav class="tabbar" aria-label="主导航（手机）">
      <a v-for="n in TABS" :key="n.page" :href="`#${n.page}`" :aria-current="route.page === n.page ? 'page' : 'false'"><Icon :name="n.icon" />{{ SHORT[n.page] }}</a>
      <button :aria-current="['quickplay', 'music', 'chat', 'giftlist', 'obs', 'about', 'settings'].includes(route.page) ? 'page' : 'false'" @click="moreOpen = !moreOpen"><Icon name="i-more" />更多</button>
    </nav>
    <div v-if="moreOpen" style="position: fixed; inset: 0; z-index: 44" @click="moreOpen = false" />
    <div v-if="moreOpen" class="sheet" @click="moreOpen = false">
      <a href="#quickplay"><Icon name="i-bolt" />素材快捷播放</a>
      <a href="#chat"><Icon name="i-chat" />弹幕列表</a>
      <a href="#music"><Icon name="i-music" />弹幕点歌</a>
      <a href="#giftlist"><Icon name="i-gift" />送礼名单</a>
      <a href="#obs" @click="go('obs')"><Icon name="i-screen" />直播软件输出</a>
      <a href="#about"><Icon name="i-info" />关于</a>
      <a href="#settings"><Icon name="i-gear" />设置</a>
    </div>

    <EffectEditor v-if="ui.editorId !== null" :key="ui.editorId" :effect-id="ui.editorId" @close="ui.editorId = null" />
    <QuickExclusive v-if="ui.quick" :key="ui.quick.uid" @close="ui.quick = null" />
    <Wizard v-if="ui.wizard" @close="ui.wizard = false" />
    <Palette v-if="ui.palette" @close="ui.palette = false" />
    <PreviewModal v-if="ui.preview" />
    <QrLogin v-if="ui.qr" @close="ui.qr = false" />
  </template>

  <TransitionGroup tag="div" class="toasts" name="toast" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ out: t.out }">
      <Icon :name="t.kind === 'err' ? 'i-ban' : t.kind === 'info' ? 'i-info' : 'i-check'" :style="t.kind === 'err' ? 'color:#D64545' : t.kind === 'info' ? 'color:var(--accent)' : ''" />{{ t.text }}<button v-if="t.action" type="button" class="toast-act" @click="runAction(t)">{{ t.action.label }}</button>
    </div>
  </TransitionGroup>
</template>
