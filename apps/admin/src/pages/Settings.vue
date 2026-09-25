<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Avatar from '../components/Avatar.vue';
import ConfirmButton from '../components/ConfirmButton.vue';
import Icon from '../components/Icon.vue';
import QrLogin from '../components/QrLogin.vue';
import Seg from '../components/Seg.vue';
import Switch from '../components/Switch.vue';
import { del, get, post, put } from '../lib/api.ts';
import { refreshSettings, refreshStatus, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { BlacklistEntry, RoomRecord, Settings } from '../lib/types.ts';

const qr = ref(false);
const acct = computed(() => state.status?.account);
const room = computed(() => state.status?.room);
const days = computed(() => {
  const a = acct.value;
  if (!a?.loggedIn || !a.expiresAt) return null;
  return Math.floor((a.expiresAt - Date.now()) / 86400_000);
});

async function logoutBili(): Promise<void> {
  const r = await attempt(() => del<{ remote: boolean }>('/api/bili/account'));
  if (!r) return;
  toast(r.remote ? '已退出 B 站登录，登录信息已在 B 站失效' : '已删除本地的登录信息（没能通知 B 站，登录信息可能要过期后才失效）', r.remote ? 'ok' : 'info');
  await refreshStatus();
}

const roomIn = ref('');
const roomBusy = ref(false);
async function setRoom(): Promise<void> {
  const id = Number(roomIn.value.trim());
  if (!Number.isInteger(id) || id <= 0) return toast('房间号只能是数字', 'err');
  roomBusy.value = true;
  const r = await attempt(() => put<{ room: RoomRecord }>('/api/room', { id }));
  roomBusy.value = false;
  if (!r) return;
  toast(`已设置直播间 ${r.room.roomId}（主播：${r.room.anchorName || r.room.anchorUid}）`);
  roomIn.value = '';
  await refreshStatus();
}

async function saveSetting(patch: Partial<Settings>, msg: string): Promise<void> {
  if (await attempt(() => put('/api/settings', patch), msg)) {
    await refreshSettings();
    void refreshStatus();
  }
}

const bl = ref<BlacklistEntry[]>([]);
const blIn = ref('');
async function loadBl(): Promise<void> {
  bl.value = (await get<{ blacklist: BlacklistEntry[] }>('/api/blacklist').catch(() => ({ blacklist: [] }))).blacklist;
}
async function addBl(): Promise<void> {
  const uid = Number(blIn.value.trim());
  if (!Number.isInteger(uid) || uid <= 0) return toast('UID 只能是数字', 'err');
  const r = await attempt(() => post<BlacklistEntry>('/api/blacklist', { uid }));
  if (!r) return;
  toast(`已加入黑名单：${r.name || uid}`);
  blIn.value = '';
  await loadBl();
}
async function removeBl(x: BlacklistEntry): Promise<void> {
  if (await attempt(() => del(`/api/blacklist/${x.uid}`), `已移出黑名单：${x.name || x.uid}`)) await loadBl();
}

const pw = ref({ current: '', next: '' });
async function changePw(): Promise<void> {
  if (pw.value.next.length < 8) return toast('新密码至少 8 位', 'err');
  const next = pw.value.next;
  if (!(await attempt(() => put('/api/auth/password', pw.value)))) return;
  // 改密码后旧的登录会失效，用新密码重新登录
  await attempt(() => post('/api/auth/login', { password: next }), '密码已修改，其他设备需要重新登录');
  pw.value = { current: '', next: '' };
}

onMounted(() => {
  void loadBl();
  void refreshSettings();
});
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><h1>设置</h1><p>账号、直播间、播放方式和数据。</p></div>
    </div>
    <div class="set-grid">
      <div class="card">
        <div class="card-h"><h2>B站账号</h2><span class="aside">用来读取直播间消息（昵称、UID）</span></div>
        <template v-if="acct?.loggedIn">
          <div class="acct" style="background: none; border: 0; box-shadow: none; padding: 0">
            <Avatar :name="acct.name" :face="acct.face" :size="44" />
            <div class="acct-info">
              <b>{{ acct.name }}</b>
              <span class="num">UID {{ acct.uid }}<template v-if="days !== null"> · {{ days >= 0 ? `登录有效，剩余 ${days} 天` : '登录已过期' }}</template></span>
            </div>
          </div>
          <div class="acct-actions">
            <button class="btn" @click="qr = true"><Icon name="i-qr" />换个账号</button>
            <ConfirmButton label="退出登录" confirm-label="确认退出？开播时将无法读取消息" cls="btn" @confirm="logoutBili" />
          </div>
        </template>
        <template v-else>
          <p style="margin: 0 0 12px; font-size: 13px; color: var(--t2)">还没有登录。不登录的话 B 站会隐藏观众昵称和 UID，特效无法按身份播放。建议用 <b>小号</b> 扫码。</p>
          <button class="btn primary" @click="qr = true"><Icon name="i-qr" />扫码登录</button>
        </template>
      </div>

      <div class="card">
        <div class="card-h"><h2>直播间</h2></div>
        <div class="field">
          <label for="roomIn">房间号 <span class="hint">短号、长号都可以</span></label>
          <div class="url"><input id="roomIn" v-model="roomIn" class="inp num" :placeholder="room ? String(room.shortId || room.roomId) : '例如 21452505'" inputmode="numeric" @keydown.enter="setRoom" /><button class="btn" :disabled="roomBusy" @click="setRoom">{{ room ? '更换' : '连接' }}</button></div>
          <div v-if="room" class="lookup ok">当前：房间 {{ room.roomId }}<template v-if="room.shortId">（短号 {{ room.shortId }}）</template> · 主播 {{ room.anchorName || room.anchorUid }} · {{ state.status?.live.live ? '直播中' : '未开播' }}</div>
        </div>
      </div>

      <div v-if="state.settings" class="card">
        <div class="card-h"><h2>播放</h2></div>
        <div class="field">
          <span class="flabel">未开播时</span>
          <Seg :model-value="state.settings.offlinePolicy" label="未开播时" :options="[{ value: 'mute', label: '不播放' }, { value: 'play', label: '照常播放（排练用）' }]" @change="(v) => saveSetting({ offlinePolicy: v }, v === 'play' ? '未开播时也会播放（排练模式）' : '未开播时不播放')" />
          <span class="hint" style="font-size: 12px; color: var(--t3)">默认只在开播时播放。下播后有人进直播间，不会播特效，但会记录。</span>
        </div>
        <div class="field" style="margin-top: 14px">
          <span class="flabel">连接直播间</span>
          <Seg :model-value="state.settings.connectMode" label="连接时机" :options="[{ value: 'live_only', label: '只在开播时（推荐）' }, { value: 'always', label: '一直连接' }]" @change="(v) => saveSetting({ connectMode: v }, v === 'always' ? '会一直连接直播间' : '只在开播时连接直播间')" />
          <span class="hint" style="font-size: 12px; color: var(--t3)">只在开播时连接：没开播时账号不在线，更安全。排练模式下会一直连接。</span>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>黑名单</h2><span class="aside">这些人不会触发任何特效，事件照常记录</span></div>
        <template v-if="state.settings">
          <div class="toggle-line">主播本人不触发 <Switch v-model="state.settings.blockAnchor" label="主播本人不触发" @change="(v) => saveSetting({ blockAnchor: v }, v ? '主播本人不会触发特效' : '主播本人也会触发特效')" /></div>
          <div class="toggle-line" style="margin-top: 8px">登录的 B 站账号不触发 <span class="hint">通常是小号</span><Switch v-model="state.settings.blockAccount" label="登录的账号不触发" @change="(v) => saveSetting({ blockAccount: v }, v ? '登录的账号不会触发特效' : '登录的账号也会触发特效')" /></div>
        </template>
        <div class="add-user" style="margin-top: 12px"><input v-model="blIn" class="inp num" placeholder="输入 UID，回车添加" inputmode="numeric" aria-label="黑名单 UID" @keydown.enter="addBl" /><button class="btn" @click="addBl">添加</button></div>
        <div class="bl-list">
          <div v-for="x in bl" :key="x.uid" class="bl-item">
            <Avatar :name="x.name || String(x.uid)" :size="24" />{{ x.name || '（昵称未知）' }}<span class="uid">{{ x.uid }}</span><span class="note">{{ x.note }}</span>
            <ConfirmButton label="" confirm-label="移出" cls="mvb" :aria-label="`移出 ${x.name || x.uid}`" @confirm="removeBl(x)"><Icon name="i-x" /></ConfirmButton>
          </div>
          <span v-if="!bl.length" class="inline-hint">还没有。事件记录、实时动态里点观众也可以直接加入黑名单。</span>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>管理后台</h2></div>
        <div class="field">
          <label for="pw1">修改登录密码</label>
          <div class="row2"><input id="pw1" v-model="pw.current" class="inp" type="password" placeholder="当前密码" autocomplete="current-password" /><input v-model="pw.next" class="inp" type="password" placeholder="新密码（至少 8 位）" autocomplete="new-password" /></div>
          <div style="display: flex; justify-content: flex-end; margin-top: 4px"><button class="btn" :disabled="!pw.current || !pw.next" @click="changePw">保存密码</button></div>
        </div>
      </div>

      <div v-if="state.settings" class="card">
        <div class="card-h"><h2>数据</h2></div>
        <div class="field">
          <div class="slider-row">
            <label for="keep">事件记录保留</label>
            <select id="keep" class="sel" :value="state.settings.retentionDays" @change="(e) => saveSetting({ retentionDays: Number((e.target as HTMLSelectElement).value) as Settings['retentionDays'] }, '保留期已修改')">
              <option :value="30">30 天</option><option :value="90">90 天</option><option :value="180">180 天</option><option :value="0">永久</option>
            </select>
            <span />
          </div>
          <span class="hint" style="font-size: 12px; color: var(--t3)">原始消息只保留 7 天，用于排查问题。导出 / 导入配置、自动备份在后续版本提供。</span>
        </div>
      </div>
    </div>
    <QrLogin v-if="qr" @close="qr = false" />
  </section>
</template>
