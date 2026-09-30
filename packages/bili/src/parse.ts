// 把弹幕服务器的原始消息（已解包的 JSON）转成标准事件。不认识或不需要的消息返回 null。
import type { GuardLevel, Medal, StdEvent, Viewer } from '@starfall/shared';
import { decodeInteractWord, decodeSendGift } from './proto.ts';
import type { PbMedal, PbUserInfo } from './proto.ts';

export interface ParseContext {
  /** 生成事件编号 */
  newId: () => string;
  /** 当前时间（毫秒） */
  now: () => number;
  /** 房管名单（进场消息里没有房管字段，靠名单判断） */
  isMod?: (uid: number) => boolean;
  /** 本直播间主播 UID：粉丝牌上的大航海等级属于牌子所属的主播，只有是本直播间的牌子才能用 */
  anchorUid?: number;
}

type Raw = { cmd?: string; data?: unknown; info?: unknown };
type PbLikeMedal = { name?: string; level?: number; ruid?: number; v2_medal_color_start?: string; v2_medal_color_border?: string; v2_medal_color_text?: string; v2_medal_color_level?: string };

const toGuard = (n: unknown): GuardLevel => (n === 1 || n === 2 || n === 3 ? n : 0);

function medalFromPb(m: PbMedal | undefined): Medal | undefined {
  if (!m || !m.name || !m.level) return undefined;
  const colors =
    m.v2ColorStart && m.v2ColorBorder && m.v2ColorText && m.v2ColorLevel
      ? { bg: m.v2ColorStart, level: m.v2ColorLevel, border: m.v2ColorBorder, text: m.v2ColorText }
      : undefined;
  return { name: m.name, level: m.level, anchorUid: m.ruid ?? 0, ...(colors ? { colors } : {}) };
}

/** 本直播间的大航海等级：优先用户自己的等级（22.6.1）；粉丝牌上的等级只在牌子属于本直播间时采用 */
function guardOf(u: PbUserInfo | undefined, fallback: { guard?: number; guardAnchor?: number }, ctx: ParseContext): GuardLevel {
  const own = (ruid: number | undefined) => ctx.anchorUid !== undefined && ctx.anchorUid > 0 && ruid === ctx.anchorUid;
  return toGuard(u?.guard?.level) || (own(u?.medal?.ruid) ? toGuard(u?.medal?.guardLevel) : 0) || (own(fallback.guardAnchor) ? toGuard(fallback.guard) : 0);
}

function viewerFromPb(u: PbUserInfo | undefined, fallback: { uid?: number; name?: string; face?: string; guard?: number; guardAnchor?: number }, ctx: ParseContext): Viewer {
  const uid = u?.uid || fallback.uid || 0;
  const medal = medalFromPb(u?.medal);
  return {
    uid,
    name: u?.base?.name || fallback.name || '',
    ...(u?.base?.face || fallback.face ? { face: u?.base?.face || fallback.face } : {}),
    guard: guardOf(u, fallback, ctx),
    isMod: uid > 0 && (ctx.isMod?.(uid) ?? false),
    ...(medal ? { medal } : {}),
    ...honorOf(u?.wealth?.level),
    mystery: false,
  };
}

/** 荣耀等级（B 站叫 wealth）：0 或者没有就不填 */
function honorOf(n: unknown): { honor?: number } {
  const v = Number(n);
  return Number.isInteger(v) && v > 0 ? { honor: v } : {};
}

/** 只接受 B 站图床的图片地址，统一换成 https */
function biliImg(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const url = u.replace(/^http:\/\//, 'https://');
  return /^https:\/\/[\w.-]+\.hdslb\.com\//.test(url) ? url : null;
}

/**
 * 弹幕里的图片：info[0][15].extra.emots 是文字里的小表情（写法 → { url }），
 * info[0][13] 是整条表情包（{ url, width, height }，普通弹幕是字符串 "{}"）
 */
function danmuImages(meta: unknown[] | undefined): { emots?: Record<string, string>; sticker?: { url: string; width: number; height: number } } {
  const out: { emots?: Record<string, string>; sticker?: { url: string; width: number; height: number } } = {};
  const big = meta?.[13] as { url?: unknown; width?: unknown; height?: unknown } | undefined;
  const bigUrl = big && typeof big === 'object' ? biliImg(big.url) : null;
  if (bigUrl) out.sticker = { url: bigUrl, width: Number(big!.width) || 0, height: Number(big!.height) || 0 };
  let extra: { emots?: Record<string, { url?: unknown }> | null } = {};
  try {
    extra = JSON.parse(String((meta?.[15] as { extra?: unknown } | undefined)?.extra ?? '{}')) as typeof extra;
  } catch {
    /* 格式不对就当没有表情 */
  }
  const emots: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra.emots ?? {})) {
    const url = biliImg(v?.url);
    if (url && k.length <= 40) emots[k] = url;
  }
  if (Object.keys(emots).length) out.emots = emots;
  return out;
}

