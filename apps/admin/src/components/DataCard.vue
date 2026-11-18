<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { HistoryPreview } from '@starfall/shared';
import { errMsg, get, post, put, upload } from '../lib/api.ts';
import { pushEsc } from '../lib/esc.ts';
import { fileSize } from '../lib/format.ts';
import { refreshSettings, state } from '../lib/store.ts';
import { attempt, toast, undoable } from '../lib/toast.ts';
import type { BackupItem, ImportPreview, Settings } from '../lib/types.ts';
import Icon from './Icon.vue';
import Tip from './Tip.vue';
import ImportDialog from './ImportDialog.vue';
import HistoryImportDialog from './HistoryImportDialog.vue';
import Switch from './Switch.vue';

type PendingImport = { kind: 'history'; preview: HistoryPreview } | { kind: 'config'; preview: ImportPreview; restoring: boolean };

const backups = ref<BackupItem[]>([]);
const showAll = ref(false);
const showExport = ref(false);
const exportChoice = ref<HTMLAnchorElement | null>(null);
const exportButton = ref<HTMLButtonElement | null>(null);
const running = ref(false);
const fileIn = ref<HTMLInputElement | null>(null);
const uploading = ref<number | null>(null);
const restoring = ref(false);
const pending = ref<PendingImport | null>(null);
const importBusy = computed(() => uploading.value !== null || restoring.value || pending.value !== null);

function closeExport(): void {
  showExport.value = false;
  exportButton.value?.focus();
}
watch(showExport, (open, _before, onCleanup) => {
  if (!open) return;
  exportChoice.value?.focus();
  onCleanup(pushEsc(closeExport));
}, { flush: 'post' });

// 导出（含素材文件）要打包一会儿：一点按钮马上变成「正在打包…」，开始下载时（服务端发来的 cookie）再说一声
const packing = ref<string | null>(null);
let packTimer: ReturnType<typeof setInterval> | null = null;
const PACK_GIVE_UP_MS = 120_000;
function stopPacking(): void {
  if (packTimer) clearInterval(packTimer);
  packTimer = null;
  packing.value = null;
}
function exportWithFiles(): void {
  if (packing.value) return;
  closeExport();
  const token = Math.random().toString(36).slice(2, 12);
  packing.value = token;
  const started = Date.now();
  packTimer = setInterval(() => {
    if (document.cookie.split('; ').includes(`starfall_export=${token}`)) {
      document.cookie = 'starfall_export=; Path=/; Max-Age=0; SameSite=Strict';
      stopPacking();
      toast('打包好了，已经开始下载');
    } else if (Date.now() - started > PACK_GIVE_UP_MS) stopPacking();
  }, 400);
  const a = document.createElement('a');
  a.href = `/api/backup/export?files=1&t=${token}`;
  a.download = '';
  a.click();
}
onBeforeUnmount(stopPacking);

async function load(): Promise<void> {
  backups.value = (await get<{ items: BackupItem[] }>('/api/backup/list').catch(() => ({ items: [] }))).items;
}
async function save(patch: Partial<Settings>, msg: string): Promise<void> {
  // 成功失败都重新读取：失败时开关要回到原来的状态
  await attempt(() => put('/api/settings', patch), msg);
  await refreshSettings().catch(() => undefined);
}
/** 保留期改短：更早的记录几小时内会被删掉，删了不能恢复，提示条上可以撤销 */
async function setRetention(v: Settings['retentionDays']): Promise<void> {
  const old = state.settings?.retentionDays ?? 90;
  const shorter = v !== 0 && (old === 0 || v < old);
  if (!shorter) return save({ retentionDays: v }, '保留期已修改');
  if (!(await attempt(() => put('/api/settings', { retentionDays: v })))) return void refreshSettings().catch(() => undefined);
  await refreshSettings().catch(() => undefined);
  undoable(`已改成保留 ${v} 天：超过 ${v} 天的事件记录会在几小时内删除，删了不能恢复`, async () => {
    await put('/api/settings', { retentionDays: old });
    await refreshSettings();
    toast('已改回原来的保留期');
  });
}
async function runNow(): Promise<void> {
  running.value = true;
  if (await attempt(() => post('/api/backup/run'), '已备份')) await load();
  running.value = false;
}
/** 20260926-0400 → 9月26日 04:00；手动备份另有标签。 */
function when(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(?:\d{2}-m)?$/.exec(stamp);
  return m ? `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}` : stamp;
}

/** 恢复配置与导入配置共用预览和确认。 */
async function restore(b: BackupItem): Promise<void> {
  if (!b.config || importBusy.value) return;
  restoring.value = true;
  try {
    const preview = await attempt(() => post<ImportPreview>(`/api/backup/restore/${b.config}`));
    if (preview) pending.value = { kind: 'config', preview, restoring: true };
  } finally {
    restoring.value = false;
  }
}
async function pick(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = '';
  if (!file || importBusy.value) return;
  const extension = /\.(db|zip|json)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension) {
    toast('请选择星临导出的 .db、.zip 或 .json 文件', 'err', 5000);
    return;
  }
  uploading.value = 0;
  const onProgress = (progress: number) => (uploading.value = progress);
  try {
    if (extension === 'db') {
      const preview = await upload<HistoryPreview>('/api/backup/history/import', file, onProgress);
      pending.value = { kind: 'history', preview };
    } else {
      const preview = await upload<ImportPreview>('/api/backup/import', file, onProgress);
      pending.value = { kind: 'config', preview, restoring: false };
    }
  } catch (err) {
    toast(errMsg(err), 'err', 5000);
  } finally {
    uploading.value = null;
  }
}

