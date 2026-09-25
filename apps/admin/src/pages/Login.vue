<script setup lang="ts">
// 登录页：全屏，风格和后台一致——背景是模糊的后台轮廓，中间一张登录卡片（跟随亮暗主题）
import { onMounted, ref } from 'vue';
import { ApiError, get, post } from '../lib/api.ts';
import { toggleTheme } from '../lib/theme.ts';
import Icon from '../components/Icon.vue';

const emit = defineEmits<{ done: [] }>();
const password = ref('');
const show = ref(false);
const error = ref('');
const state = ref<'idle' | 'busy' | 'ok'>('idle');
const shake = ref(false);
const caps = ref(false);
const forgot = ref(false);
const initial = ref(false);
const input = ref<HTMLInputElement | null>(null);

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
    setTimeout(() => emit('done'), 450);
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
    /* 浏览器不允许时用户可以手动选中 */
  }
}

onMounted(async () => {
  input.value?.focus();
  initial.value = (await get<{ initialPassword: boolean }>('/api/auth/setup').catch(() => ({ initialPassword: false }))).initialPassword;
});
</script>

<template>
  <div class="lg" :class="{ 'lg-ok': state === 'ok' }">
    <!-- 背景：后台界面的轮廓（只是装饰），像被锁在磨砂玻璃后面 -->
    <div class="lg-ghost" aria-hidden="true">
      <aside class="lg-g-side">
        <div class="lg-g-brand"><span class="brand-mark"><Icon name="i-spark" /></span><i style="width: 56px" /></div>
        <i v-for="w in [72, 64, 58, 70, 84]" :key="w" class="lg-g-nav" :style="{ width: `${w}%` }" />
        <i class="lg-g-acct" />
      </aside>
      <div class="lg-g-main">
        <div class="lg-g-top"><i style="width: 120px" /><i style="width: 70px" /><i class="lg-g-btn" /></div>
        <div class="lg-g-body">
          <i class="lg-g-h1" />
          <div class="lg-g-grid">
            <div v-for="n in 4" :key="n" class="lg-g-card k"><i style="width: 40%" /><b /></div>
            <div class="lg-g-card feed"><i style="width: 30%" /><span v-for="n in 6" :key="n"><em /><i /></span></div>
            <div class="lg-g-card prev"><i style="width: 36%" /><div class="lg-g-stage" /></div>
          </div>
        </div>
      </div>
    </div>

    <button class="icon-btn lg-theme" aria-label="切换亮色 / 暗色" @click="theme">
      <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
    </button>

    <main class="lg-center">
      <form class="lg-card" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
        <div class="lg-head">
          <span class="brand-mark"><Icon name="i-spark" /></span>
          <div>
            <h1>登录星临</h1>
            <p>管理后台 · 输入密码继续</p>
          </div>
        </div>

        <div v-if="initial" class="lg-tip">
          <Icon name="i-spark" />
          <span><b>首次使用？</b>初始密码保存在服务器的 <code>data/initial-password.txt</code> 里，服务第一次启动时也会打印在日志中。登录后请在「设置」里改成自己的密码。</span>
        </div>

        <div class="field">
          <label for="lg-pw">密码</label>
          <div class="lg-pw" :class="{ bad: error }">
            <Icon name="i-lock" />
            <input
              id="lg-pw"
              ref="input"
              v-model="password"
              :type="show ? 'text' : 'password'"
              autocomplete="current-password"
              spellcheck="false"
              placeholder="请输入密码"
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
          <template v-if="state === 'busy'"><span class="spin lg-spin" />正在登录…</template>
          <template v-else-if="state === 'ok'"><Icon name="i-check" />登录成功</template>
          <template v-else>登录<Icon name="i-arrow" /></template>
        </button>

        <div class="lg-foot-row">
          <button type="button" class="linkish" :aria-expanded="forgot" @click="forgot = !forgot">忘记密码？</button>
          <span>登录一次保持 30 天</span>
        </div>
        <div v-if="forgot" class="lg-forgot-box">
          在服务器上运行下面的命令，会生成一个新密码并显示出来，原来已登录的浏览器需要重新登录：
          <div class="lg-cmd"><code>{{ CMD }}</code><button type="button" class="btn" @click="copyCmd">{{ copied ? '已复制' : '复制' }}</button></div>
        </div>
      </form>
      <p class="lg-note">星临 Starfall · 部署在你自己的服务器上，数据不经过第三方</p>
    </main>
  </div>
</template>
