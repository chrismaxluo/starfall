<script setup lang="ts">
// 登录页：左边是星空和进场特效展示，右边是登录表单（跟随亮暗主题）
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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

// 星星和流星（位置随机，每次打开略有不同）
const stars = Array.from({ length: 70 }, () => ({
  left: `${(Math.random() * 100).toFixed(2)}%`,
  top: `${(Math.random() * 100).toFixed(2)}%`,
  size: `${(Math.random() < 0.85 ? 1 + Math.random() : 2 + Math.random()).toFixed(1)}px`,
  delay: `${(Math.random() * 6).toFixed(2)}s`,
  dur: `${(3 + Math.random() * 4).toFixed(2)}s`,
}));
const meteors = [
  { top: '8%', left: '62%', delay: '1.2s', dur: '7s' },
  { top: '22%', left: '88%', delay: '4.6s', dur: '9s' },
  { top: '4%', left: '38%', delay: '7.8s', dur: '11s' },
];

// 进场特效展示卡片
const SHOW = [
  { kind: 'gov', label: 'GOVERNOR · 总督', name: '长夜未央', say: '驾临', icon: 'g-gov' },
  { kind: 'cap', label: 'CAPTAIN · 舰长', name: '星河漫步', say: '登船', icon: 'g-cap' },
  { kind: 'adm', label: 'ADMIRAL · 提督', name: '月下独酌', say: '登船', icon: 'g-adm' },
  { kind: 'fan', label: 'FAN · 粉丝牌 21', name: '晚风与你', say: '来了', icon: 'i-medal' },
];
const idx = ref(0);
const card = computed(() => SHOW[idx.value % SHOW.length]!);
let cycle: ReturnType<typeof setInterval> | null = null;

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
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) cycle = setInterval(() => idx.value++, 3200);
  initial.value = (await get<{ initialPassword: boolean }>('/api/auth/setup').catch(() => ({ initialPassword: false }))).initialPassword;
});
onBeforeUnmount(() => cycle && clearInterval(cycle));
</script>

<template>
  <div class="lg" :class="{ 'lg-ok': state === 'ok' }">
    <!-- 星空 -->
    <section class="lg-sky" aria-hidden="true">
      <div class="lg-stars">
        <i v-for="(s, i) in stars" :key="i" :style="{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.dur }" />
      </div>
      <span v-for="(m, i) in meteors" :key="`m${i}`" class="lg-meteor" :style="{ top: m.top, left: m.left, animationDelay: m.delay, animationDuration: m.dur }" />
      <div class="lg-brand">
        <span class="brand-mark"><Icon name="i-spark" /></span>
        <span><div class="brand-name">星临</div><div class="brand-sub">STARFALL</div></span>
      </div>
      <div class="lg-hero">
        <h2>让每一次进场，<br />都被看见。</h2>
        <p>舰长登船、粉丝进场、专属用户驾到，<br />自动播放为 TA 准备的特效。</p>
        <div class="lg-show">
          <Transition name="lg-card" mode="out-in">
            <div :key="idx" class="lg-card" :class="`k-${card.kind}`">
              <span class="lg-badge"><Icon :name="card.icon" /></span>
              <span>
                <small>{{ card.label }}</small>
                <b>{{ card.name }}<em>{{ card.say }}</em></b>
              </span>
            </div>
          </Transition>
          <div class="lg-dots"><i v-for="(_, i) in SHOW" :key="i" :class="{ on: idx % SHOW.length === i }" /></div>
        </div>
      </div>
      <div class="lg-foot">部署在你自己的服务器上 · 数据不经过第三方</div>
    </section>

    <!-- 登录表单 -->
    <section class="lg-main">
      <button class="icon-btn lg-theme" aria-label="切换亮色 / 暗色" @click="theme">
        <Icon name="i-moon" class="theme-light-only" /><Icon name="i-sun" class="theme-dark-only" />
      </button>
      <form class="lg-form" :class="{ shake }" novalidate @submit.prevent="submit" @animationend="shake = false">
        <div class="lg-brand lg-brand-sm">
          <span class="brand-mark"><Icon name="i-spark" /></span>
          <span><div class="brand-name">星临</div><div class="brand-sub">STARFALL</div></span>
        </div>
        <div class="lg-title">
          <h1>欢迎回来</h1>
          <p>输入管理后台密码，继续管理直播间特效</p>
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

        <div class="lg-forgot">
          <button type="button" class="linkish" :aria-expanded="forgot" @click="forgot = !forgot">忘记密码？</button>
          <div v-if="forgot" class="lg-forgot-box">
            在服务器上运行下面的命令，会生成一个新密码并显示出来，原来已登录的浏览器需要重新登录：
            <div class="lg-cmd"><code>{{ CMD }}</code><button type="button" class="btn" @click="copyCmd">{{ copied ? '已复制' : '复制' }}</button></div>
          </div>
        </div>
        <p class="lg-note">登录一次保持 30 天 · 连续输错 5 次需要等 1 分钟</p>
      </form>
    </section>
  </div>
</template>
