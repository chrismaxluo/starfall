// 全局状态：登录后加载一次，之后由实时连接（/ws/admin）和各页面的修改保持最新
import { reactive } from 'vue';
import { get } from './api.ts';
import { setTimeZone } from './format.ts';
import type { PreviewRequest } from './preview.ts';
import type { ChatItem, GiftListItem } from '@starfall/shared/overlay';
import type { DanmuRuleDto, EffectDto, EnterBase, EventDto, ExclusiveDto, GiftRules, GuardRules, OutputDto, OverlayConfig, OverlayInfo, QueueSnapshot, QuickButton, RoomInfo, Settings, SoundDto, StatusSnapshot, Viewer } from './types.ts';

/** 实时动态在内存里留多少条（总览按类型筛选时从这里挑） */
export const FEED_KEEP = 150;

export const state = reactive({
  /** null：还没检查 */
  authed: null as boolean | null,
  /** 电脑版（服务只在本机运行，后台不用密码） */
  desktop: false,
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
  /** 素材快捷播放的按钮 */
  quick: [] as QuickButton[],
  overlays: [] as OverlayInfo[],
  /** 最近的几条弹幕（弹幕列表的预览用） */
  chat: [] as ChatItem[],
  /** 本场的送礼名单（送礼名单的预览用） */
  gifts: [] as GiftListItem[],
  /** 送礼名单挂上的记录（按顺序） */
  giftPins: [] as GiftListItem[],
  queue: { playing: null, items: [] } as QueueSnapshot,
  /** 实时动态（最新在前） */
  feed: [] as EventDto[],
  /** 实时连接是否在线 */
  wsOnline: false,
  /** 荣耀等级勋章：等级 → B站的图（读不到时是空的，界面上改成显示文字） */
  honorMedals: {} as Record<number, string>,
  /** 从别的页面跳到"添加专属用户"时预填的 UID */
  pendingExclusive: null as number | null,
});

export const effectById = (id: number | null | undefined) => (id ? state.effects.find((e) => e.id === id) : undefined);
export const output = () => state.outputs[0];
/** 加到直播软件里的特效页（不算弹幕列表，也不算「在浏览器里查看」打开的页面） */
export const isFxLive = (x: OverlayInfo) => x.role !== 'chat' && x.role !== 'gifts' && !x.view && !x.env?.view;
/** 「在浏览器里查看」打开的特效页 */
export const isFxView = (x: OverlayInfo) => x.role !== 'chat' && x.role !== 'gifts' && Boolean(x.view || x.env?.view);

/** 输出的设置换成特效页、弹幕列表收到的格式（预览用）；嵌套的设置复制一份（发给预览页时不能带响应式代理） */
export function overlayConfigOf(o: OutputDto): OverlayConfig {
  return { outputId: o.id, name: o.name, app: o.app, orient: o.orient, width: o.width, height: o.height, safeTop: o.safeTop, safeBottom: o.safeBottom, marginX: o.marginX, scale: o.scale, liteMode: o.liteMode, chatEnabled: o.chatEnabled, chatSide: o.chatSide, chatSize: o.chatSize, chatMedal: o.chatMedal, chatMax: o.chatMax, chatFadeSec: o.chatFadeSec, giftsEnabled: o.giftsEnabled, giftsSide: o.giftsSide, giftsSize: o.giftsSize, giftsMax: o.giftsMax, giftsSpeed: o.giftsSpeed, giftsFilter: JSON.parse(JSON.stringify(o.giftsFilter)) as OverlayConfig['giftsFilter'] };
}

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
export async function refreshQuick(): Promise<void> {
  state.quick = (await get<{ buttons: QuickButton[] }>('/api/quickplay/buttons')).buttons;
}
export async function refreshFeed(): Promise<void> {
  state.feed = (await get<{ events: EventDto[] }>(`/api/events?limit=${FEED_KEEP}`)).events;
}

/** 读不到不影响别的功能 */
export async function refreshHonorMedals(): Promise<void> {
  const r = await get<{ medals: Array<{ level: number; url: string }> }>('/api/honor-medals').catch(() => null);
  if (r) state.honorMedals = Object.fromEntries(r.medals.map((m) => [m.level, m.url]));
}

export async function loadAll(): Promise<void> {
  await Promise.all([refreshStatus(), refreshSettings(), refreshEffects(), refreshRules(), refreshOutputs(), refreshQuick(), refreshFeed(), refreshHonorMedals()]);
}

/** 全局弹窗：素材设置、快捷设置专属、新手引导、命令面板 */
export const ui = reactive({
  editorId: null as number | null,
  wizard: false,
  palette: false,
  /** 打开事件记录时先搜索这个（观众菜单「查看 TA 的记录」） */
  logQuery: null as string | null,
  /** 扫码登录 B站（侧边栏、登录失效提醒条） */
  qr: false,
  /** 预览小窗：点规则的 ▶、命令面板里的「预览某身份进场特效」 */
  preview: null as PreviewRequest | null,
  quick: null as { uid: number; name: string; face?: string | undefined; viewer?: Viewer } | null,
  /** 服务端有新版本的后台（和这个页面不一样），顶部提示刷新；dismissed：点了「稍后」的那个版本 */
  newVersion: null as string | null,
  dismissedVersion: null as string | null,
});
