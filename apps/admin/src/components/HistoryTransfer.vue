<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { HISTORY_KINDS } from '@starfall/shared';
import type { HistoryKind, HistoryPlan, HistoryPreview } from '@starfall/shared';
import { ApiError, del, errMsg, post, upload } from '../lib/api.ts';
import { refreshFeed } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import { pushEsc } from '../lib/esc.ts';
import Icon from './Icon.vue';
import Tip from './Tip.vue';

const emit = defineEmits<{ done: [] }>();
const input = ref<HTMLInputElement | null>(null);
const uploading = ref<number | null>(null);
const preview = ref<HistoryPreview | null>(null);
const busy = ref(false);
const message = ref('');
const kindLabels: Record<HistoryKind, string> = { gift: '礼物', danmu: '弹幕', guard: '上舰', sc: '醒目留言' };
const plan = computed(() => preview.value?.plan);
const totals = computed(() => ({
  added: Object.values(plan.value?.events ?? {}).reduce((n, e) => n + e.added, 0),
  expired: Object.values(plan.value?.events ?? {}).some((e) => e.expired > 0),
  overlap: Object.values(plan.value?.events ?? {}).some((e) => e.overlap > 0),
}));
const canApply = computed(() => totals.value.added > 0 || (plan.value?.sessions.added ?? 0) > 0);
const fmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

async function pick(event: Event): Promise<void> {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = '';
  if (!file) return;
  uploading.value = 0;
  message.value = '';
  try {
    preview.value = await upload<HistoryPreview>('/api/backup/history/import', file, (p) => (uploading.value = p));
  } catch (error) {
    toast(errMsg(error), 'err', 5000);
  } finally {
    uploading.value = null;
  }
}

function cancel(): void {
  if (!preview.value || busy.value) return;
  const token = preview.value.token;
  preview.value = null;
  void del('/api/backup/history/import/' + token).catch(() => undefined);
}

async function confirm(): Promise<void> {
  if (!preview.value || busy.value || !canApply.value) return;
  const pending = preview.value;
  busy.value = true;
  message.value = '';
  try {
    const result = await post<{ plan: HistoryPlan; backup?: string }>('/api/backup/history/import/' + pending.token);
    const count = Object.values(result.plan.events).reduce((sum, row) => sum + row.added, 0);
    preview.value = null;
    void refreshFeed().catch(() => undefined);
    emit('done');
    toast('合并完成，新增 ' + count + ' 条记录、' + result.plan.sessions.added + ' 场直播');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'history_changed') {
      preview.value = { ...pending, plan: error.details as HistoryPlan };
      message.value = error.message;
    } else {
      preview.value = null;
      toast(errMsg(error), 'err', 5000);
    }
  } finally {
    busy.value = false;
  }
}

watch(() => Boolean(preview.value), (open, _before, onCleanup) => {
  if (open) onCleanup(pushEsc(cancel));
});
</script>

<template>
  <div class="field" style="margin-top: 14px">
    <span class="flabel">历史数据迁移<Tip text="桌面版和服务器版互通。历史文件包含礼物、弹幕、上舰、醒目留言与直播场次。合并后保留本机数据。" /></span>
    <div class="bk-actions">
      <a class="btn" href="/api/backup/history/export" download><Icon name="i-upload" />导出历史数据</a>
      <button type="button" class="btn" :disabled="uploading !== null || Boolean(preview)" @click="input?.click()">
        {{ uploading === null ? '合并历史记录' : '正在上传 ' + Math.round(uploading * 100) + '%' }}
      </button>
      <input ref="input" type="file" accept=".db" hidden @change="pick" />
    </div>
  </div>
  <Teleport v-if="preview && plan" to="body">
    <div class="ed-scrim" @click="cancel" />
    <div class="dlg imp" role="dialog" aria-modal="true" aria-label="合并历史记录">
      <div class="qh">
        <b>合并历史记录</b><span class="imp-src">{{ preview.filename }}</span>
        <button type="button" class="icon-btn" aria-label="关闭" :disabled="busy" @click="cancel"><Icon name="i-x" /></button>
      </div>
      <div class="imp-b">
        <p v-if="message" class="imp-warn" role="status">{{ message }}</p>
        <p v-if="plan.exportedAt !== null" class="imp-lead">导出于 {{ fmt.format(plan.exportedAt) }}</p>
        <p v-if="plan.from !== null && plan.to !== null" class="imp-lead">{{ fmt.format(plan.from) }} 至 {{ fmt.format(plan.to) }}</p>
        <div class="history-counts">
          <table>
            <thead><tr><th scope="col">记录</th><th scope="col">新增</th><th scope="col">重复</th><th scope="col">疑似重复</th><th scope="col">超期</th></tr></thead>
            <tbody>
              <tr v-for="kind in HISTORY_KINDS" :key="kind">
                <th scope="row">{{ kindLabels[kind] }}</th><td>{{ plan.events[kind].added }}</td><td>{{ plan.events[kind].duplicate }}</td>
                <td>{{ plan.events[kind].overlap }}</td><td>{{ plan.events[kind].expired }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="imp-lead">直播场次新增 {{ plan.sessions.added }} 场，已有 {{ plan.sessions.existing }} 场。</p>
        <p v-if="totals.overlap" class="imp-warn">疑似重复的记录会跳过，避免重复计算礼物金额。</p>
        <p v-if="totals.expired" class="imp-warn">超出 {{ plan.retentionDays }} 天保留期的记录会跳过。需要保留时，先调整保留期，再重新选择文件。</p>
        <p class="imp-note">{{ canApply ? '确认后先备份本机数据库，再合并历史记录。本机的账号、规则、素材和挂单照常使用。' : '这份文件没有可以新增的记录。' }}</p>
      </div>
      <div class="imp-f">
        <button type="button" class="btn" :disabled="busy" @click="cancel">{{ canApply ? '取消' : '关闭' }}</button>
        <button v-if="canApply" type="button" class="btn primary" :disabled="busy" @click="confirm">
          <span v-if="busy" class="spin" />{{ busy ? '正在合并…' : '确认合并' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.history-counts { overflow-x: auto; }
.history-counts table { width: 100%; border-collapse: collapse; white-space: nowrap; font-variant-numeric: tabular-nums; }
.history-counts th, .history-counts td { text-align: end; padding: 7px 6px; border-bottom: 1px solid var(--line); }
.history-counts th:first-child { text-align: start; }
</style>
