<script setup lang="ts">
import { ref } from 'vue';
import { errMsg, post } from '../lib/api.ts';
import Icon from '../components/Icon.vue';

const emit = defineEmits<{ done: [] }>();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  if (!password.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await post('/api/auth/login', { password: password.value });
    emit('done');
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="login-card" @submit.prevent="submit">
      <div class="brand">
        <span class="brand-mark"><Icon name="i-spark" /></span>
        <span><div class="brand-name">星临</div><div class="brand-sub">STARFALL</div></span>
      </div>
      <div>
        <h1>登录管理后台</h1>
        <p>首次使用的初始密码保存在服务器的 <code>data/initial-password.txt</code> 里，登录后可以在「设置」里修改。</p>
      </div>
      <div class="field">
        <label for="pw">密码</label>
        <input id="pw" v-model="password" class="inp" type="password" autocomplete="current-password" autofocus />
      </div>
      <div v-if="error" class="err">{{ error }}</div>
      <button class="btn primary" type="submit" :disabled="busy" style="justify-content: center; height: 38px">{{ busy ? '登录中…' : '登录' }}</button>
    </form>
  </div>
</template>
