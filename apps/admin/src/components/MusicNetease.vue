<script setup lang="ts">
// 点歌主页 · 网易云卡片：账号、会员类型和还剩几天（快到期、到期、登录失效时说清楚怎么办）、上次确认的时间（可以马上再确认）、
// 扫码登录 / 换账号 / 退出；底下一行是最近拿播放地址的情况，连着拿不到时可以重试
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import NeteaseQr from './NeteaseQr.vue';
import { del, post } from '../lib/api.ts';
import { ago, monthDay } from '../lib/format.ts';
import { URL_BAD_FAILS, daysLeft, music, neteaseState } from '../lib/music.ts';
import type { MusicAccountStatus } from '../lib/music.ts';
import { go } from '../lib/route.ts';
import { attempt, toast } from '../lib/toast.ts';

/** 打开主页时，上次确认超过这么久就再确认一次 */
const STALE_MS = 10 * 60_000;

const a = computed(() => music.account);
const on = computed(() => music.settings?.sourceNetease !== false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 30_000);
  if (on.value && a.value?.loggedIn && Date.now() - (a.value.checkedAt ?? 0) > STALE_MS) void check(false);
});
onBeforeUnmount(() => timer && clearInterval(timer));

const st = computed(() => neteaseState(a.value, now.value));
const days = computed(() => (a.value?.vipUntil !== undefined ? daysLeft(a.value.vipUntil, now.value) : null));
const SAY = {
  vip: { dot: '', text: '会员歌也能完整放' },
  soon: { dot: 'warn', text: '会员快到期了' },
  expired: { dot: 'bad', text: '会员歌放不了，免费歌照常' },
  invalid: { dot: 'bad', text: '登录失效了，会员歌放不了' },
  free: { dot: 'off', text: '不是会员：会员歌放不了，免费歌照常' },
  none: { dot: 'off', text: '' },
} as const;

// ---------- 确认登录、会员 ----------
const checking = ref(false);
async function check(manual = true): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  const before = a.value?.checkedAt;
  const r = await attempt(() => post<MusicAccountStatus>('/api/music/account/check'));
  checking.value = false;
  if (!r) return;
  music.account = r;
  now.value = Date.now();
  if (!manual) return;
  if (r.checkedAt === before) toast('网易云暂时连不上，过一会儿再试', 'err');
  else if (r.invalid) toast('网易云说登录失效了，请重新扫码', 'info');
  else toast('已确认：登录有效，会员信息是最新的');
}

const qr = ref(false);
async function logout(): Promise<void> {
  if (await attempt(() => del('/api/music/account'), '已退出网易云账号')) music.account = { loggedIn: false, urls: music.account?.urls ?? { fails: 0 } };
}

// ---------- 拿播放地址 ----------
const urls = computed(() => a.value?.urls ?? { fails: 0 });
const urlsBad = computed(() => urls.value.fails >= URL_BAD_FAILS);
const conn = computed(() => {
  const u = urls.value;
  if (urlsBad.value) return { dot: 'bad', text: `拿不到播放地址：连着 ${u.fails} 首都没拿到` };
  if (u.fails && u.failAt) return { dot: 'warn', text: `上一首没拿到播放地址（${ago(u.failAt, now.value)}）` };
  if (u.okAt) return { dot: '', text: `拿歌正常 · ${ago(u.okAt, now.value)}拿到《${u.okName}》` };
  return { dot: 'off', text: '还没放过网易云的歌' };
});
const retrying = ref(false);
async function retry(): Promise<void> {
  retrying.value = true;
  const r = await attempt(() => post<{ ok: boolean; text: string }>('/api/music/account/retry'));
  retrying.value = false;
  if (r) toast(r.text, r.ok ? 'ok' : 'err');
}
</script>

