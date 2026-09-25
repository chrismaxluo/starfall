<script setup lang="ts">
// B 站扫码登录：申请二维码 → 每 2 秒查询一次状态 → 成功后保存（加密）
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { get, post } from '../lib/api.ts';
import { refreshStatus } from '../lib/store.ts';
import { toast } from '../lib/toast.ts';
import Icon from './Icon.vue';

const emit = defineEmits<{ close: [] }>();
const img = ref('');
const st = ref<'loading' | 'waiting' | 'scanned' | 'expired' | 'success' | 'error'>('loading');
const err = ref('');
let key = '';
let timer: ReturnType<typeof setInterval> | null = null;

async function start(): Promise<void> {
  st.value = 'loading';
  try {
    const r = await post<{ key: string; image: string }>('/api/bili/qrcode');
    key = r.key;
    img.value = r.image;
    st.value = 'waiting';
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2000);
  } catch (e) {
    st.value = 'error';
    err.value = e instanceof Error ? e.message : String(e);
  }
}
async function poll(): Promise<void> {
  try {
    const r = await get<{ state: typeof st.value; account?: { name: string } }>(`/api/bili/qrcode/${encodeURIComponent(key)}`);
    st.value = r.state;
    if (r.state === 'success' || r.state === 'expired') {
      if (timer) clearInterval(timer);
      timer = null;
    }
    if (r.state === 'success') {
      await refreshStatus();
      toast(`已登录 B 站账号：${r.account?.name ?? ''}`);
      emit('close');
    }
  } catch {
    /* 网络抖动时下次再查 */
  }
}
onMounted(start);
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" @click="emit('close')" />
    <div class="dlg" role="dialog" aria-label="扫码登录 B 站">
      <div class="qh"><b>扫码登录 B 站</b><button class="icon-btn" aria-label="关闭" @click="emit('close')"><Icon name="i-x" /></button></div>
      <div class="qb">
        <div class="qr">
          <img v-if="img" :src="img" alt="登录二维码" />
          <div v-if="st === 'scanned'" class="scanned">已扫码<br />请在手机上确认登录</div>
          <div v-if="st === 'expired'" class="scanned" style="color: var(--gov)">二维码已过期</div>
        </div>
        <span v-if="st === 'loading'"><span class="spin" /> 正在获取二维码…</span>
        <span v-else-if="st === 'waiting'">用 <b>B 站手机客户端</b> 扫一扫（首页左上角）</span>
        <span v-else-if="st === 'error'" class="err">{{ err }}</span>
        <button v-if="st === 'expired' || st === 'error'" class="btn primary" @click="start">重新获取二维码</button>
        <span class="inline-hint">登录信息只保存在这台服务器上，并且加密存储；星临只在开播时用它连接你的直播间。建议使用小号。</span>
      </div>
    </div>
  </Teleport>
</template>
