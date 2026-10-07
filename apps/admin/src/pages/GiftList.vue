<script setup lang="ts">
// 送礼名单：显示设置（显示哪些、滚动、对齐、字号、条数）、实时预览，以及挑记录挂上（本场或以前场次的，谁送的哪一次）。
// 地址和开关在「直播软件输出」页
import { computed, onMounted, ref, watch } from 'vue';
import { GIFTS_MAX_LIMIT, giftsHeight } from '@starfall/shared/overlay';
import type { GiftListItem, GiftsFilter } from '@starfall/shared/overlay';
import Avatar from '../components/Avatar.vue';
import GiftsFilterPick from '../components/GiftsFilterPick.vue';
import GiftsPreview from '../components/GiftsPreview.vue';
import Icon from '../components/Icon.vue';
import { del, get, post, put } from '../lib/api.ts';
import { clock, dateTime } from '../lib/format.ts';
import { battery } from '../lib/preview.ts';
import { go } from '../lib/route.ts';
import { overlayConfigOf, refreshOutputs, state } from '../lib/store.ts';
import { attempt, toast } from '../lib/toast.ts';
import type { OutputDto } from '../lib/types.ts';

// ---------- 设置（按输出；只有一个输出时不显示切换） ----------
const selId = ref<number | null>(null);
const o = computed(() => state.outputs.find((x) => x.id === selId.value) ?? state.outputs[0]);
const cfg = computed(() => (o.value ? overlayConfigOf(o.value) : null));
const online = computed(() => state.overlays.filter((x) => x.outputId === o.value?.id && x.role === 'gifts').length);
const pv = ref<InstanceType<typeof GiftsPreview> | null>(null);

async function save(patch: Partial<OutputDto>, msg?: string): Promise<void> {
  const target = o.value;
  if (!target) return;
  const r = await attempt(() => put<OutputDto>(`/api/outputs/${target.id}`, patch), msg);
  if (r) Object.assign(target, r);
  else await refreshOutputs();
}
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

// ---------- 送礼记录（按场次） ----------
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

// ---------- 挂上的记录 ----------
interface Pin {
  id: number;
  eventId: number;
  item: GiftListItem;
}
const pins = ref<Pin[]>([]);
const pinMax = ref(50);
const pinned = computed(() => new Map(pins.value.map((p) => [p.eventId, p.id])));
async function loadPins(): Promise<void> {
  const r = await attempt(() => get<{ pins: Pin[]; max: number }>('/api/gift-list/pins'));
  if (r) {
    pins.value = r.pins;
    pinMax.value = r.max;
  }
}
// 别处（另一个后台窗口、事件记录页）挂上或撤下时跟着刷新
watch(() => state.giftPins, () => void loadPins(), { deep: true });

const GUARD = { 1: '总督', 2: '提督', 3: '舰长' } as const;
/** 一条记录写成一句话 */
function what(it: GiftListItem): string {
  if (it.kind === 'guard' && it.guard) return `${it.guard.op === 'renew' ? '续费' : '开通'}${GUARD[it.guard.level]} ×${it.guard.months}个月`;
  if (it.kind === 'sc' && it.sc) return `醒目留言 ${Math.round(it.sc.price)} 元：${it.sc.text}`;
  return `送出 ${it.gift?.name ?? ''} ×${it.gift?.count ?? 1}`;
}