<template>
  <div class="card nc">
    <div class="card-h">
      <span class="nc-mark"><Icon name="i-music" /></span>
      <h2>网易云音乐</h2>
      <span v-if="on && a?.loggedIn" class="aside">
        <span>{{ checking ? '正在确认…' : a.checkedAt ? `${ago(a.checkedAt, now)}确认过` : '' }}</span>
        <button class="icon-btn sm" :class="{ spin: checking }" type="button" title="现在确认一次：登录还有效吗、会员到哪天" aria-label="现在确认一次登录和会员" @click="check()"><Icon name="i-replay" /></button>
      </span>
    </div>

    <template v-if="!on">
      <div class="nc-empty">
        <span class="nc-ico"><Icon name="i-music" /></span>
        <span><b>没有从网易云找歌</b><span>现在只从本地歌库找歌。要用网易云，到「规则 → 歌从哪里找」里打开。</span></span>
      </div>
      <div class="nc-foot"><span class="acts"><button class="btn" type="button" @click="go('music', 'rules')">去打开</button></span></div>
    </template>

    <template v-else-if="!a?.loggedIn">
      <div class="nc-empty">
        <span class="nc-ico"><Icon name="i-qr" /></span>
        <span><b>还没登录网易云</b><span>免费歌照常放；用网易云 App 扫码登录会员账号后，会员歌也能完整放。</span></span>
      </div>
      <div class="nc-sep" />
      <div class="nc-foot">
        <span class="nc-conn" :class="{ bad: urlsBad }"><i class="dot" :class="conn.dot" /><span>{{ conn.text }}</span></span>
        <span class="acts">
          <button v-if="urlsBad" class="btn" type="button" :disabled="retrying" @click="retry">{{ retrying ? '正在试…' : '现在重试' }}</button>
          <button class="btn primary" type="button" @click="qr = true"><Icon name="i-qr" />扫码登录</button>
        </span>
      </div>
    </template>

    <template v-else>
      <div class="nc-main">
        <span class="nc-av" :class="{ ring: st === 'vip' || st === 'soon' }"><Avatar :name="a.name || '网易云'" :face="a.avatar" :size="52" /></span>
        <span class="nc-who">
          <span class="nc-name">
            <span class="t">{{ a.name || '网易云账号' }}</span>
            <span v-if="st === 'vip' || st === 'soon'" class="vip"><Icon name="i-star" />{{ a.vipKind || '会员' }}</span>
            <span v-else-if="st === 'expired'" class="vip off">{{ a.vipKind || '会员' }} 已到期</span>
            <span v-else-if="st === 'free'" class="vip off">不是会员</span>
          </span>
          <span class="nc-say"><i class="dot" :class="SAY[st].dot" />{{ SAY[st].text }}</span>
        </span>
        <span v-if="st === 'invalid'" class="nc-days bad"><b>已失效</b><span>请重新扫码</span></span>
        <span v-else-if="st === 'expired'" class="nc-days bad"><b>已到期</b><span>{{ monthDay(a.vipUntil!) }}到期</span></span>
        <span v-else-if="(st === 'vip' || st === 'soon') && days !== null" class="nc-days" :class="{ warn: st === 'soon' }"><b class="num">{{ days }}<small>天</small></b><span>{{ monthDay(a.vipUntil!) }}到期</span></span>
        <span v-else-if="st === 'vip'" class="nc-days"><span>到期日查不到</span></span>
      </div>
      <template v-if="st === 'soon' && days !== null">
        <div class="nc-left" aria-hidden="true"><i :style="{ width: `${Math.max(4, (days / 30) * 100)}%` }" /></div>
        <div class="nc-tip">还剩 {{ days }} 天，到期后会员歌放不了，免费歌照常。续费后点右上角的刷新。</div>
      </template>
      <div v-else-if="st === 'expired'" class="nc-tip bad">在网易云 App 里续费后点右上角的刷新，会员歌马上就能放。</div>
      <div v-else-if="st === 'invalid'" class="nc-tip bad">可能在别处退出了或改了密码，重新扫码即可，列表不受影响。</div>
      <div class="nc-sep" />
      <div class="nc-foot">
        <span class="nc-conn" :class="{ bad: urlsBad }"><i class="dot" :class="conn.dot" /><span>{{ conn.text }}</span></span>
        <span class="acts">
          <button v-if="urlsBad" class="btn" type="button" :disabled="retrying" @click="retry">{{ retrying ? '正在试…' : '现在重试' }}</button>
          <button v-if="st === 'invalid'" class="btn primary" type="button" @click="qr = true"><Icon name="i-qr" />重新扫码</button>
          <template v-else>
            <button class="btn" type="button" @click="qr = true"><Icon name="i-qr" />换个账号</button>
            <ConfirmButton label="退出" confirm-label="确认退出？" cls="btn" @confirm="logout" />
          </template>
        </span>
      </div>
    </template>
    <NeteaseQr v-if="qr" @close="qr = false" />
  </div>
