<script setup lang="ts">
// 设置 → 数据：自动备份（F-DA-03）、事件记录保留期（F-DA-02）、导出 / 导入配置（F-DA-04）
import { onMounted, ref } from 'vue';
import { get, post, put, upload } from '../lib/api.ts';
import { fileSize } from '../lib/format.ts';
import { refreshSettings, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { BackupItem, ImportPreview, Settings } from '../lib/types.ts';
import Icon from './Icon.vue';
import ImportDialog from './ImportDialog.vue';
import Switch from './Switch.vue';

const backups = ref<BackupItem[]>([]);
const showAll = ref(false);
const running = ref(false);
const fileIn = ref<HTMLInputElement | null>(null);
const uploading = ref<number | null>(null);
const preview = ref<ImportPreview | null>(null);

async function load(): Promise<void> {
  backups.value = (await get<{ items: BackupItem[] }>('/api/backup/list').catch(() => ({ items: [] }))).items;
}
async function save(patch: Partial<Settings>, msg: string): Promise<void> {
  if (await attempt(() => put('/api/settings', patch), msg)) await refreshSettings();
}
async function runNow(): Promise<void> {
  running.value = true;
  if (await attempt(() => post('/api/backup/run'), '已备份')) await load();
  running.value = false;
}
/** 20260926-0400 → 9月26日 04:00 */
function when(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(stamp);
  return m ? `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}` : stamp;
}

async function pick(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement;
  const f = el.files?.[0];
  el.value = '';
  if (!f) return;
  uploading.value = 0;
  try {
    preview.value = await upload<ImportPreview>('/api/backup/import', f, (p) => (uploading.value = p));
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'err', 5000);
  } finally {
    uploading.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="state.settings" class="card">
    <div class="card-h"><h2>数据</h2></div>
    <div class="field">
      <div class="toggle-line">每天自动备份 <span class="hint">凌晨备份数据库和配置，保留最近 7 份</span>
        <Switch v-model="state.settings.autoBackup" label="每天自动备份" @change="(v) => save({ autoBackup: v }, v ? '已开启每天自动备份' : '已关闭自动备份')" />
      </div>
      <div class="bk-list">
        <div v-for="b in showAll ? backups : backups.slice(0, 2)" :key="b.stamp" class="bk-item">
          <span class="num">{{ when(b.stamp) }}</span><span class="sz">{{ fileSize(b.dbSize + b.configSize) }}</span>
          <a v-if="b.config" class="linkish" :href="`/api/backup/files/${b.config}`" download>下载配置</a>
        </div>
        <span v-if="!backups.length" class="inline-hint">还没有备份。</span>
        <div class="bk-foot">
          <button v-if="backups.length > 2" class="linkish" @click="showAll = !showAll">{{ showAll ? '收起' : `全部 ${backups.length} 份` }}</button>
          <button class="linkish" :disabled="running" @click="runNow">{{ running ? '正在备份…' : '立即备份' }}</button>
        </div>
      </div>
    </div>
    <div class="field" style="margin-top: 14px">
      <div class="slider-row">
        <label for="keep">事件记录保留</label>
        <select id="keep" class="sel" :value="state.settings.retentionDays" @change="(e) => save({ retentionDays: Number((e.target as HTMLSelectElement).value) as Settings['retentionDays'] }, '保留期已修改')">
          <option :value="30">30 天</option><option :value="90">90 天</option><option :value="180">180 天</option><option :value="0">永久</option>
        </select>
        <span />
      </div>
      <span class="hint" style="font-size: 12px; color: var(--t3)">原始消息只保留 7 天，用于排查问题。</span>
    </div>
    <div class="field" style="margin-top: 14px">
      <span class="flabel">导出 / 导入配置</span>
      <div class="bk-actions">
        <a class="btn" href="/api/backup/export" download><Icon name="i-upload" />导出配置</a>
        <a class="btn" href="/api/backup/export?files=1" download>导出（含素材文件）</a>
        <button class="btn" :disabled="uploading !== null" @click="fileIn?.click()">{{ uploading !== null ? `正在上传 ${Math.round(uploading * 100)}%` : '导入配置' }}</button>
        <input ref="fileIn" type="file" accept=".json,.zip,application/json,application/zip" hidden @change="pick" />
      </div>
      <span class="hint" style="font-size: 12px; color: var(--t3)">配置包括规则、素材设置、输出和播放设置，不含 B 站登录信息和后台密码。导出的文件可以直接导入以后的 Windows 版；换电脑时建议用「含素材文件」的 zip。</span>
    </div>
    <ImportDialog v-if="preview" :preview="preview" @close="preview = null" @done="preview = null" />
  </div>
</template>
