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
  /** 在直播间礼物面板上的哪一页（礼物、粉丝团、航海……）；不在面板上显示的礼物没有 */
  tab?: string;
  /** 在这一页里的位置（从 1 开始） */
  panel?: number;
}

type RawGift = { id: number; name: string; price: number; coin_type: string; img_basic: string; gif?: string };
const toGift = (g: RawGift): GiftConfig => ({
  id: g.id,
  name: g.name,
  price: g.price,
  paid: g.coin_type === 'gold',
  icon: g.img_basic,
  ...(g.gif ? { gif: g.gif } : {}),
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
