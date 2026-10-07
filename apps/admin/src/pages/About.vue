<script setup lang="ts">
// 关于：版本和更新、运行信息、更新记录、作者
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import Logo from '../components/Logo.vue';
import { get } from '../lib/api.ts';
import { CHANGELOG } from '../lib/changelog.ts';
import { desktop as desktopBridge } from '../lib/desktop.ts';
import { dateTime, duration, fileSize, when } from '../lib/format.ts';
import { toast } from '../lib/toast.ts';

interface About {
  version: string;
  build: string | null;
  edition: 'server' | 'desktop';
  update: { latest: { version: string; publishedAt: string | null } | null; newer: boolean; error: string | null; checkedAt: number };
  runtime: { startedAt: number; node: string; os: string; memoryMb: number; dataDir: string; dbBytes: number; assetBytes: number; backupBytes: number; port: number; timeZone: string };
}

const AUTHOR = '吃喵放花椒的喵酱';
const AUTHOR_URL = 'https://space.bilibili.com/402917316';
const EMAIL = 'chrismaxluo@gmail.com';
const info = ref<About | null>(null);
const checking = ref(false);
const failed = ref(false);
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => clearInterval(tick));

async function load(check = false): Promise<void> {
  if (check) checking.value = true;
  try {
    info.value = await get<About>(`/api/about${check ? '?check=1' : ''}`);
    failed.value = false;
    if (check) {
      const u = info.value.update;
      toast(u.error ? u.error : u.newer ? `有新版本 v${u.latest!.version}` : '已经是最新版本', u.error ? 'err' : u.newer ? 'info' : 'ok');
    }
  } catch (e) {
    failed.value = !info.value;
    toast(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    checking.value = false;
  }
}
onMounted(() => void load());

const EDITION = { server: '服务器版', desktop: '电脑版' } as const;
const published = (iso: string | null) => (iso ? `${iso.slice(0, 10)} 发布` : '');
/** 复制给作者的完整运行信息（一行一项） */
const rows = computed(() => {
  const i = info.value;
  if (!i) return [];
  const r = i.runtime;
  return [
    ['版本', `v${i.version}${i.build ? `（开发版 ${i.build}）` : ''} · ${EDITION[i.edition]}`],
    ['已运行', `${duration(now.value - r.startedAt)}（${dateTime(r.startedAt)} 启动）`],
    ['系统', r.os],
    ['Node.js', r.node],
    ['内存占用', `${r.memoryMb} MB`],
    ['端口', String(r.port)],
    ['时区', r.timeZone],
    ['数据目录', r.dataDir],
    ['数据库', fileSize(r.dbBytes)],
    ['素材文件', fileSize(r.assetBytes)],
    ['备份', fileSize(r.backupBytes)],
  ] as Array<[string, string]>;
});
/** 页面上只给主播看这几项，其余的只在复制时带上 */
const shown = computed(() => {
  const i = info.value;
  if (!i) return [];
  const r = i.runtime;
  return [
    ['已运行', `${duration(now.value - r.startedAt)}（${dateTime(r.startedAt)} 启动）`],
    ['占用空间', `${fileSize(r.dbBytes + r.assetBytes + r.backupBytes)}（素材 ${fileSize(r.assetBytes)} · 备份 ${fileSize(r.backupBytes)}）`],
  ] as Array<[string, string]>;
});
async function copyInfo(): Promise<void> {
  const text = `星临运行信息\n${rows.value.map(([k, v]) => `${k}：${v}`).join('\n')}\n浏览器：${navigator.userAgent}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制运行信息，反馈问题时可以一起发给作者');
  } catch {
    toast('浏览器不允许自动复制，请手动选中下面的内容复制', 'info');
  }
}
/** 更新记录：默认只展开最上面一段 */
const open = ref(new Set([0]));
const showAll = ref(false);
const sections = computed(() => (showAll.value ? CHANGELOG : CHANGELOG.slice(0, 4)));
function toggle(i: number): void {
  const s = new Set(open.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  open.value = s;
}
const titleOf = (t: string) => (t === '未发布' ? '开发中（还没发布）' : t);
</script>

<template>
  <section class="page">
    <div class="page-head"><div><h1>关于星临</h1><p>版本、更新记录和运行信息。</p></div></div>

    <div class="about-grid">
      <div class="card about-hero">
        <div class="ah">
          <Logo :size="56" />
          <div class="an">
            <b>星临 <span>Starfall</span></b>
            <span class="av"><template v-if="info">v{{ info.version }}<span v-if="info.build" class="tag nor num" :title="`现在运行的是开发中的代码（提交 ${info.build}），比 v${info.version} 新，还没有正式发布`">开发版 {{ info.build }}</span><span class="tag excl">{{ EDITION[info.edition] }}</span></template><template v-else>读取中…</template></span>
          </div>
        </div>
        <div v-if="info && info.edition === 'desktop'" class="upd">
          <Icon name="i-update" />
          <span>电脑版打开后会自动检查更新（之后每 6 小时一次），有新版本会弹窗问你要不要下载，下载好后重启就装上。{{ info.version.includes('-') ? '现在是测试版，会收到测试版的更新。' : '' }}</span>
          <button v-if="desktopBridge" class="btn" @click="desktopBridge.checkUpdate()">检查更新</button>
        </div>
        <div v-else-if="info" class="upd" :class="{ newer: info.update.newer, err: info.update.error }">
          <Icon :name="info.update.newer ? 'i-update' : info.update.error ? 'i-info' : 'i-check'" />
          <span v-if="info.update.newer"><b>有新版本 v{{ info.update.latest!.version }}</b>{{ info.update.latest!.publishedAt ? `（${published(info.update.latest!.publishedAt)}）` : '' }}。在服务器上运行 <code>starfall update</code> 就能更新，更新前会自动备份。</span>
          <span v-else-if="info.update.error">{{ info.update.error }}</span>
          <span v-else-if="info.update.latest">已经是最新的正式版（v{{ info.update.latest.version }}）</span>
          <span v-else>还没有查到正式版本</span>
          <button class="btn" :disabled="checking" @click="load(true)"><span v-if="checking" class="spin" />{{ checking ? '检查中' : '检查更新' }}</button>
        </div>
        <div v-if="info && info.edition !== 'desktop'" class="upd-at">{{ when(info.update.checkedAt) }} 检查过</div>
        <dl class="about-meta">
          <dt>B站作者</dt><dd><a class="linkish author" :href="AUTHOR_URL" target="_blank" rel="noopener noreferrer" title="打开作者的 B站主页">{{ AUTHOR }}<Icon name="i-ext" /></a></dd>
          <dt>联系邮箱</dt><dd><a class="linkish" :href="`mailto:${EMAIL}`">{{ EMAIL }}</a></dd>
        </dl>
      </div>

      <div class="card">
        <div class="card-h"><h2>运行信息</h2><span class="aside"><button class="btn" :disabled="!info" @click="copyInfo"><Icon name="i-copy" />复制运行信息</button></span></div>
        <div v-if="failed" class="inline-hint">没读到运行信息（可能是和星临的连接断了）。<button class="linkish" @click="load()">重试</button></div>
        <dl v-else class="about-kv">
          <template v-for="[k, v] in shown" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template>
        </dl>
        <p class="inline-hint" style="margin: 12px 0 0">反馈问题时，点「复制运行信息」一起发给作者，里面有更详细的系统信息，更容易查出原因。</p>
      </div>
    </div>

    <div class="card cl">
      <div class="card-h"><h2>更新记录</h2><span class="aside">每个版本改了什么</span></div>
      <div v-for="(s, i) in sections" :key="s.title" class="cl-sec" :class="{ open: open.has(i) }">
        <button type="button" class="cl-h" :aria-expanded="open.has(i)" @click="toggle(i)"><Icon name="i-chev" />{{ titleOf(s.title) }}</button>
        <!-- 内容来自打包进来的 CHANGELOG.md，已经转义过 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="open.has(i)" class="cl-b" v-html="s.html" />
      </div>
      <button v-if="!showAll && CHANGELOG.length > 4" type="button" class="linkish" style="margin-top: 10px" @click="showAll = true">显示更早的 {{ CHANGELOG.length - 4 }} 个版本</button>
    </div>
  </section>
</template>