function closeImport(): void {
  pending.value = null;
}
function finishImport(): void {
  closeImport();
  void load();
}

onMounted(load);
</script>

<template>
  <div v-if="state.settings" class="card">
    <div class="card-h"><h2><span class="hicon"><Icon name="i-upload" /></span>数据</h2></div>
    <div class="field">
      <div class="bk-actions">
        <button ref="exportButton" type="button" class="btn primary" aria-haspopup="dialog" :disabled="packing !== null || importBusy" :aria-busy="packing !== null" @click="showExport = true">
          <span v-if="packing" class="spin" />{{ packing ? '正在打包…' : '导出' }}
        </button>
        <button type="button" class="btn" :disabled="importBusy || showExport" :aria-busy="uploading !== null" @click="fileIn?.click()">
          {{ uploading !== null ? (uploading < 1 ? `正在上传 ${Math.round(uploading * 100)}%` : '正在读取文件…') : '导入' }}
        </button>
        <input ref="fileIn" type="file" accept=".db,.zip,.json" hidden @change="pick" />
      </div>
      <span class="inline-hint">桌面版和服务器版可互相导入直播历史、配置和素材。选文件后先预览。</span>
    </div>
    <div class="data-backups">
      <div class="data-backup-head">
        <h3>备份管理</h3>
        <button type="button" class="btn" :disabled="running" title="马上备份一次数据库和配置（另外保留最近 5 份）" @click="runNow"><Icon name="i-check" />{{ running ? '正在备份…' : '立即备份' }}</button>
      </div>
      <div class="field">
        <div class="toggle-line">每天自动备份<Tip text="凌晨备份数据库和配置，保留最近 7 份。手动备份另外保留最近 5 份。" />
          <Switch v-model="state.settings.autoBackup" label="每天自动备份" @change="(v) => save({ autoBackup: v }, v ? '已开启每天自动备份' : '已关闭自动备份')" />
        </div>
        <div class="bk-t">
          <div v-for="b in showAll ? backups : backups.slice(0, 2)" :key="b.stamp" class="r">
            <span class="num">{{ when(b.stamp) }}<span v-if="b.manual" class="tag nor" style="margin-left: 6px; font-size: var(--fs-badge)">手动</span></span>
            <span class="sz">{{ fileSize(b.dbSize + b.configSize) }}</span>
            <button v-if="b.config" type="button" class="linkish" :disabled="importBusy || showExport" @click="restore(b)">恢复配置</button><span v-else />
            <a v-if="b.config" class="linkish" :href="`/api/backup/files/${b.config}`" download title="下载这份配置文件">下载配置</a><span v-else />
          </div>
          <div v-if="!backups.length" class="r" style="grid-template-columns: 1fr"><span class="inline-hint">还没有备份</span></div>
          <button v-if="backups.length > 2" type="button" class="more" @click="showAll = !showAll">{{ showAll ? '收起' : `全部 ${backups.length} 份` }}</button>
        </div>
      </div>
      <div class="field" style="margin-top: 14px">
        <div class="slider-row">
          <label for="keep">事件记录保留<Tip text="原始消息只保留 7 天，用于排查问题。" /></label>
          <select id="keep" class="sel" style="width: 160px; justify-self: start" :value="state.settings.retentionDays" @change="(e) => setRetention(Number((e.target as HTMLSelectElement).value) as Settings['retentionDays'])">
            <option :value="30">30 天</option><option :value="90">90 天</option><option :value="180">180 天</option><option :value="0">永久</option>
          </select>
          <span />
        </div>
      </div>
    </div>
    <Teleport v-if="showExport" to="body">
      <div class="ed-scrim" @click="closeExport" />
      <div class="dlg imp" role="dialog" aria-modal="true" aria-label="导出数据">
        <div class="qh">
          <b>导出数据</b>
          <button type="button" class="icon-btn" aria-label="关闭" @click="closeExport"><Icon name="i-x" /></button>
        </div>
        <div class="imp-b">
          <a ref="exportChoice" class="data-export-choice" href="/api/backup/history/export" download @click="closeExport">
            <strong>直播历史</strong><span class="data-export-format">.db</span>
            <span>礼物、弹幕、上舰、醒目留言和直播场次</span>
          </a>
          <button type="button" class="data-export-choice" @click="exportWithFiles">
            <strong>配置和素材</strong><span class="data-export-format">.zip</span>
            <span>规则、设置和上传的素材文件</span>
          </button>
          <a class="linkish data-config-export" href="/api/backup/export" download @click="closeExport">仅配置（.json）</a>
        </div>
      </div>
    </Teleport>
    <ImportDialog v-if="pending?.kind === 'config'" :preview="pending.preview" :restoring="pending.restoring" @close="closeImport" @done="finishImport" />
    <HistoryImportDialog v-if="pending?.kind === 'history'" :preview="pending.preview" @close="closeImport" @done="finishImport" />
  </div>
</template>

<style scoped>
.data-backups { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
.data-backup-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.data-backup-head h3 { margin: 0; font-size: var(--fs-body); font-weight: 600; }
.data-export-choice {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--l3);
  color: var(--t1);
  font: inherit;
  text-align: start;
  text-decoration: none;
}
.data-export-choice:hover { background: var(--hover); }
.data-export-choice strong { font-size: var(--fs-body); font-weight: 600; }
.data-export-choice span { color: var(--t2); }
.data-export-choice .data-export-format { color: var(--t3); }
.data-config-export { align-self: flex-start; }
.bk-t .linkish { white-space: nowrap; }
</style>
