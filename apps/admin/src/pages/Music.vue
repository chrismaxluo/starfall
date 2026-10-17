<script setup lang="ts">
// 弹幕点歌：观众发「点歌 歌名」，歌排进列表，在直播画面上的点歌窗口里播放。
// 顶部是开关、复制点歌窗口地址；为什么没在放写在一条提醒里，网易云的问题（登录失效、会员到期、拿不到歌）在主页以外的页也提醒。
// 下面分五页：主页、规则、画面、歌库、历史
import { computed, onMounted } from 'vue';
import { MUSIC_HEIGHT, MUSIC_WIDTH } from '@starfall/shared/overlay';
import Icon from '../components/Icon.vue';
import Switch from '../components/Switch.vue';
import MusicHistory from '../components/MusicHistory.vue';
import MusicLibrary from '../components/MusicLibrary.vue';
import MusicLook from '../components/MusicLook.vue';
import MusicPlay from '../components/MusicPlay.vue';
import MusicRules from '../components/MusicRules.vue';
import { post } from '../lib/api.ts';
import { HOLD_TEXT, copyMusicUrl, loadMusic, music, neteaseIssues, saveMusic } from '../lib/music.ts';
import { go, route } from '../lib/route.ts';
import { state } from '../lib/store.ts';
import { attempt } from '../lib/toast.ts';

const TABS = [
  { key: 'play', label: '主页' },
  { key: 'rules', label: '规则' },
  { key: 'look', label: '画面' },
  { key: 'library', label: '歌库' },
  { key: 'history', label: '历史' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const tab = computed<Tab>(() => (TABS.some((t) => t.key === route.value.sub) ? (route.value.sub as Tab) : 'play'));

onMounted(() => void attempt(loadMusic));

const hold = computed(() => music.state?.hold ?? null);
async function resume(): Promise<void> {
  await attempt(() => post('/api/music/pause', { paused: false }), state.status?.live.live ? '继续放歌' : '没开播也开始放歌（下播前不会再自动暂停）');
}
/** 网易云的问题：主页的网易云卡片上写着，别的页用提醒条 */
const issues = computed(() => (tab.value === 'play' ? [] : neteaseIssues()));
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>弹幕点歌</h1>
        <p>观众发弹幕「{{ music.settings?.cmdRequest ?? '点歌' }} 歌名」，歌会排进列表，在直播画面上的点歌窗口里播放。</p>
      </div>
      <div v-if="music.settings" class="mu-head-r">
        <button class="btn" :title="`在直播软件里加一个浏览器源，宽高填 ${MUSIC_WIDTH} × ${MUSIC_HEIGHT}`" @click="copyMusicUrl"><Icon name="i-copy" />复制点歌窗口地址</button>
        <span class="mu-sw">点歌 <Switch :model-value="music.settings.enabled" label="点歌开关" @change="(v) => saveMusic({ enabled: v }, v ? '已打开点歌：观众可以发弹幕点歌了' : '已关闭点歌：正在放的歌停下，列表保留')" /></span>
      </div>
    </div>

    <div v-if="!music.loaded" class="inline-hint">读取中…</div>
    <template v-else>
      <div v-if="hold && hold !== 'manual'" class="mu-alert" :class="{ warn: hold !== 'offline' }">
        <Icon name="i-info" /><span>{{ HOLD_TEXT[hold] }}</span>
        <button v-if="hold === 'disabled'" class="btn sm primary" @click="saveMusic({ enabled: true }, '已打开点歌')">打开点歌</button>
        <button v-else-if="hold === 'no_player'" class="btn sm" @click="go('obs')">去添加</button>
        <button v-else-if="hold === 'offline' && (music.state?.now || music.state?.total)" class="btn sm" @click="resume">现在就放</button>
      </div>
      <div v-for="x in issues" :key="x.key" class="mu-alert" :class="x.level"><Icon name="i-info" /><span>{{ x.text }}</span><button class="btn sm" @click="go('music')">去主页看看</button></div>

      <nav class="mu-tabs seg" role="tablist" aria-label="弹幕点歌">
        <button v-for="t in TABS" :key="t.key" role="tab" type="button" :aria-pressed="tab === t.key" :aria-selected="tab === t.key" @click="go('music', t.key === 'play' ? '' : t.key)">
          {{ t.label }}<span v-if="t.key === 'play' && music.state?.total" class="mu-cnt">{{ music.state.total }}</span><span v-if="t.key === 'library' && music.libraryCount" class="mu-cnt">{{ music.libraryCount }}</span>
        </button>
      </nav>

      <MusicPlay v-if="tab === 'play'" />
      <MusicRules v-else-if="tab === 'rules'" />
      <MusicLook v-else-if="tab === 'look'" />
      <MusicLibrary v-else-if="tab === 'library'" />
      <MusicHistory v-else />
    </template>
  </section>
</template>

<style scoped>
.mu-head-r { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
.mu-sw { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--t2); padding-left: 4px; }
.mu-alert { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 10px 14px; border-radius: 12px; background: var(--accent-soft); color: var(--t1); font-size: 13px; }
.mu-alert svg { width: 16px; height: 16px; flex: none; color: var(--accent); }
.mu-alert.warn { background: var(--gov-soft); }
.mu-alert.warn svg { color: var(--gov); }
.mu-alert.bad { background: var(--bad-soft); }
.mu-alert.bad svg { color: var(--bad); }
.mu-alert .btn { margin-left: auto; height: 28px; font-size: 12.5px; }
.mu-tabs { margin-bottom: 16px; }
.mu-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 0 16px; }
.mu-cnt { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font: 600 11px/18px var(--font-mono); background: var(--accent-soft); color: var(--accent); text-align: center; }
</style>
