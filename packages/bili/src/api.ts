// B 站 HTTP 接口。能不登录就不登录（auth: false），减少账号的使用（需求 F-BL-10）。
import type { BiliHttp, Cookies } from './http.ts';
import { BiliApiError } from './http.ts';
import type { WbiSigner } from './wbi.ts';

const LIVE = 'https://api.live.bilibili.com';

export interface RoomInit {
  roomId: number;
  shortId: number;
  anchorUid: number;
  /** 0 未开播，1 直播中，2 轮播 */
  liveStatus: number;
  isPortrait: boolean;
  /** 这一场的开播时间（毫秒）；未开播时为 null */
  liveSince?: number | null;
}

/** 房间号（短号或长号）换算，并取开播状态。公开接口 */
export async function getRoomInit(http: BiliHttp, id: number): Promise<RoomInit> {
  const d = await http.getData<{ room_id: number; short_id: number; uid: number; live_status: number; is_portrait?: boolean; live_time?: number }>(
    `${LIVE}/room/v1/Room/room_init?id=${id}`,
    { auth: false },
  );
  // live_time 是开播时间（秒）；未开播时是负数
  const since = typeof d.live_time === 'number' && d.live_time > 0 ? d.live_time * 1000 : null;
  return { roomId: d.room_id, shortId: d.short_id, anchorUid: d.uid, liveStatus: d.live_status, isPortrait: Boolean(d.is_portrait), liveSince: since };
}

export interface RoomInfo {
  roomId: number;
  anchorUid: number;
  title: string;
  liveStatus: number;
  /** 开播时间，形如 "2026-09-25 13:00:00"；未开播为 "0000-00-00 00:00:00" */
  liveTime: string;
  /** 开播时间（毫秒）；未开播时为 null */
  liveSince: number | null;
  isPortrait: boolean;
  /** 分区：大分区、小分区 */
  parentAreaName: string;
  areaName: string;
  /** 封面；没有设置封面时为空 */
  cover: string;
  /** 直播画面截图（直播中才有） */
  keyframe: string;
  /** 粉丝数 */
  followers: number;
}

/** B 站接口里的时间都是北京时间 */
export function parseBeijingTime(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m || m[1] === '0000') return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 8, +m[5]!, +m[6]!);
}

export async function getRoomInfo(http: BiliHttp, roomId: number): Promise<RoomInfo> {
  const d = await http.getData<{
    room_id: number;
    uid: number;
    title: string;
    live_status: number;
    live_time: string;
    is_portrait?: boolean;
    area_name?: string;
    parent_area_name?: string;
    user_cover?: string;
    keyframe?: string;
    attention?: number;
  }>(`${LIVE}/room/v1/Room/get_info?room_id=${roomId}`, { auth: false });
  return {
    roomId: d.room_id,
    anchorUid: d.uid,
    title: d.title,
    liveStatus: d.live_status,
    liveTime: d.live_time,
    liveSince: d.live_status === 1 ? parseBeijingTime(d.live_time) : null,
    isPortrait: Boolean(d.is_portrait),
    parentAreaName: d.parent_area_name ?? '',
    areaName: d.area_name ?? '',
    cover: d.user_cover ?? '',
    keyframe: d.keyframe ?? '',
    followers: d.attention ?? 0,
  };
}

export interface AnchorInfo {
  uid: number;
  name: string;
  face: string;
  followers: number;
}

/** 主播信息（昵称、头像、粉丝数）。公开接口 */
export async function getAnchorInfo(http: BiliHttp, uid: number): Promise<AnchorInfo> {
  const d = await http.getData<{ info: { uid: number; uname: string; face: string }; follower_num?: number }>(`${LIVE}/live_user/v1/Master/info?uid=${uid}`, { auth: false });
  return { uid: d.info.uid, name: d.info.uname, face: d.info.face, followers: d.follower_num ?? 0 };
}

export interface RoomAdmin {
  uid: number;
  name: string;
  face: string;
}

/** 房管名单（公开接口，分页取完） */
export async function getRoomAdmins(http: BiliHttp, roomId: number): Promise<RoomAdmin[]> {
  const out: RoomAdmin[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await http.getData<{ data?: Array<{ uid: number; uname: string; face: string }> | null; page?: { total_page?: number } }>(
      `${LIVE}/xlive/web-room/v1/roomAdmin/get_by_room?roomid=${roomId}&page_size=100&page=${page}`,
      { auth: false },
    );
    for (const a of d.data ?? []) out.push({ uid: a.uid, name: a.uname, face: a.face });
    if (!d.data || d.data.length < 100 || page >= (d.page?.total_page ?? 1)) break;
  }
  return out;
}

