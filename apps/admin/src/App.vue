<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Sprite from './components/Sprite.vue';
import Icon from './components/Icon.vue';
import Avatar from './components/Avatar.vue';
import Logo from './components/Logo.vue';
import EffectEditor from './components/EffectEditor.vue';
import QuickExclusive from './components/QuickExclusive.vue';
import Palette from './components/Palette.vue';
import PreviewModal from './components/PreviewModal.vue';
import QrLogin from './components/QrLogin.vue';
import Wizard from './components/Wizard.vue';
import Login from './pages/Login.vue';
import Overview from './pages/Overview.vue';
import QuickPlay from './pages/QuickPlay.vue';
import Rules from './pages/Rules.vue';
import Assets from './pages/Assets.vue';
import Events from './pages/Events.vue';
import Output from './pages/Output.vue';
import SettingsPage from './pages/Settings.vue';
import About from './pages/About.vue';
import { pauseOnly, togglePause } from './lib/actions.ts';
import { get, post, setUnauthorizedHandler } from './lib/api.ts';
import { duration } from './lib/format.ts';
import { startLive, stopLive } from './lib/live.ts';
import { go, route } from './lib/route.ts';
import type { Page } from './lib/route.ts';
import { loadAll, output, refreshStatus, state, ui } from './lib/store.ts';
import { toggleTheme } from './lib/theme.ts';
import { attempt, runAction, toast, toasts } from './lib/toast.ts';

