<script setup lang="ts">
// 新手引导（F-UI-06）：扫码登录 → 填房间号 → 加到直播软件 → 发送测试特效。
// 首次使用、还没设置好时自动弹出；可跳过，可在设置里重新打开。每一步都是真实操作，已完成的步骤直接显示结果。
import { computed, nextTick, ref, watch } from 'vue';
import { post, put } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';
import { useQrLogin } from '../lib/qr.ts';
import { output, refreshSettings, refreshStatus, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto, RoomRecord } from '../lib/types.ts';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import PreviewStage from './PreviewStage.vue';
import QrBox from './QrBox.vue';

const emit = defineEmits<{ close: [] }>();
const N = 4;
const acct = computed(() => state.status?.account);
const room = computed(() => state.status?.room);
// 从第一个没完成的步骤开始
const step = ref(!acct.value?.loggedIn ? 0 : !room.value ? 1 : 2);

// ---------- 第 1 步：扫码 ----------
// 只在这一步、还没登录时才申请二维码；离开这一步就停止查询
const qr = useQrLogin(() => (step.value = 1), false);
watch(
  () => step.value === 0 && !acct.value?.loggedIn,
  (need) => (need ? void qr.start() : qr.stop()),
  { immediate: true },
);

// ---------- 第 2 步：房间号 ----------
const roomIn = ref(room.value ? String(room.value.shortId || room.value.roomId) : '');
const roomBusy = ref(false);
const roomErr = ref('');
async function saveRoom(): Promise<void> {
  const v = roomIn.value.trim();
  roomErr.value = '';
  if (!/^\d{1,12}$/.test(v)) {
    roomErr.value = '请填写数字房间号';
    return;
  }
  const cur = room.value;
  if (cur && (Number(v) === cur.roomId || Number(v) === cur.shortId)) {
    step.value = 2;
    return;
  }
  roomBusy.value = true;
  const r = await attempt(() => put<{ room: RoomRecord }>('/api/room', { id: Number(v) }));
  roomBusy.value = false;
  if (!r) return;
  await refreshStatus().catch(() => undefined);
  toast(`已设置直播间 ${r.room.roomId}（主播：${r.room.anchorName || r.room.anchorUid}）`);
  step.value = 2;
}