</template>

<style scoped>
.nc { display: flex; flex-direction: column; }
.nc-mark { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; background: #E5484D; color: #fff; flex: none; }
.nc-mark svg { width: 11px; height: 11px; }
.card-h .aside .icon-btn.sm { width: 28px; height: 28px; }
.card-h .aside .icon-btn.sm svg { width: 14px; height: 14px; }
.icon-btn.spin svg { animation: nc-spin .8s linear infinite; }
@keyframes nc-spin { to { transform: rotate(360deg); } }

.nc-main { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; }
.nc-av { position: relative; width: 52px; height: 52px; }
.nc-av.ring::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 1.5px solid var(--vip-fg); opacity: .75; }
.nc-who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.nc-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 16px; font-weight: 600; color: var(--t1); }
.nc-name .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 会员标签：深底金字 */
.vip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: var(--r-xs); background: var(--vip-bg); color: var(--vip-fg); font-size: var(--fs-cap); font-weight: 600; letter-spacing: .02em; flex: none; }
.vip svg { width: 11px; height: 11px; }
.vip.off { background: var(--hover); color: var(--t3); }
.nc-say { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sec); color: var(--t2); }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ok); }
.dot.warn { background: var(--gov); }
.dot.bad { background: var(--bad); }
.dot.off { background: var(--line-strong); }
.nc-days { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; }
.nc-days b { font-size: 34px; font-weight: 600; letter-spacing: -0.04em; color: var(--t1); }
.nc-days b small { font-family: var(--font-sans); font-size: var(--fs-sec); font-weight: 500; letter-spacing: 0; margin-left: 3px; color: var(--t2); }
.nc-days span { font-size: var(--fs-cap); color: var(--t3); }
.nc-days.warn b, .nc-days.warn b small { color: var(--gov); }
.nc-days.bad b { color: var(--bad); font-size: 20px; letter-spacing: 0; }
/* 会员还剩多少：30 天内才出现，越短越急 */
.nc-left { position: relative; height: 3px; margin-top: 14px; border-radius: 2px; background: var(--hover); overflow: hidden; }
.nc-left i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; background: var(--gov); }
.nc-tip { margin-top: 12px; padding: 9px 12px; border-radius: var(--r-sm); font-size: var(--fs-sec); line-height: 1.6; color: var(--t1); background: var(--gov-soft); }
.nc-tip.bad { background: var(--bad-soft); }
.nc-sep { height: 1px; background: var(--line); margin: 16px -20px 0; }
.nc-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: auto; padding-top: 14px; }
.nc-foot .acts { display: flex; gap: 6px; margin-left: auto; }
.nc-foot .btn, .nc-foot :deep(.btn), .nc-foot :deep(.delb) { height: 30px; padding: 0 12px; font-size: var(--fs-sec); }
.nc-conn { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--fs-sec); color: var(--t2); }
.nc-conn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nc-conn.bad { color: var(--bad); }
.nc-empty { display: flex; align-items: center; gap: 14px; }
.nc-ico { width: 52px; height: 52px; border-radius: var(--r-md); display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.nc-ico svg { width: 24px; height: 24px; }
.nc-empty b { display: block; font-size: var(--fs-title); font-weight: 600; margin-bottom: 3px; }
.nc-empty span span { font-size: var(--fs-sec); color: var(--t2); line-height: 1.6; }
</style>
