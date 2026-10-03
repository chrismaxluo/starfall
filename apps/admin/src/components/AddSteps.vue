<script setup lang="ts">
// 把特效页、弹幕列表加到直播软件的步骤（直播软件输出页、新手引导共用，两边说法一样）
import { computed } from 'vue';
import { chatHeight, CHAT_WIDTH } from '@starfall/shared/overlay';
import type { OutputDto } from '../lib/types.ts';

const props = withDefaults(defineProps<{ output: OutputDto; chat?: boolean }>(), { chat: true });
const emit = defineEmits<{ copyCheck: [] }>();
const wh = computed(() => ({ w: CHAT_WIDTH, h: chatHeight(props.output.chatMax, props.output.chatSize) }));
</script>

<template>
  <ol v-if="output.app === 'obs'" class="steps">
    <li v-if="output.orient === 'portrait'"><span>竖屏推流时，OBS 的 <b>设置 → 视频 → 基础分辨率</b> 也要设成 <code>{{ output.width }}x{{ output.height }}</code>。</span></li>
    <li><span><em class="tagsrc fx">特效页</em>在 <b>来源</b> 里点 <b>+</b> → <b>浏览器</b>，命名为「星临特效」，URL 粘贴特效页地址，宽 <code>{{ output.width }}</code> 高 <code>{{ output.height }}</code>，勾选 <b>通过 OBS 控制音频</b>（特效的音效才会进入直播）。</span></li>
    <li><span><em class="tagsrc fx">特效页</em>取消勾选 <b>不可见时关闭源</b> 和 <b>场景变为活动状态时刷新浏览器</b>，避免切场景时漏播；把它拖到来源列表 <b>最上方</b>。</span></li>
    <li v-if="chat && output.chatEnabled"><span><em class="tagsrc dm">弹幕列表</em>再加一个 <b>浏览器</b> 来源，命名为「星临弹幕」，URL 粘贴弹幕列表地址，宽 <code>{{ wh.w }}</code> 高 <code>{{ wh.h }}</code>，拖到画面左边或右边。</span></li>
    <li><span>第一次用可以先检查直播软件支不支持：<button type="button" class="linkish" @click="emit('copyCheck')">复制兼容性自检地址</button>，在直播软件里临时加一个浏览器源打开它，看完删掉。加好特效页后，再发一个测试特效确认一下。</span></li>
  </ol>
  <ol v-else class="steps">
    <li v-if="output.orient === 'portrait'"><span>在直播姬里切换到 <b>竖屏直播</b> 模式。</span></li>
    <li><span><em class="tagsrc fx">特效页</em>点 <b>添加素材 → 浏览器</b>，粘贴特效页地址，宽高填 <code>{{ output.width }}</code> × <code>{{ output.height }}</code>，拖动 <b>铺满画面</b>，放到 <b>图层最上方</b>。</span></li>
    <li v-if="chat && output.chatEnabled"><span><em class="tagsrc dm">弹幕列表</em>再添加一个 <b>浏览器</b> 素材，粘贴弹幕列表地址，宽高填 <code>{{ wh.w }}</code> × <code>{{ wh.h }}</code>，拖到画面左边或右边。想改大小就改宽高数字或下面的「字号」，不要拉伸变形。</span></li>
    <li><span>第一次用可以先检查直播软件支不支持：<button type="button" class="linkish" @click="emit('copyCheck')">复制兼容性自检地址</button>，在直播软件里临时加一个浏览器源打开它，看完删掉。加好特效页后，再发一个测试特效确认一下。</span></li>
  </ol>
</template>
