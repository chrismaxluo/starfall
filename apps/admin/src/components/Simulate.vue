<script setup lang="ts">
// 模拟一次事件（F-RU-05）：看会命中哪条规则、播放哪个素材、为什么不播放；只判断，不入队、不记录。
// 没开播也能模拟；命中后在预览小窗里播放（只在本地）
import { computed, onMounted, ref, watch } from 'vue';
import { HONOR_LEVEL_MAX, MEDAL_LEVEL_MAX } from '@starfall/shared';
import { get, post } from '../lib/api.ts';
import { IDENTITY, SAMPLES } from '../lib/identity.ts';
import { effectById, state } from '../lib/store.ts';
import type { Identity, SampleViewer } from '../lib/identity.ts';
import { battery, yuan } from '../lib/preview.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { attempt } from '../lib/toast.ts';
import type { GiftConfig, SimulateResult, TriggerKind } from '../lib/types.ts';

const props = defineProps<{ kind: TriggerKind }>();
const emit = defineEmits<{ preview: [PreviewRequest] }>();
/** 谁：身份档（总督…普通观众）、主播本人，或者填 UID 指定某位观众（测专属用户、弹幕规则里的指定观众） */
type Who = Identity | 'anchor' | 'uid';
const who = ref({ identity: 'cap' as Who, medal: 0, own: true, honor: 0, uid: null as number | null, uidGuard: 0 as 0 | 1 | 2 | 3 });
const anchorUid = computed(() => state.status?.room?.anchorUid ?? 0);
const text = ref('生日快乐');
const giftPick = ref<number | ''>('');
const customBattery = ref(10);
const count = ref(10);
const guard = ref({ level: 3 as 1 | 2 | 3, op: 'open' as 'open' | 'renew', months: 1 });
const catalog = ref<GiftConfig[]>([]);
const res = ref<SimulateResult | null>(null);
watch(() => props.kind, () => ((res.value = null), (trace.value = [])));

const paidGifts = computed(() => catalog.value.filter((g) => g.paid));

