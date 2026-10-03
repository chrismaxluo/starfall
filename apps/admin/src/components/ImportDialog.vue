<script setup lang="ts">
// 导入配置（F-DA-04）：上传后先显示变化预览，确认才导入
import { computed, ref } from 'vue';
import { del, post } from '../lib/api.ts';
import { refreshEffects, refreshOutputs, refreshRules, refreshSettings } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { ImportPreview } from '../lib/types.ts';
import Icon from './Icon.vue';
import { useEsc } from '../lib/esc.ts';

const props = defineProps<{ preview: ImportPreview }>();
const emit = defineEmits<{ close: []; done: [] }>();
const busy = ref(false);
const open = ref<string | null>(null);

const plan = computed(() => props.preview.plan);
const changed = computed(() => plan.value.sections.filter((s) => s.changed));
const exported = computed(() => {
  const d = new Date(plan.value.exportedAt);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
});

/** 从备份列表点「恢复到这份」打开的（文件名是备份的名字） */
const restoring = computed(() => /^starfall-\d{8}-/.test(props.preview.filename));
async function cancel(): Promise<void> {
  if (busy.value) return;
  void del(`/api/backup/import/${props.preview.token}`).catch(() => undefined);
  emit('close');
}
async function confirm(): Promise<void> {
  busy.value = true;
  const r = await attempt(() => post<{ ok: true; savedFiles: number; backup?: string }>(`/api/backup/import/${props.preview.token}`));
  busy.value = false;
  if (!r) return emit('close');
  await Promise.all([refreshEffects(), refreshRules(), refreshOutputs(), refreshSettings()]);
  const done = restoring.value ? '已恢复到这份备份' : '导入完成';
  toast(`${done}${r.savedFiles ? `，恢复了 ${r.savedFiles} 个素材文件` : ''}；之前的配置已经自动备份`, 'ok', 5000);
  emit('done');
}
// 按 Esc 关闭
useEsc(() => void cancel());
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="cancel" />
    <div class="dlg imp" role="dialog" :aria-label="restoring ? '恢复备份' : '导入配置'">
      <div class="qh"><b>{{ restoring ? '恢复到这份备份' : '导入配置' }}</b><span class="imp-src">{{ preview.filename }}<template v-if="exported"> · 导出于 {{ exported }}</template></span><button class="icon-btn" aria-label="关闭" @click="cancel"><Icon name="i-x" /></button></div>
      <div class="imp-b">
        <p class="imp-lead">{{ changed.length ? '导入后会有这些变化，确认后才生效：' : '和现在的配置完全一样，不需要导入。' }}</p>
        <ul class="imp-list">
          <li v-for="s in plan.sections" :key="s.key" :class="{ same: !s.changed }">
            <button type="button" :disabled="!s.details.length" :aria-expanded="open === s.key" @click="open = open === s.key ? null : s.key">
              <span class="k">{{ s.label }}</span><span class="v">{{ s.summary }}</span><Icon v-if="s.details.length" name="i-chev" class="chev" />
            </button>
            <ul v-if="open === s.key" class="imp-det"><li v-for="d in s.details" :key="d">{{ d }}</li></ul>
          </li>
        </ul>
        <div v-if="plan.warnings.length" class="imp-warn">
          <b>需要注意</b>
          <ul><li v-for="w in plan.warnings" :key="w">{{ w }}</li></ul>
          <span v-if="plan.files.missing">缺少的文件可以之后在素材库里重新上传；想一起恢复，请用「导出（含素材文件）」得到的 zip 导入。</span>
        </div>
        <p class="imp-note">规则会整体替换成{{ restoring ? '备份' : '文件' }}里的；本机的素材、黑名单、输出只增加和更新，不会删除；B 站账号和后台密码不受影响。确认后会先自动备份一份现在的配置，{{ restoring ? '恢复' : '导入' }}错了还能再恢复回来。</p>
      </div>
      <div class="imp-f">
        <button class="btn" :disabled="busy" @click="cancel">{{ changed.length ? '取消' : '关闭' }}</button>
        <button v-if="changed.length" class="btn primary" :disabled="busy" @click="confirm"><span v-if="busy" class="spin" />{{ busy ? (restoring ? '正在恢复…' : '正在导入…') : restoring ? '确认恢复' : '确认导入' }}</button>
      </div>
    </div>
  </Teleport>
</template>
