<script setup lang="ts">
// B 站扫码登录弹窗
import { useQrLogin } from '../lib/qr.ts';
import Icon from './Icon.vue';
import QrBox from './QrBox.vue';

const emit = defineEmits<{ close: [] }>();
const qr = useQrLogin(() => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="dlg" role="dialog" aria-label="扫码登录 B 站">
      <div class="qh"><b>扫码登录 B 站</b><button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button></div>
      <div class="qb">
        <QrBox :qr="qr" />
        <span class="inline-hint">登录信息只保存在这台服务器上，并且加密存储；星临只在开播时用它连接你的直播间。建议使用小号。</span>
      </div>
    </div>
  </Teleport>
</template>
