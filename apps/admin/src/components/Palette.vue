<script setup lang="ts">
// 命令面板（F-UI-07）：Ctrl + K 打开，搜索并执行常用操作
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { clearQueue, togglePause } from '../lib/actions.ts';
import { post } from '../lib/api.ts';
import { IDENTITY, SAMPLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { playQuick, quickName } from '../lib/quick.ts';
import { go } from '../lib/route.ts';
import { state, ui } from '../lib/store.ts';
import { toggleTheme } from '../lib/theme.ts';
import { attempt } from '../lib/toast.ts';
import Icon from './Icon.vue';

const emit = defineEmits<{ close: [] }>();

interface Cmd {
  g: string;
  icon: string;
  label: string;
  /** 额外的搜索词 */
  kw?: string;
  kbd?: string;
  run: () => void;
}

const preview = (id: Identity) => () => {
  const r = state.enter!;
  const effectId = id === 'fan' ? (r.bands.find((b) => b.effectId)?.effectId ?? null) : r.tiers[id].effectId;
  ui.preview = { effectId, viewer: SAMPLES[id], label: `${IDENTITY[id].name}进场` };
};
const cmds = computed<Cmd[]>(() => {
  const paused = state.status?.paused ?? false;
  const tiers = (['gov', 'adm', 'cap', 'mod', 'fan', 'nor'] as Identity[]).filter((id) => {
    const r = state.enter;
    return r && (id === 'fan' ? r.bands.some((b) => b.effectId) : r.tiers[id].effectId);
  });
  return [
    ...tiers.map((id): Cmd => ({ g: '特效测试', icon: 'i-play', label: `预览${IDENTITY[id].name}进场特效`, kw: '测试 播放', run: preview(id) })),
    { g: '特效测试', icon: 'i-demo', label: '打开特效页演示', kw: 'demo 测试', run: () => void open('/overlay/?demo=1', '_blank', 'noopener') },
    { g: '直播中', icon: 'i-pause', label: paused ? '恢复播放' : '暂停所有特效', kw: '暂停 恢复 紧急', kbd: 'Ctrl Shift P', run: () => void togglePause() },
    { g: '直播中', icon: 'i-x', label: '清空播放队列', kw: '排队', run: () => void clearQueue() },
    ...state.quick.map((b): Cmd => ({ g: '直播中', icon: 'i-bolt', label: `快捷播放：${quickName(b)}`, kw: '素材 按钮 梗', ...(b.hotkey ? { kbd: b.hotkey } : {}), run: () => void playQuick(b) })),
    { g: '跳转', icon: 'i-grid', label: '总览', kw: '首页 实时动态', run: () => go('overview') },
    { g: '跳转', icon: 'i-bolt', label: '素材快捷播放', kw: '按钮 快捷键 梗', run: () => go('quickplay') },
    { g: '跳转', icon: 'i-wand', label: '进场规则', kw: '触发规则 身份 大航海 粉丝牌', run: () => go('rules', 'enter') },
    { g: '跳转', icon: 'i-user', label: '专属用户', kw: '触发规则 专属特效 专属素材', run: () => go('rules', 'exclusive') },
    { g: '跳转', icon: 'i-chat', label: '弹幕规则', kw: '触发规则 关键词', run: () => go('rules', 'danmu') },
    { g: '跳转', icon: 'i-gift', label: '礼物规则', kw: '触发规则 价值 连击', run: () => go('rules', 'gift') },
    { g: '跳转', icon: 'i-anchor', label: '上舰规则', kw: '触发规则 开通 续费 舰长 提督 总督', run: () => go('rules', 'guard') },
    { g: '跳转', icon: 'i-image', label: '素材库', kw: '上传 动画 视频', run: () => go('assets') },
    { g: '跳转', icon: 'i-image', label: '音效', kw: '素材库 声音', run: () => go('assets', 'sound') },
    { g: '跳转', icon: 'i-list', label: '事件记录', kw: '日志 历史', run: () => go('logs') },
    { g: '跳转', icon: 'i-screen', label: '直播软件输出', kw: 'OBS 直播姬 浏览器源 地址 竖屏 横屏 分辨率 兼容', run: () => go('obs') },
    { g: '跳转', icon: 'i-gear', label: '设置', kw: '账号 直播间 黑名单 密码', run: () => go('settings') },
    { g: '跳转', icon: 'i-ban', label: '黑名单', kw: '设置 屏蔽', run: () => go('settings') },
    { g: '其他', icon: 'i-star', label: '新手引导', kw: '帮助 开始', run: () => (ui.wizard = true) },
    { g: '其他', icon: 'i-upload', label: '导出配置', kw: '备份 下载', run: () => void open('/api/backup/export', '_self') },
    { g: '其他', icon: 'i-check', label: '立即备份', kw: '备份 数据', run: () => void attempt(() => post('/api/backup/run'), '已备份') },
    { g: '外观', icon: 'i-moon', label: '切换亮色 / 暗色', kw: '主题 夜间 深色', run: () => toggleTheme(innerWidth - 40, 28) },
  ];
});

const q = ref('');
const sel = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLUListElement | null>(null);
const shown = computed(() => {
  const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return cmds.value.filter((c) => {
    const hay = `${c.label} ${c.g} ${c.kw ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
});
/** 分组后的行（组标题只在组里第一条前面显示） */
const rows = computed(() => shown.value.map((c, i) => ({ c, i, head: i === 0 || shown.value[i - 1]!.g !== c.g ? c.g : null })));

watch(q, () => (sel.value = 0));
watch(sel, async () => {
  await nextTick();
  list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
});

function run(c: Cmd | undefined): void {
  if (!c) return;
  emit('close');
  c.run();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') sel.value = Math.min(sel.value + 1, shown.value.length - 1);
  else if (e.key === 'ArrowUp') sel.value = Math.max(sel.value - 1, 0);
  else if (e.key === 'Enter') run(shown.value[sel.value]);
  else if (e.key === 'Escape') emit('close');
  else return;
  e.preventDefault();
}
onMounted(() => input.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @mousedown.self="emit('close')">
      <div class="palette" role="dialog" aria-label="命令面板">
        <div class="in">
          <Icon name="i-search" />
          <input ref="input" v-model="q" placeholder="输入命令，例如：预览舰长、暂停、OBS" aria-label="搜索命令" role="combobox" aria-expanded="true" aria-controls="palette-list" @keydown="onKey" />
        </div>
        <ul id="palette-list" ref="list" role="listbox">
          <template v-for="r in rows" :key="r.c.label">
            <li v-if="r.head" class="group" role="presentation">{{ r.head }}</li>
            <li class="cmd" role="option" :aria-selected="r.i === sel" @mouseenter="sel = r.i" @click="run(r.c)">
              <Icon :name="r.c.icon" />{{ r.c.label }}<span v-if="r.c.kbd" class="kbd">{{ r.c.kbd }}</span><span v-else-if="r.i === sel" class="kbd">↵</span>
            </li>
          </template>
          <li v-if="!rows.length" class="group">没有匹配的命令</li>
        </ul>
        <div class="foot"><span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span></div>
      </div>
    </div>
  </Teleport>
</template>