export function parseMessage(raw: Raw, ctx: ParseContext): StdEvent | null {
  switch (raw.cmd) {
    case 'INTERACT_WORD_V2': {
      const pb = (raw.data as { pb?: string } | undefined)?.pb;
      if (!pb) return null;
      const w = decodeInteractWord(pb);
      if ((w.msgType ?? 0) !== 1) return null; // 1 进场；2 关注、3 分享等不处理
      const fm = w.fansMedal;
      const viewer = viewerFromPb(w.uinfo, { uid: w.uid, name: w.uname, guard: fm?.guardLevel, guardAnchor: fm?.targetId }, ctx);
      if (!viewer.medal && fm?.name && fm.level) viewer.medal = { name: fm.name, level: fm.level, anchorUid: fm.targetId ?? 0 };
      if (!viewer.uid) return null; // 未登录时 UID 为 0，无法按人处理
      return { kind: 'enter', id: ctx.newId(), ts: w.timestamp ? w.timestamp * 1000 : ctx.now(), viewer, source: 'interact' };
    }

    case 'ENTRY_EFFECT': {
      const d = raw.data as { uid?: number; face?: string; privilege_type?: number; copy_writing?: string; wealthy_info?: { level?: number } } | undefined;
      if (!d?.uid) return null;
      // 文案形如 "欢迎舰长 <%昵称%> 进入直播间"，昵称在 <% %> 之间
      const name = /<%(.*?)%>/.exec(d.copy_writing ?? '')?.[1] ?? '';
      const viewer: Viewer = {
        uid: d.uid,
        name,
        ...(d.face ? { face: d.face } : {}),
        guard: toGuard(d.privilege_type),
        isMod: ctx.isMod?.(d.uid) ?? false,
        ...honorOf(d.wealthy_info?.level),
        mystery: false,
      };
      return { kind: 'enter', id: ctx.newId(), ts: ctx.now(), viewer, source: 'entry_effect' };
    }

    case 'DANMU_MSG': {
      const info = raw.info as unknown[] | undefined;
      if (!Array.isArray(info)) return null;
      const meta = info[0] as unknown[];
      const user = info[2] as [number, string, number?] | undefined;
      const medalArr = info[3] as [number, string, string, number, number] | [] | undefined;
      const ext = (meta?.[15] as { user?: { uid?: number; base?: { name?: string; face?: string }; guard?: { level?: number }; medal?: { name?: string; level?: number; ruid?: number; v2_medal_color_start?: string; v2_medal_color_border?: string; v2_medal_color_text?: string; v2_medal_color_level?: string } } } | undefined)?.user;
      const uid = ext?.uid || user?.[0] || 0;
      if (!uid) return null;
      let medal: Medal | undefined;
      const m = ext?.medal;
      if (m?.name && m.level) {
        const colors = m.v2_medal_color_start && m.v2_medal_color_border && m.v2_medal_color_text && m.v2_medal_color_level
          ? { bg: m.v2_medal_color_start, level: m.v2_medal_color_level, border: m.v2_medal_color_border, text: m.v2_medal_color_text }
          : undefined;
        medal = { name: m.name, level: m.level, anchorUid: m.ruid ?? 0, ...(colors ? { colors } : {}) };
      } else if (medalArr && medalArr.length >= 4) {
        // 旧格式：[等级, 名称, 主播昵称, 直播间号, …, 第 13 项主播 UID]；没有第 13 项时无法判断归属
        medal = { name: String(medalArr[1]), level: Number(medalArr[0]), anchorUid: Number((medalArr as unknown[])[12]) || 0 };
      }
      const viewer: Viewer = {
        uid,
        name: ext?.base?.name || user?.[1] || '',
        ...(ext?.base?.face ? { face: ext.base.face } : {}),
        guard: toGuard(ext?.guard?.level ?? info[7]),
        isMod: user?.[2] === 1 || (ctx.isMod?.(uid) ?? false),
        ...(medal ? { medal } : {}),
        // 第 17 项是 [荣耀等级]
        ...honorOf((info[16] as unknown[] | undefined)?.[0]),
        mystery: false,
      };
      const ts = Number((meta as unknown[] | undefined)?.[4]) || ctx.now();
      const { emots, sticker } = danmuImages(meta);
      return { kind: 'danmu', id: ctx.newId(), ts, viewer, text: String(info[1] ?? ''), ...(emots ? { emots } : {}), ...(sticker ? { sticker } : {}) };
    }

    case 'SEND_GIFT_V2': {
      const pb = (raw.data as { pb?: string } | undefined)?.pb;
      if (!pb) return null;
      const g = decodeSendGift(pb);
      const gift = g.gift;
      if (!gift?.giftId) return null;
      const viewer = viewerFromPb(g.senderUinfo, { uid: g.uid, name: g.uname, face: g.face }, ctx);
      if (!viewer.uid) return null;
      return {
        kind: 'gift',
        id: ctx.newId(),
        ts: gift.timestamp ? gift.timestamp * 1000 : ctx.now(),
        viewer,
        giftId: gift.giftId,
        giftName: gift.giftName ?? '',
        unitPrice: gift.price ?? 0,
        count: gift.num ?? 1,
        paid: gift.coinType === 'gold',
        ...(gift.batchComboId ? { comboKey: gift.batchComboId } : {}),
        ...(gift.img?.basic ? { icon: gift.img.basic } : {}),
      };
    }

    // ---- 上舰：一次购买会同时推送下面三条，由调用方去重（见 core 的 GuardDeduper） ----
    case 'USER_TOAST_MSG_V2': {
      const d = raw.data as
        | { sender_uinfo?: { uid?: number; base?: { name?: string; face?: string } }; guard_info?: { guard_level?: number }; pay_info?: { payflow_id?: string; num?: number; unit?: string; price?: number }; toast_msg?: string }
        | undefined;
      const uid = Number(d?.sender_uinfo?.uid) || 0;
      const level = toGuard(d?.guard_info?.guard_level);
      if (!uid || !level) return null;
      return guardEvent(ctx, { uid, name: d?.sender_uinfo?.base?.name ?? '', face: d?.sender_uinfo?.base?.face, level, num: d?.pay_info?.num, unit: d?.pay_info?.unit, price: d?.pay_info?.price, toast: d?.toast_msg, key: d?.pay_info?.payflow_id, source: 'toast' });
    }
    case 'USER_TOAST_MSG': {
      const d = raw.data as { uid?: number; username?: string; guard_level?: number; num?: number; unit?: string; price?: number; payflow_id?: string; toast_msg?: string } | undefined;
      const uid = Number(d?.uid) || 0;
      const level = toGuard(d?.guard_level);
      if (!uid || !level) return null;
      return guardEvent(ctx, { uid, name: d?.username ?? '', level, num: d?.num, unit: d?.unit, price: d?.price, toast: d?.toast_msg, key: d?.payflow_id, source: 'toast' });
    }
    case 'GUARD_BUY': {
      const d = raw.data as { uid?: number; username?: string; guard_level?: number; num?: number; price?: number } | undefined;
      const uid = Number(d?.uid) || 0;
      const level = toGuard(d?.guard_level);
      if (!uid || !level) return null;
      return guardEvent(ctx, { uid, name: d?.username ?? '', level, num: d?.num, unit: '月', price: d?.price, source: 'guard_buy' });
    }

    // 醒目留言（_JPN 是带日文翻译的同一条，不要）
    case 'SUPER_CHAT_MESSAGE': {
      const d = raw.data as
        | {
            id?: number | string; uid?: number | string; price?: number; message?: string; start_time?: number;
            user_info?: { uname?: string; face?: string; guard_level?: number; manager?: number };
            medal_info?: { medal_name?: string; medal_level?: number; target_id?: number } | null;
            uinfo?: { uid?: number; base?: { name?: string; face?: string; is_mystery?: boolean }; medal?: PbLikeMedal | null; wealth?: { level?: number } | null; guard?: { level?: number } | null };
          }
        | undefined;
      const uid = Number(d?.uid ?? d?.uinfo?.uid) || 0;
      const price = Number(d?.price) || 0;
      if (!uid || price <= 0 || d?.id === undefined) return null;
      const u = d.uinfo;
      const m = u?.medal;
      const mi = d.medal_info;
      const colors = m?.v2_medal_color_start && m.v2_medal_color_border && m.v2_medal_color_text && m.v2_medal_color_level
        ? { bg: m.v2_medal_color_start, level: m.v2_medal_color_level, border: m.v2_medal_color_border, text: m.v2_medal_color_text }
        : undefined;
      const medal: Medal | undefined = m?.name && m.level
        ? { name: m.name, level: m.level, anchorUid: Number(m.ruid) || 0, ...(colors ? { colors } : {}) }
        : mi?.medal_name && mi.medal_level ? { name: mi.medal_name, level: mi.medal_level, anchorUid: Number(mi.target_id) || 0 } : undefined;
      const face = u?.base?.face || d.user_info?.face;
      const viewer: Viewer = {
        uid,
        name: u?.base?.name || d.user_info?.uname || '',
        ...(face ? { face } : {}),
        // 醒目留言是在本直播间发的，身上的大航海就是本直播间的
        guard: toGuard(u?.guard?.level ?? d.user_info?.guard_level),
        isMod: d.user_info?.manager === 1 || (ctx.isMod?.(uid) ?? false),
        ...(medal ? { medal } : {}),
        ...honorOf(u?.wealth?.level),
        mystery: Boolean(u?.base?.is_mystery),
      };
      return { kind: 'sc', id: ctx.newId(), ts: d.start_time ? d.start_time * 1000 : ctx.now(), viewer, text: String(d.message ?? ''), priceYuan: price, scId: String(d.id) };
    }

    case 'LIVE':
      return { kind: 'live', id: ctx.newId(), ts: ctx.now(), live: true };
    case 'PREPARING':
      return { kind: 'live', id: ctx.newId(), ts: ctx.now(), live: false };

    default:
      return null;
  }
}

