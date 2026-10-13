<script setup lang="ts">
// 点歌 · 规则：指令、谁能点、限制、谁能切歌、下播暂停；歌从哪里找（网易云账号、本地歌库）；不收的歌、不让点歌的观众。改了立即保存
import { computed, onMounted, ref, watch } from 'vue';
import { MUSIC_BANNED_MAX, MUSIC_WORDS_MAX } from '@starfall/shared';
import type { MusicSettings } from '@starfall/shared';
import Avatar from './Avatar.vue';
import ConfirmButton from './ConfirmButton.vue';
import Icon from './Icon.vue';
import NeteaseQr from './NeteaseQr.vue';
import Switch from './Switch.vue';
import WhoPick from './WhoPick.vue';
import { del, get } from '../lib/api.ts';
import type { DanmuPerson } from '../lib/danmu-who.ts';
import { music, saveMusic } from '../lib/music.ts';
import { go } from '../lib/route.ts';
import { attempt, toast } from '../lib/toast.ts';

const s = computed(() => music.settings!);
const qr = ref(false);

// ---------- 指令 ----------
const cmds = ref({ cmdRequest: '', cmdSkip: '', cmdCancel: '', cmdMine: '' });
watch(() => music.settings, (v) => v && (cmds.value = { cmdRequest: v.cmdRequest, cmdSkip: v.cmdSkip, cmdCancel: v.cmdCancel, cmdMine: v.cmdMine }), { immediate: true });
const CMD_NAMES = { cmdRequest: '点歌', cmdSkip: '切歌', cmdCancel: '取消点歌', cmdMine: '查我点的歌' } as const;
async function saveCmd(k: keyof typeof CMD_NAMES): Promise<void> {
  const v = cmds.value[k].trim();
  if (v === s.value[k]) return;
  if (!v) {
    cmds.value[k] = s.value[k];
    return toast('指令不能为空', 'info');
  }
  const others = (Object.keys(CMD_NAMES) as Array<keyof typeof CMD_NAMES>).filter((x) => x !== k).map((x) => s.value[x]);
  if (others.includes(v)) {
    cmds.value[k] = s.value[k];
    return toast('几个指令不能一样', 'info');
  }
  if (!(await saveMusic({ [k]: v }, `${CMD_NAMES[k]}指令改成「${v}」`))) cmds.value[k] = s.value[k];
}

// ---------- 观众名字（谁能点、不让点歌的观众） ----------
const people = ref<DanmuPerson[]>([]);
async function lookup(uids: number[]): Promise<void> {
  const need = uids.filter((u) => !people.value.some((p) => p.uid === u));
  const found = await Promise.all(need.map((uid) => get<{ uid: number; name: string; face: string; guard?: number }>(`/api/viewers/${uid}`).catch(() => null)));
  people.value = [...people.value, ...need.map((uid, i) => ({ uid, name: found[i]?.name ?? null, face: found[i]?.face ?? null, guard: found[i]?.guard ?? 0 }))];
}
onMounted(() => void lookup([...s.value.who.uids, ...s.value.bannedUids]));
const person = (uid: number) => people.value.find((p) => p.uid === uid) ?? { uid, name: null, face: null, guard: 0 };

// ---------- 限制 ----------
function setNum(k: 'perUser' | 'queueMax', v: number, min: number, max: number, msg: (n: number) => string): void {
  const n = Math.round(v);
  if (!(n >= min && n <= max)) return toast(`要在 ${min} – ${max} 之间`, 'info');
  if (n !== s.value[k]) void saveMusic({ [k]: n }, msg(n));
}
const CD_OPTIONS = [0, 10, 30, 60, 120, 300, 600];
const LEN_OPTIONS = [180, 240, 300, 360, 420, 480, 600, 900];
const REPEAT_OPTIONS = [0, 10, 30, 60, 120, 240];
const repeatText = (v: number) => (v === 0 ? '不限' : v < 60 ? `${v} 分钟` : `${v / 60} 小时`);
const cdText = (v: number) => (v === 0 ? '不限' : v < 60 ? `${v} 秒` : `${v / 60} 分钟`);

// ---------- 网易云账号 ----------
const acct = computed(() => music.account);
async function logout(): Promise<void> {
  const r = await attempt(() => del('/api/music/account'), '已退出网易云账号');
  if (r) music.account = { loggedIn: false };
}

