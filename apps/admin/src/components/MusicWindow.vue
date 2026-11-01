<script setup lang="ts">
// 点歌主页 · 点歌窗口：直播软件里加上没有、现在的样式（去「画面」换）、复制地址
import { computed } from 'vue';
import { MUSIC_HEIGHT, MUSIC_WIDTH } from '@starfall/shared/overlay';
import Icon from './Icon.vue';
import { MUSIC_STYLE_NAMES, copyMusicUrl, music } from '../lib/music.ts';
import { go } from '../lib/route.ts';
import { state } from '../lib/store.ts';

/** 加在直播软件里的点歌窗口（不算浏览器查看页） */
const windows = computed(() => state.overlays.filter((x) => x.role === 'music' && !x.view).length);
const cover = computed(() => music.state?.now?.item.song.cover ?? '');
</script>

<template>
  <div class="card ow">
    <div class="card-h"><h2><span class="hicon"><Icon name="i-screen" /></span>点歌窗口</h2><span class="aside"><a class="linkish" href="#music/look" @click.prevent="go('music', 'look')">换样式 →</a></span></div>
    <div class="ow-body">
      <!-- 示意：正在放的歌的封面铺底，和直播画面上的窗口差不多 -->
      <span class="ow-thumb" aria-hidden="true">
        <img v-if="cover" class="bg" :src="cover" alt="" referrerpolicy="no-referrer" />
        <span class="in">
          <img v-if="cover" :src="cover" alt="" referrerpolicy="no-referrer" />
          <span v-else class="blank"><Icon name="i-music" /></span>
          <span class="ln"><i /><i /><i class="p" /></span>
        </span>
      </span>
      <span class="ow-info">
        <span class="live" :class="windows ? '' : 'warn'"><i />{{ !windows ? '直播软件里还没加' : windows > 1 ? `直播软件里加了 ${windows} 个` : '直播软件里已加上' }}</span>
        <span>样式 <b>{{ music.settings ? MUSIC_STYLE_NAMES[music.settings.style] : '' }}</b><template v-if="music.settings?.normalize"> · 音量均衡开</template></span>
      </span>
    </div>
    <div class="ow-foot">
      <span class="num">{{ MUSIC_WIDTH }} × {{ MUSIC_HEIGHT }}</span>
      <button v-if="!windows" class="btn" type="button" @click="go('obs')">怎么加</button>
      <button class="btn" type="button" :title="`在直播软件里加一个浏览器源，宽高填 ${MUSIC_WIDTH} × ${MUSIC_HEIGHT}`" @click="copyMusicUrl"><Icon name="i-copy" />复制地址</button>
    </div>
  </div>
</template>

<style scoped>
.ow { display: flex; flex-direction: column; }
.ow-body { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; }
.ow-thumb { position: relative; width: 116px; height: 64px; border-radius: var(--r-md); overflow: hidden; flex: none; background: linear-gradient(135deg, #2B2A6B, #121224); box-shadow: 0 0 0 1px var(--line); }
.ow-thumb .bg { position: absolute; inset: -20px; width: calc(100% + 40px); height: calc(100% + 40px); object-fit: cover; filter: blur(14px) saturate(140%) brightness(.8); }
.ow-thumb .in { position: absolute; inset: 0; display: flex; align-items: center; gap: 7px; padding: 0 9px; color: #fff; }
.ow-thumb .in > img, .ow-thumb .blank { width: 34px; height: 34px; border-radius: var(--r-xs); object-fit: cover; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); flex: none; }
.ow-thumb .blank { display: grid; place-items: center; background: rgba(255, 255, 255, .14); }
.ow-thumb .blank svg { width: 16px; height: 16px; }
.ow-thumb .ln { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.ow-thumb .ln i { display: block; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .9); }
.ow-thumb .ln i + i { width: 60%; background: rgba(255, 255, 255, .5); }
.ow-thumb .ln i.p { width: 100%; height: 2px; background: linear-gradient(90deg, #fff 30%, rgba(255, 255, 255, .3) 30%); }
.ow-info { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: var(--fs-sec); color: var(--t2); }
.ow-info .live { align-self: flex-start; }
.ow-info b { color: var(--t1); font-weight: 600; }
.ow-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--line); font-size: var(--fs-sec); color: var(--t3); }
.ow-foot .num { margin-right: auto; }
.ow-foot .btn { height: 30px; padding: 0 12px; font-size: var(--fs-sec); }
</style>
