<script setup lang="ts">
// 登录页（织幕）：左边标语，右边玻璃卡片；背景是三团缓慢变化的色块 + 三层丝绸光带（亮 / 暗各一套配色）
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

// 丝绸光带：上沿 + 其余轮廓（后 / 中 / 前三层，只从下方和右侧流过，不挡左边的标语）
const RIBBONS = [
  { g: 'lgRb1', top: 'M -150 860 C 250 820, 650 760, 1000 560 S 1450 180, 1800 120', rest: 'L 1800 300 C 1500 360, 1250 560, 1060 700 S 450 1000, -150 1040 Z' },
  { g: 'lgRb2', top: 'M -150 800 C 300 720, 700 900, 1100 770 S 1500 610, 1800 660', rest: 'L 1800 790 C 1500 750, 1250 910, 1080 910 S 400 890, -150 950 Z' },
  { g: 'lgRb3', top: 'M 480 1030 C 800 910, 1100 870, 1350 730 S 1700 530, 1850 480', rest: 'L 1850 525 C 1700 585, 1450 800, 1360 812 S 820 975, 500 1070 Z' },
];
</script>

<template>
  <div class="lg" :class="{ 'lg-ok': state === 'ok' }">
    <div class="lg-bg" aria-hidden="true">
      <div class="lg-fields"><i class="f1" /><i class="f2" /><i class="f3" /></div>
      <svg class="lg-silk" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient v-for="(n, i) in ['1', '2', '3']" :id="`lgRb${n}`" :key="n" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" :style="{ stopColor: `rgb(var(--lg-rb${n}))`, stopOpacity: 0 }" />
            <stop :offset="['.45', '.35', '.5'][i]" :style="{ stopColor: `rgb(var(--lg-rb${n}))`, stopOpacity: `var(--lg-rb${n}-a)` }" />
            <stop v-if="i < 2" :offset="['.85', '.8'][i]" :style="{ stopColor: `rgb(var(--lg-rb${n}))`, stopOpacity: `calc(var(--lg-rb${n}-a) * .75)` }" />
            <stop offset="1" :style="{ stopColor: `rgb(var(--lg-rb${n}))`, stopOpacity: 0 }" />
          </linearGradient>
          <linearGradient id="lgFold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35" /><stop offset=".35" stop-color="#fff" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".12" /></linearGradient>
        </defs>
        <g class="lg-drift">
          <g v-for="r in RIBBONS" :key="r.g">
            <path class="lg-rb-shadow" :d="`${r.top} ${r.rest}`" transform="translate(0 18)" />
            <path :d="`${r.top} ${r.rest}`" :fill="`url(#${r.g})`" />
            <path :d="`${r.top} ${r.rest}`" fill="url(#lgFold)" opacity=".8" />
            <path class="lg-sheen soft" :d="r.top" />
            <path class="lg-sheen" :d="r.top" transform="translate(0 3)" />
          </g>
        </g>
      </svg>
      <i class="lg-grain" />
      <i class="lg-vignette" />
    </div>

    <header class="lg-top">
      <div class="lg-brand">
        <Logo :size="36" animated="once" />
        <span><b>星临</b><span>STARFALL</span></span>
      </div>
      <button class="lg-theme" aria-label="切换亮色 / 暗色" @click="theme">
        <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
      </button>
    </header>

    <main class="lg-main">
      <section class="lg-pitch">
        <span class="lg-eyebrow"><i />B站直播间进场特效</span>
        <h1>让每一次进场，<br /><span class="l2">都成为一场驾临。</span></h1>
        <p>舰长登船、粉丝进场、专属用户驾到——星临认出每一位观众，自动播放为 TA 准备的特效。</p>
        <div class="lg-chips">
          <div class="lg-chip"><span class="ic"><Icon name="g-gov" /></span><span><b>身份识别</b><span>大航海 · 房管 · 粉丝牌</span></span></div>
          <div class="lg-chip"><span class="ic"><Icon name="i-spark" /></span><span><b>专属特效</b><span>为重要的人单独准备</span></span></div>
          <div class="lg-chip"><span class="ic"><Icon name="i-screen" /></span><span><b>即插即用</b><span>直播姬 · OBS</span></span></div>
        </div>
      </section>

      <form class="lg-card" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
        <h2>欢迎回来</h2>
        <p class="lg-sub">登录星临管理后台</p>

        <div>
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

        <button class="lg-submit" type="submit" :disabled="state !== 'idle'">
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

    <footer class="lg-foot">© 2026 星临 Starfall</footer>
  </div>
</template>