// ---------- 不收的歌、不让点歌的观众 ----------
const wordIn = ref('');
function addWord(): void {
  const w = wordIn.value.trim();
  if (!w) return;
  if (s.value.blockWords.includes(w)) return toast('已经有了', 'info');
  if (s.value.blockWords.length >= MUSIC_WORDS_MAX) return toast(`最多 ${MUSIC_WORDS_MAX} 个`, 'info');
  void saveMusic({ blockWords: [...s.value.blockWords, w] }, `歌名或歌手里有「${w}」的歌不收了`).then((ok) => ok && (wordIn.value = ''));
}
const uidIn = ref('');
async function addBan(): Promise<void> {
  const v = uidIn.value.trim();
  if (!/^\d{1,16}$/.test(v)) return toast('UID 只能是数字', 'info');
  const uid = Number(v);
  if (s.value.bannedUids.includes(uid)) return toast('已经在名单里了', 'info');
  if (s.value.bannedUids.length >= MUSIC_BANNED_MAX) return toast(`最多 ${MUSIC_BANNED_MAX} 人`, 'info');
  await lookup([uid]);
  if (await saveMusic({ bannedUids: [...s.value.bannedUids, uid] }, `${person(uid).name ?? uid} 不能点歌了`)) uidIn.value = '';
}
const set = (patch: Partial<MusicSettings>, msg?: string) => void saveMusic(patch, msg);
</script>