// ---------- 第 3 步：加到直播软件 ----------
const out = computed(() => output());
const url = computed(() => (out.value ? `${location.origin}${out.value.path}` : ''));
// 只算直播软件里的特效页，不算「在浏览器里查看」打开的
const online = computed(() => state.overlays.some((x) => x.outputId === out.value?.id && !x.env?.view));
async function setApp(app: OutputDto['app']): Promise<void> {
  const o = out.value;
  if (!o || o.app === app) return;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${o.id}`, { app }));
  if (r) Object.assign(o, r);
}
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(url.value);
    toast('已复制浏览器源地址');
  } catch {
    toast('浏览器不允许自动复制，请手动选中地址复制', 'info');
  }
}

// ---------- 第 4 步：测试 ----------
const stage = ref<InstanceType<typeof PreviewStage> | null>(null);
/** 用舰长的进场素材测试；没设置时依次换总督、提督、普通观众 */
const test = computed<{ id: Identity; effectId: number } | null>(() => {
  const r = state.enter;
  if (!r) return null;
  for (const id of ['cap', 'gov', 'adm', 'nor'] as const) {
    const e = r.tiers[id];
    if (e.effectId) return { id, effectId: e.effectId };
  }
  return null;
});
const sent = ref(false);
function preview(): void {
  if (test.value) void stage.value?.play(test.value.effectId, SAMPLES[test.value.id]);
}
async function sendLive(): Promise<void> {
  if (!test.value) return;
  if (await attempt(() => post('/api/playback/test', { effectId: test.value!.effectId }), '已发送测试特效到直播软件')) sent.value = true;
}
watch(step, async (s) => {
  if (s !== 3) return;
  await nextTick();
  preview();
});

// ---------- 结束 ----------
async function finish(skip: boolean): Promise<void> {
  emit('close');
  if (state.settings && !state.settings.onboarded) {
    await attempt(() => put('/api/settings', { onboarded: true }));
    await refreshSettings().catch(() => undefined);
  }
  toast(skip ? '随时可以在「设置」里重新打开新手引导' : '设置完成，开播时特效会自动播放', skip ? 'info' : 'ok');
}
</script>

<template>
  <Teleport to="body">
    <div class="ed-scrim" />
    <div class="wiz" role="dialog" aria-label="新手引导">
      <div class="wiz-h">
        <div class="steps-bar" aria-hidden="true"><i v-for="i in N" :key="i" :class="{ on: i - 1 <= step }" /></div>
        <template v-if="step === 0">
          <h2>第 1 步：登录 B 站账号</h2>
          <p>用 B 站 App 扫一扫。登录后才能看到观众的昵称和 UID，特效才能按人触发。</p>
        </template>
        <template v-else-if="step === 1">
          <h2>第 2 步：填写你的直播间</h2>
          <p>直播间地址 live.bilibili.com/<b>数字</b> 里，最后那串数字就是房间号，短号、长号都可以。</p>
        </template>
        <template v-else-if="step === 2">
          <h2>第 3 步：加到直播软件里</h2>
          <p>特效页要作为浏览器源放进直播软件，放在所有图层的最上面。</p>
        </template>
        <template v-else>
          <h2>第 4 步：测试一下</h2>
          <p>下面是本地预览。发送到直播软件后，直播画面里应该出现同样的特效，并听到声音。</p>
        </template>
      </div>

      <div class="wiz-b">
        <template v-if="step === 0">
          <div v-if="acct?.loggedIn" class="wiz-ok">
            <Avatar :name="acct.name" :face="acct.face" />
            <span><b>已登录：{{ acct.name }}</b><span>UID {{ acct.uid }}，可以直接下一步。想换账号请到「设置」里重新扫码。</span></span>
          </div>
          <div v-else class="wiz-qr"><QrBox :qr="qr" /></div>
          <div class="tipbox"><b>建议用小号</b>：只用来读取直播间消息，不发弹幕。登录信息加密保存在这台服务器上，大约 30 天需要重新扫一次。</div>
        </template>

        <template v-else-if="step === 1">
          <div class="field">
            <label for="wzRoom">房间号</label>
            <input id="wzRoom" v-model="roomIn" class="inp num" inputmode="numeric" placeholder="例如 21452505" autofocus @keydown.enter="saveRoom" />
          </div>
          <div v-if="roomErr" class="lookup err">{{ roomErr }}</div>
          <div v-else-if="roomBusy" class="lookup"><span class="spin" />正在查询直播间…</div>
          <div v-else-if="room" class="lookup ok">当前：房间 {{ room.roomId }}<template v-if="room.shortId">（短号 {{ room.shortId }}）</template> · 主播 {{ room.anchorName || room.anchorUid }}</div>
        </template>

        <template v-else-if="step === 2 && out">
          <div class="appcards">
            <button type="button" :aria-pressed="out.app === 'livehime'" @click="setApp('livehime')"><b>B站直播姬</b><span>添加素材 → 浏览器</span></button>
            <button type="button" :aria-pressed="out.app === 'obs'" @click="setApp('obs')"><b>OBS Studio</b><span>来源 → + → 浏览器</span></button>
          </div>
          <div class="field">
            <span class="flabel">地址 <span class="hint">带访问密钥，不要公开</span></span>
            <div class="url"><input class="inp" readonly :value="url" @focus="(e) => (e.target as HTMLInputElement).select()" /><button class="btn" @click="copy"><Icon name="i-copy" />复制</button></div>
          </div>
          <div class="field">
            <span class="flabel">宽高</span>
            <span class="wiz-note">填 <b class="num">{{ out.width }} × {{ out.height }}</b>（{{ out.orient === 'portrait' ? '竖屏' : '横屏' }}）<template v-if="out.app === 'obs'">，并勾选「通过 OBS 控制音频」</template></span>
          </div>
          <div class="lookup" :class="{ ok: online }">
            <template v-if="online"><Icon name="i-check" />特效页已在线</template>
            <template v-else><span class="spin" />还没检测到特效页，加好后这里会自动变成「已在线」</template>
          </div>
        </template>

        <template v-else-if="step === 3">
          <PreviewStage ref="stage" label="预览" />
          <div class="wiz-test">
            <button class="btn" :disabled="!test" @click="preview"><Icon name="i-play" />再预览一次</button>
            <ConfirmButton v-if="state.status?.live.live" label="发送测试特效到直播软件" confirm-label="正在直播，确认发送？观众会看到" cls="btn live-send" armed-cls="btn live-send" :disabled="!test || !online || state.status?.paused" @confirm="sendLive" />
            <button v-else class="btn live-send" :disabled="!test || !online || state.status?.paused" @click="sendLive">发送测试特效到直播软件</button>
          </div>
          <span class="wiz-note center">
            <template v-if="!test">还没有给任何身份设置进场素材，请到「触发规则」里设置。</template>
            <template v-else-if="!online">特效页还不在线，请先完成上一步，把地址加到直播软件里。</template>
            <template v-else-if="state.status?.paused">现在是暂停状态，恢复播放后才能发送测试。</template>
            <template v-else-if="sent">没看到？到「直播软件输出」页打开兼容性自检排查。</template>
            <template v-else>没开播也可以测试，观众看不到。</template>
          </span>
        </template>
      </div>

      <div class="wiz-f">
        <button v-if="step < 3" class="linkish" @click="finish(true)">稍后再说</button>
        <button v-if="step > 0" class="btn" @click="step--">上一步</button>
        <span v-if="step === 3" style="flex: 1" />
        <button v-if="step === 0" class="btn primary" :disabled="!acct?.loggedIn" @click="step = 1">下一步</button>
        <button v-else-if="step === 1" class="btn primary" :disabled="roomBusy" @click="saveRoom">下一步</button>
        <button v-else-if="step === 2" class="btn primary" @click="step = 3">{{ online ? '下一步' : '我加好了' }}</button>
        <button v-else class="btn primary" @click="finish(false)">完成</button>
      </div>
    </div>
  </Teleport>
</template>