export interface GiftConfig {
  id: number;
  name: string;
  /** 单价，单位：金瓜子 */
  price: number;
  paid: boolean;
  icon: string;
  gif?: string;
  /** 会动的礼物图（比 gif 清楚、有透明） */
  webp?: string;
  /** B站全屏动画的编号（大礼物才有），用 getGiftEffects 查动画文件 */
  effectId?: number;
  /** 在直播间礼物面板上的哪一页（礼物、粉丝团、航海……）；不在面板上显示的礼物没有 */
  tab?: string;
  /** 在这一页里的位置（从 1 开始） */
  panel?: number;
}

type RawGift = { id: number; name: string; price: number; coin_type: string; img_basic: string; gif?: string; webp?: string; effect_id?: number };
const toGift = (g: RawGift): GiftConfig => ({
  id: g.id,
  name: g.name,
  price: g.price,
  paid: g.coin_type === 'gold',
  icon: g.img_basic,
  ...(g.gif ? { gif: g.gif } : {}),
  ...(g.webp ? { webp: g.webp } : {}),
  ...(g.effect_id ? { effectId: g.effect_id } : {}),
});

/**
 * 本直播间礼物面板（每种礼物一个版本，用于"指定礼物"的选择）。
 * base_config 是本直播间可送的礼物，room_config 是本直播间特有的（发红包、舰长一号等）；
 * gift_data.room_gift_list.gold_list 是面板「礼物」页实际显示的礼物和顺序，
 * gift_data.tab_list 是其余几页（粉丝团、航海等）；同一个礼物出现在多页时记第一页
 */
