<script setup lang="ts">
// 模拟一次事件（F-RU-05）：看会命中哪条规则、播放哪个素材、为什么不播放；只判断，不入队、不记录。
// 没开播也能模拟；命中后在预览小窗里播放（只在本地）
import { computed, onMounted, ref, watch } from 'vue';
import { get, post } from '../lib/api.ts';
import { SAMPLES } from '../lib/identity.ts';
import type { Identity, SampleViewer } from '../lib/identity.ts';
import { yuan } from '../lib/preview.ts';
import type { PreviewRequest } from '../lib/preview.ts';
import { attempt } from '../lib/toast.ts';
import type { GiftConfig, SimulateResult, TriggerKind } from '../lib/types.ts';

const props = defineProps<{ kind: TriggerKind }>();
const emit = defineEmits<{ preview: [PreviewRequest] }>();
const who = ref({ identity: 'cap' as Identity, medal: 0, own: true });
const text = ref('生日快乐');
const giftPick = ref<number | ''>('');
const customYuan = ref(1);
const count = ref(10);
const guard = ref({ level: 3 as 1 | 2 | 3, op: 'open' as 'open' | 'renew', months: 1 });
const catalog = ref<GiftConfig[]>([]);
const res = ref<SimulateResult | null>(null);
watch(() => props.kind, () => (res.value = null));

const paidGifts = computed(() => catalog.value.filter((g) => g.paid));

async function run(): Promise<void> {
  const w = who.value;
  const viewer = { guard: w.identity === 'gov' ? 1 : w.identity === 'adm' ? 2 : w.identity === 'cap' ? 3 : 0, isMod: w.identity === 'mod', medal: w.medal > 0 ? { level: w.medal, own: w.own } : null };
  let body: object = { kind: 'enter', viewer };
  let vars: PreviewRequest['vars'] = {};
  if (props.kind === 'danmu') {
    body = { kind: 'danmu', viewer, text: text.value || ' ' };
    vars = { text: text.value || ' ' };
  }
  if (props.kind === 'gift') {
    const g = catalog.value.find((x) => x.id === Number(giftPick.value));
    const unitPrice = g ? g.price : Math.round(customYuan.value * 1000);
    body = g ? { kind: 'gift', viewer, giftId: g.id, giftName: g.name, unitPrice, count: count.value } : { kind: 'gift', viewer, giftName: '礼物', unitPrice, count: count.value };
    vars = { gift: g?.name ?? '礼物', count: count.value, valueGold: unitPrice * count.value };
  }
  if (props.kind === 'guard') {
    body = { kind: 'guard', viewer, ...guard.value };
    vars = { months: guard.value.months, guardLevel: guard.value.level, op: guard.value.op };
  }
  const r = (await attempt(() => post<SimulateResult>('/api/simulate', body))) ?? null;
  res.value = r;
  // 会播放的话，在右侧预览里播一次，看看实际效果
  if (r?.effect && r.status === 'played') {
    const guardLv = props.kind === 'guard' ? guard.value.level : (viewer.guard as SampleViewer['guard']);
    const sample: SampleViewer = { name: SAMPLES[w.identity].name, guard: guardLv, isMod: viewer.isMod, medalLevel: w.medal > 0 ? w.medal : null };
    emit('preview', { effectId: r.effect.id, viewer: sample, label: `模拟：${r.rule ?? ''}`, kind: props.kind, vars });
  }
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
            <option v-for="g in paidGifts" :key="g.id" :value="g.id">{{ g.name }}（{{ yuan(g.price) }}）</option>
          </select>
          <div v-if="giftPick === ''" class="suffix"><input v-model.number="customYuan" class="inp num" type="number" min="0" step="0.1" aria-label="单价" /><span>元</span></div>
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
          </select>
          <div class="suffix"><input v-model.number="who.medal" class="inp num" type="number" min="0" max="60" aria-label="粉丝牌等级" /><span>级牌子</span></div>
        </div>
        <label class="toggle-line" style="font-size: 12.5px"><input v-model="who.own" type="checkbox" style="accent-color: var(--accent)" />牌子是本直播间的（0 级表示没戴牌子）</label>
      </template>
      <button class="btn primary" style="justify-content: center" @click="run">{{ { enter: '模拟进场', danmu: '模拟弹幕', gift: '模拟送礼', guard: '模拟上舰' }[kind] }}</button>
    </div>
    <div class="simres">
      <template v-if="res">
        <template v-if="res.rule">会用 <b>{{ res.rule }}</b> 这条规则，播放 <b>{{ res.effect?.name }}</b><br /></template>
        <span v-else class="miss">没有符合的规则{{ kind === 'gift' ? '（免费礼物、低于最低一档，或落在已关闭的一段）' : '' }}<br /></span>
        {{ res.status === 'played' ? '会播放，已经在预览小窗里放给你看了' : `不会播放：${res.statusText}` }}
        <span v-for="n in res.notes" :key="n" class="simnote"><br />提示：{{ n }}</span>
      </template>
    </div>
  </div>
</template>
