<script setup lang="ts">
// 设置 → 桌面版：开机自动启动、检查更新、数据文件夹。这些功能由桌面版窗口提供（preload.ts），用浏览器打开后台时只显示说明
import { onMounted, ref } from 'vue';
import { desktop as bridge, type DesktopInfo } from '../lib/desktop.ts';
import { toast } from '../lib/toast.ts';
import Icon from './Icon.vue';
import Switch from './Switch.vue';

const info = ref<DesktopInfo | null>(null);
const autoStart = ref(false);

onMounted(async () => {
  if (!bridge) return;
  info.value = await bridge.info();
  autoStart.value = info.value.autoStart;
});

async function toggleAuto(on: boolean): Promise<void> {
  if (!bridge) return;
  autoStart.value = await bridge.setAutoStart(on);
  toast(autoStart.value ? '已打开开机自动启动：开机后星临在托盘里运行，不弹窗口' : '已关闭开机自动启动', 'ok');
}
</script>

<template>
  <div class="card">
    <div class="card-h"><h2>桌面版</h2><span v-if="info" class="aside num">版本 {{ info.version }}</span></div>
    <template v-if="bridge && info">
      <div class="toggle-line">开机自动启动 <span class="hint">开机后在右下角托盘里运行，不弹出窗口</span><Switch v-model="autoStart" label="开机自动启动" @change="toggleAuto" /></div>
      <div class="acct-actions">
        <button class="btn" :disabled="!info.canUpdate" @click="bridge.checkUpdate()"><Icon name="i-update" />检查更新</button>
        <button class="btn" @click="bridge.openDataDir()">打开数据文件夹</button>
        <button class="btn" @click="bridge.openLogs()">打开日志</button>
      </div>
      <p class="hint" style="margin: 12px 0 0; font-size: 12px; color: var(--t3)">关闭窗口时星临会缩到右下角托盘，直播特效照常播放；要退出请右键托盘图标 →「退出星临」。素材、规则和设置都在数据文件夹里，卸载或升级不会删除。</p>
    </template>
    <p v-else style="margin: 0; font-size: 13px; color: var(--t2)">开机自动启动、检查更新等设置，请在星临桌面版的窗口里修改。</p>
  </div>
</template>