export async function getRoomGifts(http: BiliHttp, roomId: number): Promise<GiftConfig[]> {
  type PanelItem = { gift_id?: number };
  const d = await http.getData<{
    gift_config?: { base_config?: { list?: RawGift[] }; room_config?: RawGift[] };
    gift_data?: { room_gift_list?: { gold_list?: PanelItem[] }; tab_list?: Array<{ tab_name?: string; position?: number; list?: PanelItem[] }> };
  }>(
    `${LIVE}/xlive/web-room/v1/giftPanel/roomGiftList?platform=pc&room_id=${roomId}&area_parent_id=0&area_id=0`,
    { auth: false },
  );
  const byId = new Map<number, GiftConfig>();
  for (const g of [...(d.gift_config?.base_config?.list ?? []), ...(d.gift_config?.room_config ?? [])]) if (g?.id && !byId.has(g.id)) byId.set(g.id, toGift(g));
  const tabs = [
    { name: '礼物', list: d.gift_data?.room_gift_list?.gold_list },
    ...[...(d.gift_data?.tab_list ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((t) => ({ name: t.tab_name || '其他', list: t.list })),
  ];
  for (const t of tabs) {
    (t.list ?? []).forEach((p, i) => {
      const g = p?.gift_id ? byId.get(p.gift_id) : undefined;
      if (g && g.tab === undefined) Object.assign(g, { tab: t.name, panel: i + 1 });
    });
  }
  return [...byId.values()];
}

/** 全站礼物（约 900 个，同名礼物有多个版本）：本直播间面板里查不到的礼物从这里找图 */
export async function getAllGifts(http: BiliHttp): Promise<GiftConfig[]> {
  const d = await http.getData<{ list?: RawGift[] }>(`${LIVE}/xlive/web-room/v1/giftPanel/giftConfig?platform=pc`, { auth: false });
  return (d.list ?? []).filter((g) => g?.id).map(toGift);
}

/** B站礼物全屏动画：一个 MP4 里左边是画面、右边是透明度，配一个 JSON 说明两块各在哪 */
export interface GiftEffectFile {
  mp4: string;
  json: string;
}

/** 全部礼物全屏动画（公开接口，约 2500 个）：动画编号 → 文件 */
export async function getGiftEffects(http: BiliHttp): Promise<Map<number, GiftEffectFile>> {
  const d = await http.getData<{ full_sc_resource?: { conf_list?: Array<{ id?: number; web_mp4?: string; web_mp4_json?: string }> } }>(
    `${LIVE}/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2?platform=pc`,
    { auth: false },
  );
  const out = new Map<number, GiftEffectFile>();
  for (const c of d.full_sc_resource?.conf_list ?? []) if (c?.id && c.web_mp4 && c.web_mp4_json) out.set(c.id, { mp4: c.web_mp4, json: c.web_mp4_json });
  return out;
}

/** 动画的排布：输出多大、视频多大、画面和透明度各在视频的哪一块（x, y, 宽, 高）、一共多长 */
export interface GiftEffectLayout {
  w: number;
  h: number;
  videoW: number;
  videoH: number;
  rgb: [number, number, number, number];
  alpha: [number, number, number, number];
  durationMs: number;
}

/** 读一个动画的 JSON；格式不对时抛错 */
export async function getGiftEffectLayout(http: BiliHttp, url: string): Promise<GiftEffectLayout> {
  const res = await http.request(url, { auth: false });
  if (!res.ok) throw new BiliApiError(-1, `读取动画说明失败（HTTP ${res.status}）`);
  return parseGiftEffectLayout(await res.json());
}

export function parseGiftEffectLayout(j: unknown): GiftEffectLayout {
  const i = (j as { info?: Record<string, unknown> } | null)?.info ?? {};
  const num = (k: string) => (typeof i[k] === 'number' && Number.isFinite(i[k]) ? (i[k] as number) : NaN);
  const rect = (k: string) => {
    const r = i[k];
    return Array.isArray(r) && r.length === 4 && r.every((x) => typeof x === 'number' && x >= 0) ? (r as [number, number, number, number]) : null;
  };
  const rgb = rect('rgbFrame');
  const alpha = rect('aFrame');
  const [w, h, videoW, videoH, f, fps] = [num('w'), num('h'), num('videoW'), num('videoH'), num('f'), num('fps')];
  if (!rgb || !alpha || !(w > 0 && h > 0 && videoW > 0 && videoH > 0 && f > 0 && fps > 0)) throw new BiliApiError(-1, '动画说明的格式不认识');
  return { w, h, videoW, videoH, rgb, alpha, durationMs: Math.round((f / fps) * 1000) };
}

/** 荣耀等级勋章：每级一张图（数字画在图上），animated 为动图 */
export interface HonorMedal {
  level: number;
  url: string;
  animated: boolean;
}

/** 荣耀等级勋章列表（直播间网页自己用的公开接口，不用登录；B 站里这个等级叫 wealth） */
export async function getHonorMedals(http: BiliHttp): Promise<HonorMedal[]> {
  const d = await http.getData<{ content?: string }>(`${LIVE}/xlive/general-interface/v1/content/get?key=wealth`, { auth: false });
  let c: { wealth_level_medal?: Array<{ id?: number; url?: string; animated?: number }> };
  try {
    c = JSON.parse(d.content ?? '{}');
  } catch {
    throw new BiliApiError(-1, '荣耀等级勋章列表格式不对');
  }
  return (c.wealth_level_medal ?? [])
    .filter((m) => Number.isInteger(m?.id) && (m.id ?? 0) > 0 && /^https:\/\/[\w.-]+\.hdslb\.com\//.test(m.url ?? ''))
    .map((m) => ({ level: m.id!, url: m.url!, animated: m.animated === 1 }));
}

/** 名单里的一位观众（高能榜、大航海榜共用） */
export interface ListViewer {
  uid: number;
  name: string;
  face: string;
  /** 在这个直播间的大航海等级（0 不是） */
  guard: 0 | 1 | 2 | 3;
  /** 荣耀等级（0 不知道） */
  honor: number;
  medal?: { name: string; level: number; anchorUid: number; colors?: { bg: string; level: string; border: string; text: string } };
  mystery: boolean;
}

interface RawUinfo {
  uid?: number;
  base?: { name?: string; face?: string; is_mystery?: boolean };
  medal?: { name?: string; level?: number; ruid?: number; is_light?: number; v2_medal_color_start?: string; v2_medal_color_border?: string; v2_medal_color_text?: string; v2_medal_color_level?: string } | null;
  wealth?: { level?: number } | null;
  guard?: { level?: number } | null;
}

const guardOf = (n: unknown): ListViewer['guard'] => (n === 1 || n === 2 || n === 3 ? n : 0);

function listViewer(u: RawUinfo | undefined, extra: { uid?: number; name?: string; face?: string; guard?: number; honor?: number; mystery?: boolean } = {}): ListViewer {
  const m = u?.medal;
  const colors = m?.v2_medal_color_start && m.v2_medal_color_border && m.v2_medal_color_text && m.v2_medal_color_level
    ? { bg: m.v2_medal_color_start, level: m.v2_medal_color_level, border: m.v2_medal_color_border, text: m.v2_medal_color_text }
    : undefined;
  return {
    uid: Number(u?.uid ?? extra.uid) || 0,
    name: u?.base?.name || extra.name || '',
    face: u?.base?.face || extra.face || '',
    guard: guardOf(u?.guard?.level ?? extra.guard),
    honor: Number(u?.wealth?.level ?? extra.honor) || 0,
    ...(m?.name && m.level ? { medal: { name: m.name, level: m.level, anchorUid: Number(m.ruid) || 0, ...(colors ? { colors } : {}) } } : {}),
    mystery: Boolean(u?.base?.is_mystery ?? extra.mystery),
  };
}

export interface OnlineRank {
  /** 在线人数（高能榜人数） */
  count: number;
  items: Array<ListViewer & { rank: number; score: number }>;
}

/**
 * 在线观众（直播间里「在线观众」那个名单）：count 是在线人数；名单按贡献排，没贡献的也在（贡献值 0）。
 * B 站只给前 100 位，翻页没用（每一页都是前 100）；登录不登录一样，所以不用登录。隐身之类的少数观众不在名单里
 */
export async function getOnlineRank(http: BiliHttp, roomId: number, anchorUid: number): Promise<OnlineRank> {
  const d = await http.getData<{ count?: number; item?: Array<{ rank?: number; uid?: number; name?: string; face?: string; score?: number; guard_level?: number; wealth_level?: number; is_mystery?: boolean; uinfo?: RawUinfo }> | null }>(
    `${LIVE}/xlive/general-interface/v1/rank/queryContributionRank?ruid=${anchorUid}&room_id=${roomId}&page=1&page_size=100&type=online_rank&switch=contribution_rank`,
    { auth: false, referer: `https://live.bilibili.com/${roomId}` },
  );
  return {
    count: Number(d.count) || 0,
    items: (d.item ?? []).map((x) => ({
      ...listViewer(x.uinfo, { uid: x.uid, name: x.name, face: x.face, guard: x.guard_level, honor: x.wealth_level, mystery: x.is_mystery }),
      rank: Number(x.rank) || 0,
      score: Number(x.score) || 0,
    })).filter((x) => x.uid > 0),
  };
}

export interface GuardPage {
  /** 大航海总人数 */
  total: number;
  /** 一共几页 */
  pages: number;
  items: ListViewer[];
}

/** 大航海榜（舰队名单），一页最多 30 人；第 1 页另外带前 3 名。公开接口 */
export async function getGuardPage(http: BiliHttp, roomId: number, anchorUid: number, page: number): Promise<GuardPage> {
  type Item = { uinfo?: RawUinfo };
  const d = await http.getData<{ info?: { num?: number; page?: number }; list?: Item[] | null; top3?: Item[] | null }>(
    `${LIVE}/xlive/app-room/v2/guardTab/topListNew?roomid=${roomId}&page=${page}&ruid=${anchorUid}&page_size=30&typ=5`,
    { auth: false, referer: `https://live.bilibili.com/${roomId}` },
  );
  const items = [...(page === 1 ? (d.top3 ?? []) : []), ...(d.list ?? [])].map((x) => listViewer(x.uinfo)).filter((x) => x.uid > 0);
  return { total: Number(d.info?.num) || 0, pages: Number(d.info?.page) || 0, items };
}

export interface UserCard {
  uid: number;
  name: string;
  face: string;
}

/** 按 UID 查昵称和头像（添加专属用户、黑名单时使用） */
export async function getUserCard(http: BiliHttp, uid: number): Promise<UserCard> {
  const d = await http.getData<{ card: { mid: string; name: string; face: string } }>(`https://api.bilibili.com/x/web-interface/card?mid=${uid}`, {
    referer: 'https://www.bilibili.com/',
  });
  return { uid: Number(d.card.mid), name: d.card.name, face: d.card.face };
}

export interface DanmuInfo {
  token: string;
  hosts: Array<{ host: string; wssPort: number }>;
}

/** 弹幕服务器地址和连接令牌（需要 WBI 签名；带登录 Cookie 才能收到完整的昵称和 UID） */
export async function getDanmuInfo(http: BiliHttp, wbi: WbiSigner, roomId: number): Promise<DanmuInfo> {
  const q = await wbi.sign({ id: roomId, type: 0, web_location: '444.8' });
  const d = await http.getData<{ token: string; host_list: Array<{ host: string; wss_port: number }> }>(`${LIVE}/xlive/web-room/v1/index/getDanmuInfo?${q}`);
  if (!d.host_list?.length) throw new BiliApiError(-1, '没有可用的弹幕服务器');
  return { token: d.token, hosts: d.host_list.map((h) => ({ host: h.host, wssPort: h.wss_port })) };
}

/** 直播间的点赞总数、看过人数（需要登录 + 签名；弹幕连接里只有有人点赞时才推送，所以直播时定时查一次） */
export async function getLiveCounts(http: BiliHttp, wbi: WbiSigner, roomId: number): Promise<{ likes: number | null; watched: number | null }> {
  const q = await wbi.sign({ room_id: roomId, web_location: '444.8' });
  const d = await http.getData<{ like_info_v3?: { total_likes?: number }; watched_show?: { num?: number } }>(`${LIVE}/xlive/web-room/v1/index/getInfoByRoom?${q}`);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return { likes: n(d.like_info_v3?.total_likes), watched: n(d.watched_show?.num) };
}

// ---------- 扫码登录 ----------

export interface QrCode {
  url: string;
  key: string;
}

export async function createLoginQrCode(http: BiliHttp): Promise<QrCode> {
  const d = await http.getData<{ url: string; qrcode_key: string }>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
    auth: false,
    referer: 'https://www.bilibili.com/',
  });
  return { url: d.url, key: d.qrcode_key };
}

export type QrState =
  | { state: 'waiting' }
  | { state: 'scanned' }
  | { state: 'expired' }
  | { state: 'success'; cookies: Cookies; refreshToken: string; expiresAt: number | null };

const QR_CODE = { 86101: 'waiting', 86090: 'scanned', 86038: 'expired', 0: 'success' } as const;

export async function pollLoginQrCode(http: BiliHttp, key: string): Promise<QrState> {
  const res = await http.request(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`, {
    auth: false,
    referer: 'https://www.bilibili.com/',
  });
  const json = (await res.json()) as { code: number; message?: string; data?: { code: number; refresh_token?: string } };
  if (json.code !== 0 || !json.data) throw new BiliApiError(json.code, json.message || '查询扫码状态失败');
  const state = QR_CODE[json.data.code as keyof typeof QR_CODE];
  if (!state) throw new BiliApiError(json.data.code, '未知的扫码状态');
  if (state !== 'success') return { state };

  const cookies: Cookies = {};
  let expiresAt: number | null = null;
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair?.indexOf('=') ?? -1;
    if (!pair || i <= 0) continue;
    const k = pair.slice(0, i).trim();
    cookies[k] = pair.slice(i + 1).trim();
    if (k === 'SESSDATA') {
      const exp = /Expires=([^;]+)/i.exec(line)?.[1];
      if (exp) expiresAt = Date.parse(exp) || null;
    }
  }
  if (!cookies.SESSDATA) throw new BiliApiError(-1, '登录成功但没有拿到登录信息');
  return { state: 'success', cookies, refreshToken: json.data.refresh_token ?? '', expiresAt };
}

/** 退出登录：让这份登录信息在 B 站服务器上失效（不只是删除本地保存的 Cookie） */
export async function logoutRemote(http: BiliHttp): Promise<void> {
  const csrf = http.cookies.bili_jct;
  if (!csrf) throw new BiliApiError(-1, '缺少 bili_jct，无法退出登录');
  const res = await fetch('https://passport.bilibili.com/login/exit/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: Object.entries(http.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      Referer: 'https://www.bilibili.com/',
    },
    body: `biliCSRF=${encodeURIComponent(csrf)}`,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({ code: -1 }))) as { code?: number; message?: string };
  // 2202：登录已失效，视为已经退出
  if (json.code !== 0 && json.code !== 2202) throw new BiliApiError(json.code ?? -1, json.message || '退出登录失败');
}
