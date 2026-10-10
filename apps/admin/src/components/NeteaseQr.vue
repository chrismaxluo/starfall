<script setup lang="ts">
// 网易云扫码登录弹窗（点歌用）
import { useQrLogin } from '../lib/qr.ts';
import Icon from './Icon.vue';
import QrBox from './QrBox.vue';
import { useEsc } from '../lib/esc.ts';

const emit = defineEmits<{ close: [] }>();
const qr = useQrLogin(() => emit('close'), true, 'netease');
useEsc(() => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="dlg" role="dialog" aria-label="扫码登录网易云音乐">
      <div class="qh"><b>扫码登录网易云音乐</b><button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button></div>
      <div class="qb">
        <QrBox :qr="qr" hint="用网易云音乐 App 扫一扫（首页左上角的菜单里）" />
        <span class="inline-hint">登录信息加密保存在星临里，只用来搜歌、拿播放地址。登录会员账号后，会员歌也能完整播放。</span>
      </div>
    </div>
  </Teleport>
</template>