async function run(): Promise<void> {
  const w = who.value;
  if (w.identity === 'uid' && !(w.uid && w.uid > 0)) return void (res.value = null, (trace.value = []), (uidMsg.value = '请填观众的 UID'));
  uidMsg.value = '';
  const uid = w.identity === 'anchor' ? anchorUid.value : w.identity === 'uid' ? w.uid! : 1;
  const guardLv = w.identity === 'gov' ? 1 : w.identity === 'adm' ? 2 : w.identity === 'cap' ? 3 : w.identity === 'uid' ? w.uidGuard : 0;
  const viewer = { uid, guard: guardLv, isMod: w.identity === 'mod', medal: w.medal > 0 ? { level: w.medal, own: w.own } : null, honor: Math.max(0, Math.min(HONOR_LEVEL_MAX, Math.round(w.honor) || 0)) };
  let body: object = { kind: 'enter', viewer };
  let vars: PreviewRequest['vars'] = {};
  if (props.kind === 'danmu') {
    body = { kind: 'danmu', viewer, text: text.value || ' ' };
    vars = { text: text.value || ' ' };
  }
  if (props.kind === 'gift') {
    const g = catalog.value.find((x) => x.id === Number(giftPick.value));
    const unitPrice = g ? g.price : Math.round(customBattery.value) * 100;
    body = g ? { kind: 'gift', viewer, giftId: g.id, giftName: g.name, unitPrice, count: count.value } : { kind: 'gift', viewer, giftName: '礼物', unitPrice, count: count.value };
    vars = { gift: g?.name ?? '礼物', count: count.value, valueGold: unitPrice * count.value };
  }
  if (props.kind === 'guard') {
    body = { kind: 'guard', viewer, ...guard.value };
    vars = { months: guard.value.months, guardLevel: guard.value.level, op: guard.value.op };
  }
  const r = (await attempt(() => post<SimulateResult>('/api/simulate', body))) ?? null;
  res.value = r;
  trace.value = props.kind === 'enter' ? enterTrace(uid, guardLv, viewer.isMod, w.medal > 0 && w.own ? w.medal : 0, viewer.honor ?? 0) : [];
  // 会播放的话，在右侧预览里播一次，看看实际效果
  if (r?.effect && r.status === 'played') {
    const guardLv = props.kind === 'guard' ? guard.value.level : (viewer.guard as SampleViewer['guard']);
    const name = w.identity === 'anchor' ? '主播' : w.identity === 'uid' ? (state.exclusives.find((x) => x.uid === uid)?.name ?? `UID ${uid}`) : SAMPLES[w.identity].name;
    const sample: SampleViewer = { name, guard: guardLv, isMod: viewer.isMod, medalLevel: w.medal > 0 ? w.medal : null, honor: viewer.honor };
    emit('preview', { effectId: r.effect.id, viewer: sample, label: `模拟：${r.rule ?? ''}`, kind: props.kind, vars });
  }
}
const uidMsg = ref('');
/** 进场按什么顺序找规则：一步步写出来（为什么用了这条、为什么跳过） */
const trace = ref<Array<{ text: string; hit?: boolean }>>([]);
function enterTrace(uid: number, guardLv: number, isMod: boolean, ownMedal: number, honor: number): Array<{ text: string; hit?: boolean }> {
  const out: Array<{ text: string; hit?: boolean }> = [];
  const r = state.enter;
  if (!r) return out;
  const ex = state.exclusives.find((x) => x.uid === uid);
  if (ex) {
    const expired = ex.until !== null && ex.until < new Date().toISOString().slice(0, 10);
    if (ex.enabled && !expired) return [{ text: `专属用户：${ex.name ?? uid} 有专属特效「${effectById(ex.effectId)?.name ?? '未选择'}」，用这条`, hit: true }];
    out.push({ text: `专属用户：${ex.name ?? uid} 的专属特效${expired ? '已过期' : '关着'}，跳过` });
  } else out.push({ text: '专属用户：没有，往下找' });
  const tier = guardLv === 1 ? 'gov' : guardLv === 2 ? 'adm' : guardLv === 3 ? 'cap' : isMod ? 'mod' : null;
  if (tier) {
    const t = r.tiers[tier];
    if (t.enabled) return [...out, { text: `${IDENTITY[tier].name}：用这条，播放「${effectById(t.effectId)?.name ?? '未选择'}」`, hit: true }];
    out.push({ text: `${IDENTITY[tier].name}：这条关着，跳过` });
  }
  if (ownMedal > 0) {
    const band = [...r.bands].sort((a, b) => b.fromLevel - a.fromLevel).find((b) => ownMedal >= b.fromLevel);
    if (band?.enabled) return [...out, { text: `粉丝牌 ${band.fromLevel} 级以上这一段：用这条，播放「${effectById(band.effectId)?.name ?? '未选择'}」`, hit: true }];
    out.push({ text: band ? `粉丝牌 ${band.fromLevel} 级以上这一段关着，往下找` : '粉丝牌等级不够任何一段，往下找' });
  }
  if (honor > 0) {
    const band = [...r.honorBands].sort((a, b) => b.fromLevel - a.fromLevel).find((b) => honor >= b.fromLevel);
    if (band?.enabled && band.effectId) return [...out, { text: `荣耀等级 ${band.fromLevel} 级以上这一段：用这条，播放「${effectById(band.effectId)?.name ?? '未选择'}」`, hit: true }];
    out.push({ text: band ? `荣耀等级 ${band.fromLevel} 级以上这一段${band.enabled ? '还没选特效' : '关着'}，按其他观众处理` : `荣耀等级 ${honor} 级不够任何一段，按其他观众处理` });
  }
  const n = r.tiers.nor;
  out.push(n.enabled ? { text: `其他观众：用这条，播放「${effectById(n.effectId)?.name ?? '未选择'}」`, hit: true } : { text: '其他观众：这条关着（默认关着，直播间人多时免得刷屏），所以不播' });
  return out;
}

onMounted(async () => {
  catalog.value = (await get<{ gifts: GiftConfig[] }>('/api/gifts').catch(() => ({ gifts: [] }))).gifts;
});
</script>

