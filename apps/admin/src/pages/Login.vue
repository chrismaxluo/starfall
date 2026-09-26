<script setup lang="ts">
// 登录页：全屏，和后台同一套风格。背景五层（底色、光晕、点阵、颗粒、地平线光弧），中间一张玻璃卡片。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ApiError, post } from '../lib/api.ts';
import { toggleTheme } from '../lib/theme.ts';
import Icon from '../components/Icon.vue';
import Logo from '../components/Logo.vue';

const emit = defineEmits<{ done: [] }>();
const password = ref('');
const show = ref(false);
const error = ref('');
const state = ref<'idle' | 'busy' | 'ok'>('idle');
const shake = ref(false);
const caps = ref(false);
const forgot = ref(false);
const input = ref<HTMLInputElement | null>(null);
const forgotEl = ref<HTMLElement | null>(null);

async function submit(): Promise<void> {
  if (state.value !== 'idle') return;
  if (!password.value) {
    error.value = '请输入密码';
    input.value?.focus();
    return;
  }
  state.value = 'busy';
  error.value = '';
  try {
    await post('/api/auth/login', { password: password.value });
    state.value = 'ok';
    setTimeout(() => emit('done'), 520);
  } catch (e) {
    state.value = 'idle';
    error.value = e instanceof ApiError && e.status === 429 ? '尝试次数太多，请 1 分钟后再试' : e instanceof Error ? e.message : String(e);
    shake.value = false;
    requestAnimationFrame(() => (shake.value = true));
    password.value = '';
    input.value?.focus();
  }
}
function onKey(e: KeyboardEvent): void {
  caps.value = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
}
function theme(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  toggleTheme(r.left + r.width / 2, r.top + r.height / 2);
}

const CMD = 'cd /opt/starfall && pnpm reset-password';
const copied = ref(false);
async function copyCmd(): Promise<void> {
  try {
    await navigator.clipboard.writeText(CMD);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    /* 浏览器不允许时可以手动选中 */
  }
}
function outside(e: MouseEvent): void {
  if (forgot.value && !forgotEl.value?.contains(e.target as Node)) forgot.value = false;
}
onMounted(() => {
  input.value?.focus();
  addEventListener('mousedown', outside);
});
onBeforeUnmount(() => removeEventListener('mousedown', outside));
</script>

<template>
  <div class="lg" :class="{ 'lg-ok': state === 'ok' }">
    <div class="lg-bg" aria-hidden="true">
      <i class="lg-aurora a1" /><i class="lg-aurora a2" /><i class="lg-aurora a3" />
      <i class="lg-grid" />
      <i class="lg-horizon" />
      <i class="lg-grain" />
    </div>

    <button class="icon-btn lg-theme" aria-label="切换亮色 / 暗色" @click="theme">
      <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
    </button>

    <main class="lg-center">
      <form class="lg-card" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
        <div class="lg-brand">
          <span class="lg-logo"><Logo :size="64" animated="once" /></span>
          <h1>登录星临</h1>
          <p>直播间特效管理后台</p>
        </div>

        <div class="lg-field">
          <label for="lg-pw" class="lg-sr">密码</label>
          <div class="lg-pw" :class="{ bad: error }">
            <Icon name="i-lock" />
            <input
              id="lg-pw"
              ref="input"
              v-model="password"
              :type="show ? 'text' : 'password'"
              autocomplete="current-password"
              spellcheck="false"
              placeholder="密码"
              :aria-invalid="Boolean(error)"
              aria-describedby="lg-msg"
              @keydown="onKey"
              @keyup="onKey"
              @input="error = ''"
            />
            <button type="button" class="lg-eye" :aria-label="show ? '隐藏密码' : '显示密码'" :aria-pressed="show" @click="(show = !show), input?.focus()">
              <Icon :name="show ? 'i-eye-off' : 'i-eye'" />
            </button>
          </div>
          <div id="lg-msg" class="lg-msg" role="alert">
            <span v-if="error" class="err">{{ error }}</span>
            <span v-else-if="caps" class="lg-caps">大写锁定已开启</span>
          </div>
        </div>

        <button class="btn primary lg-submit" type="submit" :disabled="state !== 'idle'">
          <template v-if="state === 'busy'"><span class="spin lg-spin" />正在登录</template>
          <template v-else-if="state === 'ok'"><Icon name="i-check" />欢迎回来</template>
          <template v-else>登录<Icon name="i-arrow" /></template>
        </button>

        <div ref="forgotEl" class="lg-forgot">
          <button type="button" class="lg-link" :aria-expanded="forgot" @click="forgot = !forgot">忘记密码？</button>
          <Transition name="lg-pop">
            <div v-if="forgot" class="lg-pop" role="dialog" aria-label="找回密码">
              <b>重置密码</b>
              <span>在服务器上运行这条命令，会生成新密码并显示出来：</span>
              <div class="lg-cmd"><code>{{ CMD }}</code><button type="button" class="btn" @click="copyCmd">{{ copied ? '已复制' : '复制' }}</button></div>
            </div>
          </Transition>
        </div>
      </form>
    </main>
    <footer class="lg-foot">星临 STARFALL</footer>
  </div>
</template>