async function pin(r: Rec): Promise<void> {
  const res = await attempt(() => post<{ pins: Pin[] }>('/api/gift-list/pins', { eventId: r.eventId }), `已挂上：${r.viewer.name} ${what(r)}`);
  if (res) pins.value = res.pins;
  if (res && cfg.value?.giftsFilter.mode !== 'pinned') toast('现在的显示方式不是「只显示挂上的记录」，要在上面切换后才会显示挂上的', 'info');
}
async function unpin(id: number, name: string): Promise<void> {
  const res = await attempt(() => del<{ pins: Pin[] }>(`/api/gift-list/pins/${id}`), `已撤下：${name}`);
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
const setFilter = (f: GiftsFilter, msg: string) => void save({ giftsFilter: f }, msg);
</script>

<template>
  <section v-if="o && cfg" class="page">
    <div class="page-head">
      <div><h1>送礼名单</h1><p>把收到的礼物、上舰、醒目留言显示在直播画面上；也可以挑几条记录一直挂着。</p></div>
      <div class="gl-head-r">
        <select v-if="state.outputs.length > 1" v-model="selId" class="sel" aria-label="输出"><option v-for="x in state.outputs" :key="x.id" :value="x.id">{{ x.name }}</option></select>
        <span class="live" :class="o.giftsEnabled && online ? '' : 'off'"><i />{{ !o.giftsEnabled ? '已关闭' : online ? '直播软件里已加上' : '直播软件里还没加' }}</span>
        <button class="btn" @click="go('obs')"><Icon name="i-screen" />复制地址、开关</button>
      </div>
    </div>

    <div class="gl-grid">
      <div class="gl-col">
        <div class="card" :class="{ dimmed: !o.giftsEnabled }">
          <div class="card-h"><h2>显示设置</h2><span class="aside">{{ o.giftsEnabled ? '改了马上生效' : '送礼名单已关闭（在「直播软件输出」页打开）' }}</span></div>
          <div class="srows">
            <div class="srow">
              <span class="lb">显示哪些</span>
              <div class="ctl"><GiftsFilterPick :model-value="o.giftsFilter" @change="setFilter" /></div>
            </div>
            <div class="srow">
              <span class="lb">滚动</span>
              <div class="ctl">
                <div class="line">
                  <span class="seg" role="group" aria-label="滚动">
                    <button v-for="s in SPEED" :key="s.value" :aria-pressed="o.giftsSpeed === s.value" @click="save({ giftsSpeed: s.value }, s.msg)">{{ s.label }}</button>
                  </span>
                </div>
                <span class="hint">{{ o.giftsSpeed === 'off' ? '固定挂着，放不下时只留最新的几条，新来的从下面加进来' : '一屏放不下时从下往上循环滚动：慢约 5 秒一条，中约 3 秒，快约 2 秒' }}</span>
              </div>
            </div>
            <div class="srow">
              <span class="lb">对齐</span>
              <div class="ctl"><div class="line">
                <span class="seg" role="group" aria-label="对齐">
                  <button :aria-pressed="o.giftsSide === 'left'" @click="save({ giftsSide: 'left' })">靠左</button>
                  <button :aria-pressed="o.giftsSide === 'right'" @click="save({ giftsSide: 'right' })">靠右</button>
                </span>
                <span class="hint">放在画面左边选靠左，右边选靠右</span>
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
              <span class="lb">条数</span>
              <div class="ctl"><div class="line">
                <span class="stepper">
                  <button type="button" aria-label="少一条" :disabled="o.giftsMax <= 1" @click="setMax(o.giftsMax - 1)">−</button>
                  <input :key="`${o.id}-${o.giftsMax}`" class="inp num" type="number" min="1" :max="GIFTS_MAX_LIMIT" :value="o.giftsMax" aria-label="一屏显示几条" @change="(e) => setMax(Number((e.target as HTMLInputElement).value))" />
                  <button type="button" aria-label="多一条" :disabled="o.giftsMax >= GIFTS_MAX_LIMIT" @click="setMax(o.giftsMax + 1)">+</button>
                </span>
                <span class="hint">一屏显示几条；浏览器源宽高填 640 × {{ giftsHeight(o.giftsMax, o.giftsSize) }}</span>
              </div></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-h"><h2>送礼记录</h2><span class="aside">点「挂上」，设成「只显示挂上的记录」时就会显示</span></div>
          <div class="gl-tools">
            <select v-model="sessId" class="sel" aria-label="场次"><option v-for="s in sessions" :key="s.id" :value="s.id">{{ sessLabel(s) }}</option></select>
            <input v-model.trim="q" class="inp" placeholder="搜观众或礼物" aria-label="搜观众或礼物" />
          </div>
          <div v-if="!sessions.length" class="inline-hint">还没有直播记录。开播后收到的礼物会出现在这里。</div>
          <div v-else-if="loading && !records.length" class="inline-hint">读取中…</div>
          <div v-else-if="!shown.length" class="inline-hint">{{ q ? '没有符合的记录' : '这一场没有收到付费礼物、上舰或醒目留言' }}</div>
          <div v-else class="gl-recs">
            <div v-for="r in shown" :key="r.eventId" class="gl-rec" :class="{ on: pinned.has(r.eventId) }">
              <span class="t num">{{ clock(r.ts) }}</span>
              <Avatar :name="r.viewer.name" :face="r.viewer.face" :guard="r.viewer.guard" :size="30" />
              <span class="who"><b>{{ r.viewer.name }}</b><span>{{ what(r) }}</span></span>
              <img v-if="r.gift?.img" class="gimg" :src="r.gift.img" alt="" referrerpolicy="no-referrer" /><span v-else class="gimg" />
              <span class="v num">{{ battery(r.value) }}</span>
              <button v-if="pinned.has(r.eventId)" class="btn sm on" type="button" :title="'已挂上，点一下撤下'" @click="unpin(pinned.get(r.eventId)!, r.viewer.name)"><Icon name="i-check" />已挂上</button>
              <button v-else class="btn sm" type="button" :disabled="pins.length >= pinMax" @click="pin(r)"><Icon name="i-plus" />挂上</button>
            </div>
          </div>
        </div>
      </div>

      <div class="gl-col">
        <div class="card">
          <div class="card-h"><h2>预览</h2><span class="aside">只在这里显示</span></div>
          <div class="gl-pv"><GiftsPreview ref="pv" :key="`g${o.id}`" :config="cfg" /></div>
          <div class="prev-tools"><button class="btn" :disabled="!o.giftsEnabled || cfg.giftsFilter.mode === 'pinned'" @click="pv?.test()"><i style="background: #FF9D00" />测试（只在这里显示）</button></div>
        </div>
        <div class="card">
          <div class="card-h"><h2>已挂上 {{ pins.length }} 条</h2><span class="aside">最多 {{ pinMax }} 条，一直保留到撤下</span></div>
          <div v-if="cfg.giftsFilter.mode !== 'pinned' && pins.length" class="gl-warn"><Icon name="i-info" />现在显示的是「{{ cfg.giftsFilter.mode === 'all' ? '所有付费礼物' : '只显示选中的礼物' }}」，挂上的不会显示。<button class="linkish" @click="setFilter({ ...cfg.giftsFilter, mode: 'pinned' }, '送礼名单只显示挂上的记录')">改成只显示挂上的</button></div>
          <div v-if="!pins.length" class="inline-hint">还没有挂上的记录。在左边的送礼记录里点「挂上」，或者在事件记录里点一条礼物的「⋯」→「挂到送礼名单」。</div>
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
              <button class="btn sm" type="button" @click="unpin(p.id, p.item.viewer.name)"><Icon name="i-x" />撤下</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gl-head-r { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
.gl-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1100px) { .gl-grid { grid-template-columns: 1fr; } }
.gl-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.gl-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.gl-tools .inp { width: 180px; height: 32px; }
.gl-tools .sel { height: 32px; min-width: 240px; max-width: 100%; }
.gl-pv { display: grid; place-items: center; padding: 6px 0; }
.gl-recs { display: flex; flex-direction: column; max-height: 560px; overflow: auto; margin: 0 -6px; }
.gl-rec { display: grid; grid-template-columns: 62px 30px minmax(0, 1fr) 34px 96px 86px; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; font-size: 13px; }
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
.gl-rec .btn.sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
.gl-rec .btn.on { color: var(--accent); }
.gl-recs .gl-rec.pin { grid-template-columns: 112px 30px minmax(0, 1fr) 34px 64px 76px; }
.gl-rec .btn.sm { justify-content: center; }
.gl-warn { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; padding: 8px 10px; border-radius: 8px; background: var(--l3); font-size: 12.5px; color: var(--t2); }
.gl-warn svg { width: 14px; height: 14px; }
</style>