const NAV: Array<{ page: Page; name: string; icon: string }> = [
  { page: 'overview', name: '总览', icon: 'i-grid' },
  { page: 'quickplay', name: '素材快捷播放', icon: 'i-bolt' },
  { page: 'rules', name: '触发规则', icon: 'i-wand' },
  { page: 'assets', name: '素材库', icon: 'i-image' },
  { page: 'logs', name: '事件记录', icon: 'i-list' },
  { page: 'obs', name: '直播软件输出', icon: 'i-screen' },
];
/** 手机底部导航的短名称 */
const SHORT: Partial<Record<Page, string>> = { overview: '总览', rules: '规则', assets: '素材', logs: '记录' };
/** 手机底部导航直接放的几页，其他的在「更多」里 */
const TABS = NAV.filter((n) => n.page in SHORT);
const moreOpen = ref(false);
// 换了页面（包括点底栏其他标签）就收起
watch(() => route.value.page, () => (moreOpen.value = false));
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function boot(): Promise<void> {
  try {
    await get('/api/auth/me');
  } catch {
    state.authed = false;
    return;
  }
  state.authed = true;
  await attempt(loadAll);
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
const conn = computed((): { cls: string; text: string; title?: string } => {
  const l = state.status?.live;
  if (!state.wsOnline) return wsDownLong.value ? { cls: 'warn', text: '和星临的连接断了' } : { cls: 'off', text: '正在连接…' };
  if (!l) return { cls: 'off', text: '…' };
  if (l.reason === 'no_room') return { cls: 'warn', text: '未设置直播间' };
  if (l.reason === 'not_logged_in') return { cls: 'warn', text: '未登录 B站' };
  if (l.reason === 'offline') return { cls: 'off', text: '待机 · 开播后自动连接' };
  if (l.loginInvalid) return { cls: 'warn', text: 'B站登录失效', title: l.connectionDetail ?? undefined };
  if (l.connection === 'connected') return { cls: '', text: '已连接' };
  return { cls: 'warn', text: l.connection === 'reconnecting' ? '重连中' : '连接中', title: l.connectionDetail ?? undefined };
});

/** 特效页（直播软件里的浏览器源）在不在线 */
const fxOnline = computed(() => (state.status?.overlays ?? 0) > 0);
const isLive = computed(() => Boolean(state.status?.live.live));
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
  else if (days !== null && days <= 3) out.push({ key: `expire${days}`, level: 'amber', title: `B站登录还剩 ${days} 天`, text: '到期后收不到直播间的消息，建议现在就重新扫码。', action: rescan });
  if (fxDownLong.value) out.push({ key: 'fx', level: 'red', title: '正在直播，但特效页没连上', text: '直播软件里的特效页不在线，观众看不到特效。', action: { label: '去检查', run: () => go('obs') } });
  return out.filter((x) => x.level === 'red' || !dismissed.value.includes(x.key));
});

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
    <div class="app" :class="{ stale: wsDownLong }">
      <aside class="side">
        <div class="brand">
          <Logo :size="32" />
          <span><div class="brand-name">星临</div><div class="brand-sub">STARFALL</div></span>
        </div>
        <div>
          <div class="nav-label">工作台</div>
          <nav class="nav" aria-label="主导航">
            <a v-for="n in NAV" :key="n.page" :href="`#${n.page}`" :aria-current="route.page === n.page ? 'page' : 'false'"><Icon :name="n.icon" />{{ n.name }}</a>
          </nav>
        </div>
        <div>
          <div class="nav-label">其他</div>
          <nav class="nav" aria-label="其他">
            <a href="/overlay/?demo=1" target="_blank" rel="noopener" title="在新标签里轮流播放所有内置特效（示例）"><Icon name="i-demo" />内置特效演示<Icon name="i-ext" /></a>
            <a href="#about" :aria-current="route.page === 'about' ? 'page' : 'false'"><Icon name="i-info" />关于</a>
            <a href="#settings" :aria-current="route.page === 'settings' ? 'page' : 'false'"><Icon name="i-gear" />设置</a>
          </nav>
        </div>
        <div class="side-foot">
          <a class="acct" href="#settings" @click="onAcct">
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
          <div class="crumb">
            <template v-if="state.status?.room">直播间 <b class="num">{{ state.status.room.shortId || state.status.room.roomId }}</b></template>
            <template v-else><a class="linkish" href="#settings">设置直播间</a></template>
          </div>
          <span class="live" :class="conn.cls" :title="conn.title"><i />{{ conn.text }}</span>
          <span class="livestate" :class="{ on: state.status?.live.live }"><i />{{ liveText }}</span>
          <a v-if="state.status" class="live fxlamp" :class="fxOnline ? '' : isLive ? 'warn' : 'off'" href="#obs" :title="fxOnline ? '直播软件里的特效页在线' : '直播软件里的特效页不在线，点这里查看怎么添加'"><i />特效页{{ fxOnline ? '在线' : '不在线' }}</a>
          <button class="search" aria-label="打开命令面板" @click="ui.palette = true"><Icon name="i-search" />搜索或执行命令<span class="kbd">Ctrl K</span></button>
          <button class="pausebtn" :aria-pressed="paused" title="快捷键 Ctrl + Shift + P（快捷键只暂停，恢复请点按钮）" @click="togglePause"><Icon name="i-pause" /><span>{{ paused ? '已暂停' : '暂停所有特效' }}</span></button>
          <button class="icon-btn" aria-label="切换亮色 / 暗色" @click="(e) => toggleTheme((e.currentTarget as HTMLElement).getBoundingClientRect().left + 17, (e.currentTarget as HTMLElement).getBoundingClientRect().top + 17)">
            <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
          </button>
          <button class="icon-btn" aria-label="退出后台登录" title="退出后台登录" @click="logout"><Icon name="i-logout" /></button>
        </header>
        <div v-if="ui.newVersion && ui.newVersion !== ui.dismissedVersion" class="verbar" role="status">
          <Icon name="i-update" /><b>后台有新版本</b><span>刷新后就能用上新功能。正在编辑的内容请先保存。</span>
          <button class="btn" @click="ui.dismissedVersion = ui.newVersion">稍后</button><button class="btn primary" @click="reloadPage">刷新</button>
        </div>
        <div v-for="a in alerts" :key="a.key" class="alertbar" :class="a.level" role="alert">
          <Icon :name="a.level === 'red' ? 'i-ban' : 'i-info'" /><b>{{ a.title }}</b><span>{{ a.text }}</span>
          <button v-if="a.level === 'amber' && a.key !== 'ws'" class="btn" @click="dismissed.push(a.key)">知道了</button>
          <button v-if="a.action" class="btn primary" @click="a.action.run">{{ a.action.label }}</button>
        </div>
        <div v-if="paused" class="pausebar">
          <Icon name="i-pause" /><b>所有特效已暂停</b><span>正在播放的特效已经停下，排队的也清空了；观众暂时看不到任何特效，事件照常记录。</span>
          <button class="btn primary" @click="togglePause">恢复播放</button>
        </div>
        <Overview v-if="route.page === 'overview'" />
        <QuickPlay v-else-if="route.page === 'quickplay'" />
        <Rules v-else-if="route.page === 'rules'" />
        <Assets v-else-if="route.page === 'assets'" />
        <Events v-else-if="route.page === 'logs'" />
        <Output v-else-if="route.page === 'obs'" />
        <SettingsPage v-else-if="route.page === 'settings'" />
        <About v-else-if="route.page === 'about'" />
      </div>
    </div>

    <nav class="tabbar" aria-label="主导航（手机）">
      <a v-for="n in TABS" :key="n.page" :href="`#${n.page}`" :aria-current="route.page === n.page ? 'page' : 'false'"><Icon :name="n.icon" />{{ SHORT[n.page] }}</a>
      <button :aria-current="['quickplay', 'obs', 'about', 'settings'].includes(route.page) ? 'page' : 'false'" @click="moreOpen = !moreOpen"><Icon name="i-more" />更多</button>
    </nav>
    <div v-if="moreOpen" style="position: fixed; inset: 0; z-index: 44" @click="moreOpen = false" />
    <div v-if="moreOpen" class="sheet" @click="moreOpen = false">
      <a href="#quickplay"><Icon name="i-bolt" />素材快捷播放</a>
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

  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ out: t.out }">
      <Icon :name="t.kind === 'err' ? 'i-ban' : t.kind === 'info' ? 'i-info' : 'i-check'" :style="t.kind === 'err' ? 'color:#D64545' : t.kind === 'info' ? 'color:var(--accent)' : ''" />{{ t.text }}<button v-if="t.action" type="button" class="toast-act" @click="runAction(t)">{{ t.action.label }}</button>
    </div>
  </div>
</template>
