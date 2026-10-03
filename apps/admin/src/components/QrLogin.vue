<script setup lang="ts">
// B站扫码登录弹窗
import { useQrLogin } from '../lib/qr.ts';
import Icon from './Icon.vue';
import QrBox from './QrBox.vue';
import { useEsc } from '../lib/esc.ts';

const emit = defineEmits<{ close: [] }>();
const qr = useQrLogin(() => emit('close'));
// 按 Esc 关闭
useEsc(() => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="dlg" role="dialog" aria-label="扫码登录 B站">
      <div class="qh"><b>扫码登录 B站</b><button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button></div>
      <div class="qb">
        <QrBox :qr="qr" />
        <span class="inline-hint">登录信息加密保存在星临里，只用来读取你直播间的消息；默认只在开播时连接。建议使用小号。</span>
      </div>
    </div>
  </Teleport>
</template>