<template>
  <div v-if="music.settings" class="mr-grid">
    <div class="mr-col">
      <div class="card">
        <div class="card-h"><h2>弹幕指令</h2><span class="aside">改了立即保存</span></div>
        <div class="mr-cmds">
          <label v-for="(name, k) in CMD_NAMES" :key="k" class="field">
            <span class="flabel">{{ name }}</span>
            <input v-model="cmds[k]" class="inp" maxlength="8" :aria-label="`${name}指令`" @change="saveCmd(k)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
          </label>
        </div>
        <p class="inline-hint mr-ex">
          观众发「<b>{{ s.cmdRequest }} 晴天</b>」或「<b>{{ s.cmdRequest }} 晴天 周杰伦</b>」点歌，写上歌手更准；
          「<b>{{ s.cmdSkip }}</b>」切掉正在放的；「<b>{{ s.cmdCancel }}</b>」撤掉自己点的、还没放的那首；「<b>{{ s.cmdMine }}</b>」看自己点的歌排第几、还要等多久。
        </p>
      </div>

      <div class="card">
        <div class="card-h"><h2>点歌规则</h2></div>
        <div class="srows">
          <div class="srow">
            <span class="lb">谁能点歌</span>
            <div class="ctl"><div class="line"><WhoPick :model-value="s.who" :people="people" title="谁能点歌" @change="(w) => set({ who: w }, '已保存谁能点歌')" /><span class="hint">主播自己不受这些限制</span></div></div>
          </div>
          <div class="srow">
            <span class="lb">每人最多排</span>
            <div class="ctl"><div class="line">
              <span class="stepper">
                <button type="button" aria-label="少一首" :disabled="s.perUser <= 1" @click="setNum('perUser', s.perUser - 1, 1, 10, (n) => `每人最多排 ${n} 首`)">−</button>
                <input :key="s.perUser" class="inp num" type="number" min="1" max="10" :value="s.perUser" aria-label="每人最多排几首" @change="(e) => setNum('perUser', Number((e.target as HTMLInputElement).value), 1, 10, (n) => `每人最多排 ${n} 首`)" />
                <button type="button" aria-label="多一首" :disabled="s.perUser >= 10" @click="setNum('perUser', s.perUser + 1, 1, 10, (n) => `每人最多排 ${n} 首`)">+</button>
              </span>
              <span class="hint">首（正在放的不算），放完了才能再点</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">点歌间隔</span>
            <div class="ctl"><div class="line">
              <select class="sel" aria-label="同一个人两次点歌至少隔多久" :value="s.userCdSec" @change="set({ userCdSec: Number(($event.target as HTMLSelectElement).value) }, '已保存点歌间隔')"><option v-for="v in CD_OPTIONS" :key="v" :value="v">{{ cdText(v) }}</option></select>
              <span class="hint">同一个人两次点歌至少隔多久</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">列表最多</span>
            <div class="ctl"><div class="line">
              <span class="stepper">
                <button type="button" aria-label="少一首" :disabled="s.queueMax <= 1" @click="setNum('queueMax', s.queueMax - 1, 1, 100, (n) => `列表最多 ${n} 首`)">−</button>
                <input :key="s.queueMax" class="inp num" type="number" min="1" max="100" :value="s.queueMax" aria-label="列表最多几首" @change="(e) => setNum('queueMax', Number((e.target as HTMLInputElement).value), 1, 100, (n) => `列表最多 ${n} 首`)" />
                <button type="button" aria-label="多一首" :disabled="s.queueMax >= 100" @click="setNum('queueMax', s.queueMax + 1, 1, 100, (n) => `列表最多 ${n} 首`)">+</button>
              </span>
              <span class="hint">首，满了观众就点不进来</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">歌最长</span>
            <div class="ctl"><div class="line">
              <select class="sel" aria-label="歌最长多久" :value="s.maxDurationSec" @change="set({ maxDurationSec: Number(($event.target as HTMLSelectElement).value) }, '已保存')"><option v-for="v in LEN_OPTIONS" :key="v" :value="v">{{ v / 60 }} 分钟</option></select>
              <span class="hint">更长的不收（后台加歌不受限制）</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">同一首歌</span>
            <div class="ctl"><div class="line">
              <select class="sel" aria-label="同一首歌放过之后多久才能再点" :value="s.repeatMin" @change="set({ repeatMin: Number(($event.target as HTMLSelectElement).value) }, '已保存')"><option v-for="v in REPEAT_OPTIONS" :key="v" :value="v">{{ repeatText(v) }}</option></select>
              <span class="hint">放过之后隔多久才能再点（防止同一首被反复点；主播不受限制）</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">大航海优先</span>
            <div class="ctl"><div class="line"><Switch :model-value="s.guardFirst" label="大航海优先" @change="(v) => set({ guardFirst: v }, v ? '舰长、提督、总督点的歌排在普通观众前面' : '按点歌先后排')" /><span class="hint">舰长、提督、总督点的歌排在普通观众前面</span></div></div>
          </div>
          <div class="srow">
            <span class="lb">谁能切歌</span>
            <div class="ctl"><div class="line">
              <Switch :model-value="s.skipByRequester" label="点歌的人能切歌" @change="(v) => set({ skipByRequester: v })" /><span>点这首歌的人</span>
              <span class="gap" />
              <Switch :model-value="s.skipByMod" label="房管能切歌" @change="(v) => set({ skipByMod: v })" /><span>房管</span>
              <span class="hint">主播一直能切</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">下播自动暂停</span>
            <div class="ctl"><div class="line"><Switch :model-value="s.autoPause" label="下播自动暂停" @change="(v) => set({ autoPause: v }, v ? '没开播时不放歌，开播后接着放' : '没开播也照常放歌')" /><span class="hint">{{ s.autoPause ? '没开播时不放，列表留着，开播后接着放' : '没开播也照常放' }}</span></div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="mr-col">
      <div class="card">
        <div class="card-h"><h2>歌从哪里找</h2></div>
        <div class="srows">
          <div class="srow">
            <span class="lb">网易云音乐</span>
            <div class="ctl">
              <div class="line"><Switch :model-value="s.sourceNetease" label="从网易云找歌" @change="(v) => set({ sourceNetease: v })" /><span class="hint">{{ s.sourceNetease ? '搜得到的免费歌都能放' : '不从网易云找' }}</span></div>
              <div v-if="s.sourceNetease" class="mr-acct">
                <template v-if="acct?.loggedIn">
                  <Avatar :name="acct.name || '网易云'" :face="acct.avatar" :size="34" />
                  <span class="mr-ai">
                    <b>{{ acct.name || '网易云账号' }}<span v-if="acct.vip && !acct.invalid" class="mr-vip">会员</span></b>
                    <span :class="{ bad: acct.invalid }">{{ acct.invalid ? '登录失效了，请重新扫码' : acct.vip ? '会员歌也能完整播放' : '不是会员：会员歌放不了' }}</span>
                  </span>
                  <span class="mr-aa">
                    <button class="btn sm" @click="qr = true"><Icon name="i-qr" />{{ acct.invalid ? '重新扫码' : '换个账号' }}</button>
                    <ConfirmButton label="退出" confirm-label="确认退出？" cls="btn sm" @confirm="logout" />
                  </span>
                </template>
                <template v-else>
                  <span class="mr-ai"><b>没有登录</b><span>免费歌照常放；登录网易云会员后，会员歌也能放</span></span>
                  <span class="mr-aa"><button class="btn sm primary" @click="qr = true"><Icon name="i-qr" />扫码登录</button></span>
                </template>
              </div>
            </div>
          </div>
          <div class="srow">
            <span class="lb">本地歌库</span>
            <div class="ctl"><div class="line">
              <Switch :model-value="s.sourceLocal" label="从本地歌库找歌" @change="(v) => set({ sourceLocal: v })" />
              <span class="hint">现在有 {{ music.libraryCount }} 首</span>
              <a class="linkish" href="#music/library" @click.prevent="go('music', 'library')">管理歌库 →</a>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">先找哪里</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="先找哪里">
                <button :aria-pressed="s.localFirst" :disabled="!s.sourceLocal || !s.sourceNetease" @click="set({ localFirst: true }, '先在本地歌库里找，没有再找网易云')">先找本地歌库</button>
                <button :aria-pressed="!s.localFirst" :disabled="!s.sourceLocal || !s.sourceNetease" @click="set({ localFirst: false }, '先在网易云找，没有再找本地歌库')">先找网易云</button>
              </span>
            </div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>不收的歌</h2><span class="aside">歌名或歌手里有这些字的不收</span></div>
        <div class="mr-add"><input v-model="wordIn" class="inp" maxlength="30" placeholder="例如 DJ、伴奏、某个歌名，回车添加" aria-label="不收的字" @keydown.enter="addWord" /><button class="btn" @click="addWord">添加</button></div>
        <div class="mr-chips">
          <span v-for="w in s.blockWords" :key="w" class="mr-chip">{{ w }}<button type="button" :aria-label="`去掉 ${w}`" @click="set({ blockWords: s.blockWords.filter((x) => x !== w) }, `「${w}」去掉了`)"><Icon name="i-x" /></button></span>
          <span v-if="!s.blockWords.length" class="inline-hint">还没有。</span>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>不让点歌的观众</h2><span class="aside">{{ s.bannedUids.length }} 人</span></div>
        <div class="mr-add"><input v-model="uidIn" class="inp num" placeholder="输入 UID，回车添加" inputmode="numeric" aria-label="不让点歌的观众 UID" @keydown.enter="addBan" /><button class="btn" @click="addBan">添加</button></div>
        <div class="mr-people">
          <div v-for="uid in s.bannedUids" :key="uid" class="mr-person">
            <Avatar :name="person(uid).name || String(uid)" :face="person(uid).face" :size="24" />
            <span class="pn">{{ person(uid).name || '（昵称未知）' }}</span><span class="uid num">{{ uid }}</span>
            <button type="button" class="icon-btn" :aria-label="`让 ${person(uid).name || uid} 能点歌`" @click="set({ bannedUids: s.bannedUids.filter((x) => x !== uid) }, '已移出')"><Icon name="i-x" /></button>
          </div>
          <span v-if="!s.bannedUids.length" class="inline-hint">还没有。</span>
        </div>
      </div>
    </div>
    <NeteaseQr v-if="qr" @close="qr = false" />
  </div>