<template>
  <div class="sim">
    <div id="simBox">
      <template v-if="kind === 'danmu'">
        <input v-model="text" class="inp" placeholder="弹幕内容" aria-label="弹幕内容" maxlength="100" />
      </template>
      <template v-if="kind === 'gift'">
        <div class="row">
          <select v-model="giftPick" class="sel" aria-label="礼物">
            <option value="">自定义单价</option>
            <option v-for="g in paidGifts" :key="g.id" :value="g.id">{{ g.name }}（{{ battery(g.price) }} · {{ yuan(g.price) }}）</option>
          </select>
          <div v-if="giftPick === ''" class="suffix"><input v-model.number="customBattery" class="inp num" type="number" min="0" step="1" aria-label="单价（电池）" /><span>电池（{{ yuan(Math.round(Number(customBattery) || 0) * 100) }}）</span></div>
        </div>
        <div class="suffix"><input v-model.number="count" class="inp num" type="number" min="1" aria-label="数量" /><span>个</span></div>
      </template>
      <template v-if="kind === 'guard'">
        <div class="row">
          <select v-model.number="guard.level" class="sel" aria-label="大航海"><option :value="3">舰长</option><option :value="2">提督</option><option :value="1">总督</option></select>
          <select v-model="guard.op" class="sel" aria-label="开通或续费"><option value="open">开通</option><option value="renew">续费</option></select>
        </div>
        <div class="suffix"><input v-model.number="guard.months" class="inp num" type="number" min="1" max="120" aria-label="月数" /><span>个月</span></div>
      </template>
      <template v-if="kind !== 'guard'">
        <div class="row">
          <select v-model="who.identity" class="sel" aria-label="身份">
            <option value="gov">总督</option><option value="adm">提督</option><option value="cap">舰长</option><option value="mod">房管</option><option value="nor">普通观众</option>
            <option value="anchor" :disabled="!anchorUid">主播本人</option><option value="uid">某位观众（填 UID）</option>
          </select>
          <div class="suffix"><input v-model.number="who.medal" class="inp num" type="number" min="0" :max="MEDAL_LEVEL_MAX" aria-label="粉丝牌等级" /><span>级牌子</span></div>
        </div>
        <div v-if="who.identity === 'uid'" class="row">
          <input v-model.number="who.uid" class="inp num" type="number" min="1" placeholder="观众的 UID" aria-label="观众的 UID" list="simExUids" />
          <select v-model.number="who.uidGuard" class="sel" aria-label="这位观众的大航海身份"><option :value="0">不是大航海</option><option :value="3">舰长</option><option :value="2">提督</option><option :value="1">总督</option></select>
          <datalist id="simExUids"><option v-for="x in state.exclusives" :key="x.uid" :value="x.uid">{{ x.name ?? '' }}（专属用户）</option></datalist>
        </div>
        <span v-if="who.identity === 'uid'" class="inline-hint" style="font-size: 12px">可以直接选专属用户，测 TA 的专属特效；也能测弹幕规则里填了 UID 的「指定观众」{{ uidMsg ? `　${uidMsg}` : '' }}</span>
        <label class="toggle-line" style="font-size: 12.5px"><input v-model="who.own" type="checkbox" style="accent-color: var(--accent)" />牌子是本直播间的（0 级表示没戴牌子）</label>
        <div class="suffix"><input v-model.number="who.honor" class="inp num" type="number" min="0" :max="HONOR_LEVEL_MAX" aria-label="荣耀等级" /><span>级荣耀等级（0 表示没有）</span></div>
      </template>
      <button class="btn primary" style="justify-content: center" @click="run">{{ { enter: '模拟进场', danmu: '模拟弹幕', gift: '模拟送礼', guard: '模拟上舰' }[kind] }}</button>
    </div>
    <div class="simres">
      <template v-if="res">
        <ol v-if="trace.length" class="simtrace">
          <li v-for="(t, ti) in trace" :key="ti" :class="{ hit: t.hit }">{{ t.text }}</li>
        </ol>
        <template v-if="res.rule">会用 <b>{{ res.rule }}</b> 这条规则，播放 <b>{{ res.effect?.name }}</b><br /></template>
        <span v-else class="miss">没有符合的规则，不会播放{{ kind === 'gift' ? '（免费礼物、低于最低一段，或落在已关闭的一段）' : kind === 'danmu' ? '（没有规则包含这句弹幕，或者发的人不符合「谁发的才算」）' : '' }}<br /></span>
        <template v-if="res.rule">{{ res.status === 'played' ? '会播放，已经在预览小窗里放给你看了' : `不会播放：${res.statusText}` }}</template>
        <span v-for="n in res.notes" :key="n" class="simnote"><br />提示：{{ n }}</span>
      </template>
    </div>
  </div>
</template>
