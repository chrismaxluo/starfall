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
}

type Raw = { cmd?: string; data?: unknown; info?: unknown };

const toGuard = (n: unknown): GuardLevel => (n === 1 || n === 2 || n === 3 ? n : 0);

function medalFromPb(m: PbMedal | undefined): Medal | undefined {
  if (!m || !m.name || !m.level) return undefined;
  const colors =
    m.v2ColorStart && m.v2ColorBorder && m.v2ColorText && m.v2ColorLevel
      ? { bg: m.v2ColorStart, level: m.v2ColorLevel, border: m.v2ColorBorder, text: m.v2ColorText }
      : undefined;
  return { name: m.name, level: m.level, anchorUid: m.ruid ?? 0, ...(colors ? { colors } : {}) };
}

function viewerFromPb(u: PbUserInfo | undefined, fallback: { uid?: number; name?: string; face?: string; guard?: number }, ctx: ParseContext): Viewer {
  const uid = u?.uid || fallback.uid || 0;
  const medal = medalFromPb(u?.medal);
  return {
    uid,
    name: u?.base?.name || fallback.name || '',
    ...(u?.base?.face || fallback.face ? { face: u?.base?.face || fallback.face } : {}),
    guard: toGuard(u?.guard?.level || u?.medal?.guardLevel || fallback.guard),
    isMod: uid > 0 && (ctx.isMod?.(uid) ?? false),
    ...(medal ? { medal } : {}),
    mystery: false,
  };
}

export function parseMessage(raw: Raw, ctx: ParseContext): StdEvent | null {
  switch (raw.cmd) {
    case 'INTERACT_WORD_V2': {
      const pb = (raw.data as { pb?: string } | undefined)?.pb;
      if (!pb) return null;
      const w = decodeInteractWord(pb);
      if ((w.msgType ?? 0) !== 1) return null; // 1 进场；2 关注、3 分享等不处理
      const fm = w.fansMedal;
      const viewer = viewerFromPb(w.uinfo, { uid: w.uid, name: w.uname, guard: fm?.guardLevel }, ctx);
      if (!viewer.medal && fm?.name && fm.level) viewer.medal = { name: fm.name, level: fm.level, anchorUid: fm.targetId ?? 0 };
      if (!viewer.uid) return null; // 未登录时 UID 为 0，无法按人处理
      return { kind: 'enter', id: ctx.newId(), ts: w.timestamp ? w.timestamp * 1000 : ctx.now(), viewer, source: 'interact' };
    }

    case 'ENTRY_EFFECT': {
      const d = raw.data as { uid?: number; face?: string; privilege_type?: number; copy_writing?: string } | undefined;
      if (!d?.uid) return null;
      // 文案形如 "欢迎舰长 <%昵称%> 进入直播间"，昵称在 <% %> 之间
      const name = /<%(.*?)%>/.exec(d.copy_writing ?? '')?.[1] ?? '';
      const viewer: Viewer = {
        uid: d.uid,
        name,
        ...(d.face ? { face: d.face } : {}),
        guard: toGuard(d.privilege_type),
        isMod: ctx.isMod?.(d.uid) ?? false,
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
        // 旧格式没有主播 UID，只有直播间号，这里无法判断归属，交给调用方按直播间号处理
        medal = { name: String(medalArr[1]), level: Number(medalArr[0]), anchorUid: 0 };
      }
      const viewer: Viewer = {
        uid,
        name: ext?.base?.name || user?.[1] || '',
        ...(ext?.base?.face ? { face: ext.base.face } : {}),
        guard: toGuard(ext?.guard?.level ?? info[7]),
        isMod: user?.[2] === 1 || (ctx.isMod?.(uid) ?? false),
        ...(medal ? { medal } : {}),
        mystery: false,
      };
      const ts = Number((meta as unknown[] | undefined)?.[4]) || ctx.now();
      return { kind: 'danmu', id: ctx.newId(), ts, viewer, text: String(info[1] ?? '') };
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
      };
    }

    case 'LIVE':
      return { kind: 'live', id: ctx.newId(), ts: ctx.now(), live: true };
    case 'PREPARING':
      return { kind: 'live', id: ctx.newId(), ts: ctx.now(), live: false };

    default:
      return null;
  }
}