</template>

<style scoped>
.mr-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.mr-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1100px) { .mr-grid { grid-template-columns: 1fr; } }
.mr-cmds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1300px) { .mr-cmds { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mr-ex { margin: 12px 0 0; line-height: 1.7; }
.mr-ex b { color: var(--t1); font-weight: 600; }
.srow .line .gap { width: 12px; }
.srow .line > span:not(.seg):not(.hint):not(.gap):not(.stepper) { font-size: 13px; color: var(--t2); }
.mr-acct { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--hover); }
.mr-ai { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12.5px; color: var(--t2); }
.mr-ai b { display: flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--t1); font-weight: 600; }
.mr-ai .bad { color: #D64545; }
.mr-vip { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #E5484D; color: #fff; font-weight: 600; }
.mr-aa { display: flex; gap: 6px; margin-left: auto; flex: none; }
.mr-aa .btn.sm, .mr-aa :deep(.btn.sm) { height: 28px; padding: 0 10px; font-size: 12.5px; }
.mr-add { display: flex; gap: 8px; }
.mr-add .inp { flex: 1; min-width: 0; }
.mr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.mr-chip { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 4px 0 10px; border-radius: 8px; background: var(--hover); font-size: 13px; }
.mr-chip button { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 6px; background: transparent; color: var(--t3); }
.mr-chip button:hover { background: var(--press); color: var(--t1); }
.mr-chip svg { width: 12px; height: 12px; }
.mr-people { display: flex; flex-direction: column; margin-top: 10px; }
.mr-person { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
.mr-person + .mr-person { border-top: 1px solid var(--line); }
.mr-person .uid { color: var(--t3); font-size: 12px; }
.mr-person .icon-btn { margin-left: auto; }
</style>
