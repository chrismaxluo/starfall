<script setup lang="ts">
// 送礼名单：先选「名单放什么」（自动：本场收到的 / 手动：我挑的记录），一行大白话写出画面上现在会显示什么；
// 右边是预览和外观（滚动、对齐、字号、条数）；选了手动时左边接着出现送礼记录（按场次）和名单里的记录。
// 开关、复制地址也在这里，不用跳到「直播软件输出」页
import { computed, onMounted, ref, watch } from 'vue';
import { GIFTS_MAX_LIMIT, GIFTS_WIDTH, giftListShows, giftsHeight } from '@starfall/shared/overlay';
import type { GiftListItem, GiftsFilter } from '@starfall/shared/overlay';
import Avatar from '../components/Avatar.vue';
import GiftsFilterPick from '../components/GiftsFilterPick.vue';
import GiftsPreview from '../components/GiftsPreview.vue';
import Icon from '../components/Icon.vue';
import Switch from '../components/Switch.vue';
import { del, get, post, put } from '../lib/api.ts';
import { clock, dateTime } from '../lib/format.ts';
import { battery } from '../lib/preview.ts';
import { overlayConfigOf, refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto } from '../lib/types.ts';

// ---------- 输出（只有一个输出时不显示切换） ----------
const selId = ref<number | null>(null);
const o = computed(() => state.outputs.find((x) => x.id === selId.value) ?? state.outputs[0]);
const cfg = computed(() => (o.value ? overlayConfigOf(o.value) : null));
const online = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && x.role === 'gifts').length);
const pv = ref<InstanceType<typeof GiftsPreview> | null>(null);
const wh = computed(() => (o.value ? `${GIFTS_WIDTH} × ${giftsHeight(o.value.giftsMax, o.value.giftsSize)}` : ''));

