<script setup lang="ts">
// 桌面版下载新版本时显示进度；下载好后可以直接「现在重启并安装」。放在窗口顶部，「关于」页里也放一份（inline）。用浏览器打开后台时不显示
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { desktop } from '../lib/desktop.ts';
import type { UpdateState } from '../lib/desktop.ts';
import { fileSize } from '../lib/format.ts';
import Icon from './Icon.vue';

defineProps<{ inline?: boolean }>();
const s = ref<UpdateState | null>(null);
/** 下载失败的提示点了关闭 */
const hideError = ref(false);
let off: (() => void) | undefined;
onMounted(async () => {
  if (!desktop?.onUpdateState) return;
  off = desktop.onUpdateState((v) => {
    if (v.phase === 'error' && s.value?.phase !== 'error') hideError.value = false;
    s.value = v;
  });
  s.value = await desktop.updateState().catch(() => null);
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div v-if="s?.phase === 'downloading'" class="verbar updbar" :class="{ inline }" role="status">
    <Icon name="i-update" /><b>正在下载新版本 {{ s.version }}</b>
    <span class="updbar-n">{{ Math.floor(s.percent) }}%<template v-if="s.total"> · {{ fileSize(s.transferred) }} / {{ fileSize(s.total) }}</template><template v-if="s.speed"> · {{ fileSize(s.speed) }}/秒</template></span>
    <span>在后台下载，不影响直播</span>
    <div class="updbar-track" role="progressbar" aria-label="下载进度" :aria-valuenow="Math.floor(s.percent)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${s.percent}%` }" /></div>
  </div>
  <div v-else-if="s?.phase === 'downloaded'" class="verbar" :class="{ inline }" role="status">
    <Icon name="i-update" /><b>新版本 {{ s.version }} 已下载好</b>
    <span>重启后安装（大约半分钟），Windows 会问一次是否允许更改，点「是」。正在直播的话建议下播后再装；不装的话，退出星临时会自动安装。</span>
    <button class="btn primary" @click="desktop?.installUpdate()">现在重启并安装</button>
  </div>
  <div v-else-if="s?.phase === 'error' && !hideError" class="verbar updbar-err" :class="{ inline }" role="alert">
    <Icon name="i-info" /><b>下载新版本失败</b><span>网络不稳或连不上 GitHub 时会这样，可以重试，或到 GitHub 发布页手动下载安装包（{{ s.error }}）</span>
    <div class="updbar-act"><button class="btn" @click="hideError = true">关闭</button><button class="btn primary" @click="desktop?.checkUpdate()">重试</button></div>
  </div>
</template>

<style scoped>
.verbar.inline { margin-top: 10px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; }
.updbar-n { font-variant-numeric: tabular-nums; }
.updbar-act { display: flex; gap: 8px; margin-left: auto; }
.updbar-track { flex-basis: 100%; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.updbar-track i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
.updbar-err { background: rgba(214, 69, 69, .08); color: #C03A3A; }
[data-theme="dark"] .updbar-err { color: #FF8A8A; }
</style>
