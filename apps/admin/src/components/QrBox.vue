<script setup lang="ts">
// 二维码和扫码状态（扫码弹窗、新手引导共用）
import type { useQrLogin } from '../lib/qr.ts';

defineProps<{ qr: ReturnType<typeof useQrLogin> }>();
</script>

<template>
  <div class="qr">
    <img v-if="qr.img.value" :src="qr.img.value" alt="登录二维码" />
    <div v-if="qr.st.value === 'scanned'" class="scanned">已扫码<br />请在手机上确认登录</div>
    <div v-if="qr.st.value === 'expired'" class="scanned" style="color: var(--gov)">二维码已过期</div>
  </div>
  <span v-if="qr.st.value === 'loading'"><span class="spin" /> 正在获取二维码…</span>
  <span v-else-if="qr.st.value === 'waiting'">用 <b>B 站手机客户端</b> 扫一扫（首页左上角）</span>
  <span v-else-if="qr.st.value === 'error'" class="err">{{ qr.err.value }}</span>
  <button v-if="qr.st.value === 'expired' || qr.st.value === 'error'" class="btn primary" @click="qr.start">重新获取二维码</button>
</template>