async function save(patch: Partial<OutputDto>, msg?: string): Promise<void> {
  const target = o.value;
  if (!target) return;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${target.id}`, patch), msg);
  if (r) Object.assign(target, r);
  else await refreshOutputs();
}
async function copyUrl(): Promise<void> {
  if (!o.value) return;
  try {
    await navigator.clipboard.writeText(`${location.origin}${o.value.giftsPath}`);
    toast(`已复制送礼名单地址：在直播软件里加一个浏览器源，宽高填 ${wh.value}`);
  } catch {
    toast('浏览器不允许自动复制，请到「直播软件输出」页手动复制', 'info');
  }
}

// ---------- 名单放什么 ----------
const f = computed(() => o.value!.giftsFilter);
const manual = computed(() => f.value.mode === 'pinned');
const setFilter = (patch: Partial<GiftsFilter>, msg: string) => void save({ giftsFilter: { ...f.value, ...patch } }, msg);
function pickAuto(): void {
  if (!manual.value) return;
  // 回到自动：选过礼物种类就接着用，没选过就是全部礼物
  setFilter({ mode: f.value.gifts.length ? 'only' : 'all' }, '名单改为自动显示本场收到的');
}
function pickManual(): void {
  if (!manual.value) setFilter({ mode: 'pinned' }, '名单改为只显示你挑的记录');
}

/** 画面上现在会显示什么（大白话）；bad 为会显示空名单 */
const summary = computed<{ text: string; bad: boolean }>(() => {
  const x = o.value!;
  if (!x.giftsEnabled) return { text: '送礼名单关着，直播画面上不显示。打开右上角的开关。', bad: true };
  if (manual.value) return pins.value.length ? { text: `你挑的 ${pins.value.length} 条记录，按下面「名单里的记录」的顺序`, bad: false } : { text: '名单是空的：在下面的送礼记录里点「加入名单」', bad: true };
  const parts: string[] = [];
  if (f.value.mode === 'all') parts.push('所有付费礼物');
  else if (f.value.gifts.length) parts.push(f.value.gifts.map((g) => `「${g.name}」`).join('、'));
  if (f.value.guard) parts.push('上舰');
  if (f.value.sc) parts.push('醒目留言');
  if (!parts.length) return { text: f.value.mode === 'only' ? '什么都不会显示：还没选礼物，上舰、醒目留言也关着' : '什么都不会显示', bad: true };
  const n = state.gifts.filter((it) => giftListShows(f.value, it)).length;
  const pre = f.value.mode === 'only' && !f.value.gifts.length ? '（还没选礼物）只有' : '';
  return { text: `本场的${pre}${parts.join('、')}，现在有 ${n} 条`, bad: false };
});

// ---------- 外观 ----------
function setMax(v: number): void {
  if (!o.value) return;
  const n = Math.round(v);
  if (!(n >= 1 && n <= GIFTS_MAX_LIMIT)) return toast(`条数要在 1 – ${GIFTS_MAX_LIMIT} 之间`, 'err');
  if (n !== o.value.giftsMax) void save({ giftsMax: n }, `一屏显示 ${n} 条；浏览器源的高度建议改成 ${giftsHeight(n, o.value.giftsSize)}`);
}
const SPEED: Array<{ value: OutputDto['giftsSpeed']; label: string; msg: string }> = [
  { value: 'off', label: '不滚动', msg: '不滚动：名单固定挂着，放不下时只留最新的几条' },
  { value: 'slow', label: '慢', msg: '滚动速度：慢（约 5 秒一条）' },
  { value: 'normal', label: '中', msg: '滚动速度：中（约 3 秒一条）' },
  { value: 'fast', label: '快', msg: '滚动速度：快（约 2 秒一条）' },
];

// ---------- 送礼记录（按场次，手动时用） ----------
type Rec = GiftListItem & { eventId: number };
interface Sess {
  id: number;
  startedAt: number;
  endedAt: number | null;
  gifts: number;
}
const sessions = ref<Sess[]>([]);
const current = ref<number | null>(null);
const sessId = ref<number | null>(null);
const records = ref<Rec[]>([]);
const loading = ref(false);
const q = ref('');
const sessLabel = (s: Sess) => `${s.id === current.value ? '本场（直播中）' : dateTime(s.startedAt)}${s.endedAt ? ` – ${clock(s.endedAt)}` : ''} · ${s.gifts} 条`;

async function loadSessions(): Promise<void> {
  const r = await attempt(() => get<{ current: number | null; sessions: Sess[] }>('/api/gift-list/sessions'));
  if (!r) return;
  sessions.value = r.sessions;
  current.value = r.current;
  if (sessId.value === null || !r.sessions.some((s) => s.id === sessId.value)) sessId.value = r.current ?? r.sessions[0]?.id ?? null;
}
async function loadRecords(): Promise<void> {
  if (sessId.value === null) return void (records.value = []);
  loading.value = true;
  const r = await attempt(() => get<{ items: Rec[] }>(`/api/gift-list/records?session=${sessId.value}`));
  loading.value = false;
  records.value = r?.items ?? [];
}
watch(sessId, () => void loadRecords());
onMounted(async () => {
  await Promise.all([loadSessions(), loadPins()]);
});
const shown = computed(() => (q.value ? records.value.filter((r) => r.viewer.name.includes(q.value) || (r.gift?.name ?? '').includes(q.value) || (r.sc?.text ?? '').includes(q.value)) : records.value));

// ---------- 名单里的记录 ----------
interface Pin {
  id: number;
  eventId: number;
  item: GiftListItem;
}
const pins = ref<Pin[]>([]);
const pinMax = ref(50);
const inList = computed(() => new Map(pins.value.map((p) => [p.eventId, p.id])));
async function loadPins(): Promise<void> {
  const r = await attempt(() => get<{ pins: Pin[]; max: number }>('/api/gift-list/pins'));
  if (r) {
    pins.value = r.pins;
    pinMax.value = r.max;
  }
}
// 别处（另一个后台窗口、事件记录页）加入或移出时跟着刷新
watch(() => state.giftPins, () => void loadPins(), { deep: true });

const GUARD = { 1: '总督', 2: '提督', 3: '舰长' } as const;
/** 一条记录写成一句话 */
function what(it: GiftListItem): string {
  if (it.kind === 'guard' && it.guard) return `${it.guard.op === 'renew' ? '续费' : '开通'}${GUARD[it.guard.level]} ×${it.guard.months}个月`;
  if (it.kind === 'sc' && it.sc) return `醒目留言 ${Math.round(it.sc.price)} 元：${it.sc.text}`;
  return `送出 ${it.gift?.name ?? ''} ×${it.gift?.count ?? 1}`;
}

async function add(r: Rec): Promise<void> {
  const res = await attempt(() => post<{ pins: Pin[] }>('/api/gift-list/pins', { eventId: r.eventId }), `已加入名单：${r.viewer.name} ${what(r)}`);
  if (res) pins.value = res.pins;
}
async function remove(id: number, name: string): Promise<void> {
  const res = await attempt(() => del<{ pins: Pin[] }>(`/api/gift-list/pins/${id}`), `已移出名单：${name}`);
  if (res) pins.value = res.pins;
}
async function move(i: number, d: -1 | 1): Promise<void> {
  const ids = pins.value.map((p) => p.id);
  const j = i + d;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  const res = await attempt(() => put<{ pins: Pin[] }>('/api/gift-list/pins/order', { ids }));
  if (res) pins.value = res.pins;
}
</script>

<template>
  <section v-if="o && cfg" class="page">
    <div class="page-head">
      <div><h1>送礼名单</h1><p>把收到的礼物、上舰、醒目留言排成一列显示在直播画面上。</p></div>
      <div class="gl-head-r">
        <select v-if="state.outputs.length > 1" v-model="selId" class="sel" aria-label="输出"><option v-for="x in state.outputs" :key="x.id" :value="x.id">{{ x.name }}</option></select>
        <span class="live" :class="o.giftsEnabled && online ? '' : 'off'"><i />{{ !o.giftsEnabled ? '已关闭' : online ? '直播软件里已加上' : '直播软件里还没加' }}</span>
        <button class="btn" :title="`在直播软件里加一个浏览器源，宽高填 ${wh}`" @click="copyUrl"><Icon name="i-copy" />复制地址</button>
        <Switch :model-value="o.giftsEnabled" label="送礼名单开关" @change="(v) => save({ giftsEnabled: v }, v ? '已打开送礼名单' : '已关闭送礼名单：直播画面上不再显示')" />
      </div>
    </div>

    <div class="gl-grid">
      <div class="gl-col">
        <!-- 名单放什么 -->
        <div class="card">
          <div class="card-h"><h2>名单放什么</h2><span class="aside">改了马上生效</span></div>
          <div class="gl-modes" role="radiogroup" aria-label="名单放什么">
            <button type="button" class="gl-mode" role="radio" :aria-checked="!manual" @click="pickAuto">
              <b><Icon name="i-bolt" />自动：本场收到的</b>
              <span>直播时收到的礼物自动加进来，下次开播清空</span>
            </button>
            <button type="button" class="gl-mode" role="radio" :aria-checked="manual" @click="pickManual">
              <b><Icon name="i-pin" />手动：我挑的记录</b>
              <span>从本场或以前的送礼记录里挑几条，一直挂着，直到你移出</span>
            </button>
          </div>

          <div v-if="!manual" class="srows">
            <div class="srow">
              <span class="lb">哪些礼物</span>
              <div class="ctl">
                <div class="line">
                  <span class="seg" role="group" aria-label="哪些礼物">
                    <button :aria-pressed="f.mode === 'all'" @click="setFilter({ mode: 'all' }, '名单显示本场所有付费礼物')">全部礼物</button>
                    <button :aria-pressed="f.mode === 'only'" @click="setFilter({ mode: 'only' }, '名单只显示选中的几种礼物')">只要这几种</button>
                  </span>
                  <span class="hint">{{ f.mode === 'all' ? '所有付费礼物都显示（免费礼物不显示）' : '只显示下面选中的礼物，谁送的都算' }}</span>
                </div>
                <GiftsFilterPick v-if="f.mode === 'only'" :model-value="f.gifts" @change="(gifts, msg) => setFilter({ gifts }, msg)" />
              </div>
            </div>
            <div class="srow">
              <span class="lb">也显示</span>
              <div class="ctl"><div class="line">
                <Switch :model-value="f.guard" label="也显示上舰" @change="(v) => setFilter({ guard: v }, v ? '名单也显示上舰' : '名单不再显示上舰')" /><span>上舰（开通、续费大航海）</span>
                <span class="gap" />
                <Switch :model-value="f.sc" label="也显示醒目留言" @change="(v) => setFilter({ sc: v }, v ? '名单也显示醒目留言' : '名单不再显示醒目留言')" /><span>醒目留言</span>
              </div></div>
            </div>
          </div>

          <div class="gl-sum" :class="{ bad: summary.bad }"><Icon :name="summary.bad ? 'i-info' : 'i-check'" /><span><b>现在画面上显示：</b>{{ summary.text }}</span></div>
        </div>
        <template v-if="manual">
        <div class="card">
          <div class="card-h"><h2>送礼记录</h2><span class="aside">点「加入名单」</span></div>
          <div class="gl-tools">
            <select v-model="sessId" class="sel" aria-label="场次"><option v-for="s in sessions" :key="s.id" :value="s.id">{{ sessLabel(s) }}</option></select>
            <input v-model.trim="q" class="inp" placeholder="搜观众或礼物" aria-label="搜观众或礼物" />
          </div>
          <div v-if="!sessions.length" class="inline-hint">还没有直播记录。开播后收到的礼物会出现在这里。</div>
          <div v-else-if="loading && !records.length" class="inline-hint">读取中…</div>
          <div v-else-if="!shown.length" class="inline-hint">{{ q ? '没有符合的记录' : '这一场没有收到付费礼物、上舰或醒目留言' }}</div>
          <div v-else class="gl-recs">
            <div v-for="r in shown" :key="r.eventId" class="gl-rec" :class="{ on: inList.has(r.eventId) }">
              <span class="t num">{{ clock(r.ts) }}</span>
              <Avatar :name="r.viewer.name" :face="r.viewer.face" :guard="r.viewer.guard" :size="30" />
              <span class="who"><b>{{ r.viewer.name }}</b><span>{{ what(r) }}</span></span>
              <img v-if="r.gift?.img" class="gimg" :src="r.gift.img" alt="" referrerpolicy="no-referrer" /><span v-else class="gimg" />
              <span class="v num">{{ battery(r.value) }}</span>
              <button v-if="inList.has(r.eventId)" class="btn sm on" type="button" title="已在名单里，点一下移出" @click="remove(inList.get(r.eventId)!, r.viewer.name)"><Icon name="i-check" />在名单里</button>
              <button v-else class="btn sm" type="button" :disabled="pins.length >= pinMax" @click="add(r)"><Icon name="i-plus" />加入名单</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>名单里的记录 {{ pins.length }} 条</h2><span class="aside">最多 {{ pinMax }} 条 · 一直保留到移出</span></div>
          <div v-if="!pins.length" class="inline-hint">还没有。在左边的送礼记录里点「加入名单」，或者在「事件记录」里点一条礼物的「⋯」→「加入送礼名单」。</div>
          <div v-else class="gl-recs">
            <div v-for="(p, i) in pins" :key="p.id" class="gl-rec pin">
              <span class="t num">{{ dateTime(p.item.ts) }}</span>
              <Avatar :name="p.item.viewer.name" :face="p.item.viewer.face" :guard="p.item.viewer.guard" :size="30" />
              <span class="who"><b>{{ p.item.viewer.name }}</b><span>{{ what(p.item) }}</span></span>
              <img v-if="p.item.gift?.img" class="gimg" :src="p.item.gift.img" alt="" referrerpolicy="no-referrer" /><span v-else class="gimg" />
              <span class="ord">
                <button class="icon-btn" type="button" aria-label="往上挪" :disabled="i === 0" @click="move(i, -1)"><Icon name="i-chev" style="transform: rotate(180deg)" /></button>
                <button class="icon-btn" type="button" aria-label="往下挪" :disabled="i === pins.length - 1" @click="move(i, 1)"><Icon name="i-chev" /></button>
              </span>
              <button class="btn sm" type="button" @click="remove(p.id, p.item.viewer.name)"><Icon name="i-x" />移出</button>
            </div>
          </div>
        </div>
        </template>
      </div>

      <!-- 预览和外观 -->
      <div class="card">
        <div class="card-h"><h2>预览</h2><span class="aside">只在这里显示</span></div>
        <div class="gl-pv"><GiftsPreview ref="pv" :key="`g${o.id}`" :config="cfg" /></div>
        <div class="prev-tools"><button class="btn" :disabled="!o.giftsEnabled || manual" :title="manual ? '手动时只显示名单里的记录' : ''" @click="pv?.test()"><i style="background: #FF9D00" />测试一条（只在这里显示）</button></div>
        <h3 class="gl-sub">外观</h3>
        <div class="srows">
          <div class="srow">
            <span class="lb">滚动</span>
            <div class="ctl">
              <span class="seg" role="group" aria-label="滚动">
                <button v-for="s in SPEED" :key="s.value" :aria-pressed="o.giftsSpeed === s.value" @click="save({ giftsSpeed: s.value }, s.msg)">{{ s.label }}</button>
              </span>
              <span class="hint">{{ o.giftsSpeed === 'off' ? '固定挂着，放不下时只留最新的几条' : '一屏放不下时从下往上循环滚动' }}</span>
            </div>
          </div>
          <div class="srow">
            <span class="lb">对齐</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="对齐">
                <button :aria-pressed="o.giftsSide === 'left'" @click="save({ giftsSide: 'left' })">靠左</button>
                <button :aria-pressed="o.giftsSide === 'right'" @click="save({ giftsSide: 'right' })">靠右</button>
              </span>
              <span class="hint">放在画面哪边就选哪边</span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">字号</span>
            <div class="ctl"><div class="line">
              <span class="seg" role="group" aria-label="字号">
                <button :aria-pressed="o.giftsSize === 'normal'" @click="save({ giftsSize: 'normal' })">标准</button>
                <button :aria-pressed="o.giftsSize === 'large'" @click="save({ giftsSize: 'large' })">大</button>
              </span>
            </div></div>
          </div>
          <div class="srow">
            <span class="lb">一屏几条</span>
            <div class="ctl"><div class="line">
              <span class="stepper">
                <button type="button" aria-label="少一条" :disabled="o.giftsMax <= 1" @click="setMax(o.giftsMax - 1)">−</button>
                <input :key="`${o.id}-${o.giftsMax}`" class="inp num" type="number" min="1" :max="GIFTS_MAX_LIMIT" :value="o.giftsMax" aria-label="一屏显示几条" @change="(e) => setMax(Number((e.target as HTMLInputElement).value))" />
                <button type="button" aria-label="多一条" :disabled="o.giftsMax >= GIFTS_MAX_LIMIT" @click="setMax(o.giftsMax + 1)">+</button>
              </span>
              <span class="hint">浏览器源宽高填 {{ wh }}</span>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gl-head-r { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
.gl-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.gl-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1100px) { .gl-grid { grid-template-columns: 1fr; } }

/* 名单放什么：两个大选项 */
.gl-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 6px; }
@media (max-width: 640px) { .gl-modes { grid-template-columns: 1fr; } }
.gl-mode { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 16px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--l2); color: var(--t1); font: inherit; text-align: left; cursor: pointer; }
.gl-mode:hover { border-color: var(--line-strong); }
.gl-mode[aria-checked='true'] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-ring); }
.gl-mode b { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.gl-mode b svg { width: 16px; height: 16px; color: var(--accent); }
.gl-mode span { font-size: 12.5px; color: var(--t2); line-height: 1.6; }
.srow .line .gap { width: 12px; }
.srow .line > span:not(.seg):not(.hint):not(.gap) { font-size: 13px; color: var(--t2); }

/* 现在画面上显示 */
.gl-sum { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--ok-soft, rgba(52, 199, 123, .1)); color: var(--t1); font-size: 13px; line-height: 1.6; }
.gl-sum svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: var(--ok, #34C77B); }
.gl-sum b { font-weight: 600; }
.gl-sum.bad { background: rgba(214, 69, 69, .1); }
.gl-sum.bad svg { color: #D64545; }

.gl-pv { display: grid; place-items: center; padding: 6px 0; }
.gl-sub { margin: 18px 0 2px; font-size: 13px; font-weight: 600; color: var(--t2); }
.gl-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.gl-tools .inp { width: 180px; height: 32px; }
.gl-tools .sel { height: 32px; min-width: 240px; max-width: 100%; }
.gl-recs { display: flex; flex-direction: column; max-height: 560px; overflow: auto; margin: 0 -6px; }
.gl-rec { display: grid; grid-template-columns: 62px 30px minmax(0, 1fr) 34px 96px 100px; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; font-size: 13px; }
.gl-rec + .gl-rec { border-top: 1px solid var(--line); }
.gl-rec:hover { background: var(--hover); }
.gl-rec.on { background: var(--accent-soft); }
.gl-rec .t { color: var(--t3); font-size: 12px; }
.gl-rec .who { display: flex; flex-direction: column; min-width: 0; }
.gl-rec .who b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-rec .who span { color: var(--t2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-rec .gimg { width: 32px; height: 32px; object-fit: contain; }
.gl-rec .v { color: var(--t2); font-size: 12px; text-align: right; white-space: nowrap; }
.gl-rec .ord { display: flex; gap: 2px; }
.gl-rec .btn.sm { height: 28px; padding: 0 10px; font-size: 12.5px; justify-content: center; }
.gl-rec .btn.on { color: var(--accent); }
.gl-recs .gl-rec.pin { grid-template-columns: 112px 30px minmax(0, 1fr) 34px 64px 72px; }
</style>
