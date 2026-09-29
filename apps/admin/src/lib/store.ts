// 全局状态：登录后加载一次，之后由实时连接（/ws/admin）和各页面的修改保持最新
import { reactive } from 'vue';
import { get } from './api.ts';
import { setTimeZone } from './format.ts';
import type { PreviewRequest } from './preview.ts';
import type { DanmuRuleDto, EffectDto, EnterBase, EventDto, ExclusiveDto, GiftRules, GuardRules, OutputDto, OverlayInfo, QueueSnapshot, RoomInfo, Settings, SoundDto, StatusSnapshot, Viewer } from './types.ts';

export const state = reactive({
  /** null：还没检查 */
  authed: null as boolean | null,
  status: null as StatusSnapshot | null,
  /** 直播间信息：标题、分区、封面、主播、直播时的实时数字 */
  roomInfo: null as RoomInfo | null,
  settings: null as Settings | null,
  effects: [] as EffectDto[],
  sounds: [] as SoundDto[],
  enter: null as EnterBase | null,
  exclusives: [] as ExclusiveDto[],
  danmu: [] as DanmuRuleDto[],
  gift: null as GiftRules | null,
  guard: null as GuardRules | null,
  outputs: [] as OutputDto[],
  overlays: [] as OverlayInfo[],
  queue: { playing: null, items: [] } as QueueSnapshot,
  /** 实时动态（最新在前） */
  feed: [] as EventDto[],
  /** 实时连接是否在线 */
  wsOnline: false,
  /** 从别的页面跳到"添加专属用户"时预填的 UID */
  pendingExclusive: null as number | null,
});

export const effectById = (id: number | null | undefined) => (id ? state.effects.find((e) => e.id === id) : undefined);
export const output = () => state.outputs[0];

export async function refreshStatus(): Promise<void> {
  state.status = await get<StatusSnapshot>('/api/status');
  setTimeZone(state.status.timeZone);
}
export async function refreshSettings(): Promise<void> {
  state.settings = await get<Settings>('/api/settings');
}
export async function refreshEffects(): Promise<void> {
  const [e, s] = await Promise.all([get<{ effects: EffectDto[] }>('/api/effects'), get<{ sounds: SoundDto[] }>('/api/sounds')]);
  state.effects = e.effects;
  state.sounds = s.sounds;
}
export async function refreshRules(): Promise<void> {
  const [r, x, d, g, u] = await Promise.all([
    get<EnterBase>('/api/rules/enter'),
    get<{ exclusives: ExclusiveDto[] }>('/api/rules/exclusive'),
    get<{ rules: DanmuRuleDto[] }>('/api/rules/danmu'),
    get<GiftRules>('/api/rules/gift'),
    get<GuardRules>('/api/rules/guard'),
  ]);
  state.enter = r;
  state.exclusives = x.exclusives;
  state.danmu = d.rules;
  state.gift = g;
  state.guard = u;
}
export async function refreshOutputs(): Promise<void> {
  state.outputs = (await get<{ outputs: OutputDto[] }>('/api/outputs')).outputs;
}
export async function refreshFeed(): Promise<void> {
  state.feed = (await get<{ events: EventDto[] }>('/api/events?limit=30')).events;
}

export async function loadAll(): Promise<void> {
  await Promise.all([refreshStatus(), refreshSettings(), refreshEffects(), refreshRules(), refreshOutputs(), refreshFeed()]);
}

/** 全局弹窗：素材设置、快捷设置专属、新手引导、命令面板 */
export const ui = reactive({
  editorId: null as number | null,
  wizard: false,
  palette: false,
  /** 预览小窗：点规则的 ▶、命令面板里的「预览某身份进场特效」 */
  preview: null as PreviewRequest | null,
  quick: null as { uid: number; name: string; face?: string | undefined; viewer?: Viewer } | null,
  /** 服务端有新版本的后台（和这个页面不一样），顶部提示刷新；dismissed：点了「稍后」的那个版本 */
  newVersion: null as string | null,
  dismissedVersion: null as string | null,
});