/** 上舰事件。开通 / 续费按提示文案判断（"……开通了舰长" / "……续费了舰长"）：
 *  P0 抓到的样本里 op_type=2 对应的文案是"开通"，和网上常见的说法（2 = 续费）不一致，所以不依赖 op_type。 */
function guardEvent(
  ctx: ParseContext,
  p: { uid: number; name: string; face?: string | undefined; level: 1 | 2 | 3; num?: number | undefined; unit?: string | undefined; price?: number | undefined; toast?: string | undefined; key?: string | undefined; source: 'toast' | 'guard_buy' },
): StdEvent {
  const num = Math.max(1, Number(p.num) || 1);
  const months = p.unit === '年' ? num * 12 : num;
  const priceGold = guardTotal(p.level, Number(p.price) || 0, months);
  const viewer: Viewer = { uid: p.uid, name: p.name, ...(p.face ? { face: p.face } : {}), guard: p.level, isMod: ctx.isMod?.(p.uid) ?? false, mystery: false };
  return {
    kind: 'guard',
    id: ctx.newId(),
    ts: ctx.now(),
    viewer,
    level: p.level,
    months,
    op: p.toast && /续费/.test(p.toast) ? 'renew' : 'open',
    source: p.source,
    ...(p.key ? { dedupeKey: String(p.key) } : {}),
    ...(priceGold > 0 ? { priceGold } : {}),
  };
}

/** 各等级一个月最贵多少（金瓜子，B 站 App 里的原价） */
const MONTH_MAX: Record<1 | 2 | 3, number> = { 1: 19_998_000, 2: 1_998_000, 3: 198_000 };

/**
 * 这次上舰一共花了多少。样本里都是 1 个月，price 就是这一个月的价格；
 * 买多个月时 price 是总价还是单价没有样本（⏳），按大小判断：超过一个月的最高价就当总价，否则当单价乘月数
 */
export function guardTotal(level: 1 | 2 | 3, price: number, months: number): number {
  if (price <= 0) return 0;
  if (months <= 1 || price > MONTH_MAX[level] * 1.05) return price;
  return price * months;
}

