// 直播间实时数据消息（不是观众事件）：看过人数、高能榜人数、点赞数、粉丝数，以及标题、分区的变更。
// 格式见 docs/bili-protocol.md，样本来自实际抓包。

export interface RoomStatsPatch {
  /** 看过人数（WATCHED_CHANGE） */
  watched?: number;
  /** 高能榜人数（ONLINE_RANK_COUNT） */
  rankCount?: number;
  /** 点赞数（LIKE_INFO_V3_UPDATE） */
  likes?: number;
  /** 粉丝数、粉丝团人数（ROOM_REAL_TIME_MESSAGE_UPDATE） */
  followers?: number;
  fansClub?: number;
  /** 主播改了标题或分区（ROOM_CHANGE） */
  title?: string;
  areaName?: string;
  parentAreaName?: string;
}

type Raw = { cmd?: string; data?: Record<string, unknown> };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/** 去掉 undefined 的字段；一个有效字段都没有时返回 null */
function patch(p: RoomStatsPatch): RoomStatsPatch | null {
  const out = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as RoomStatsPatch;
  return Object.keys(out).length ? out : null;
}

/** 是直播间数据消息就返回变化的字段，否则返回 null */
export function parseRoomStats(raw: Raw): RoomStatsPatch | null {
  const d = raw.data;
  if (!d || typeof d !== 'object') return null;
  switch (raw.cmd) {
    case 'WATCHED_CHANGE':
      return patch({ watched: num(d.num) });
    case 'ONLINE_RANK_COUNT':
      return patch({ rankCount: num(d.count) });
    case 'LIKE_INFO_V3_UPDATE':
      return patch({ likes: num(d.click_count) });
    case 'ROOM_REAL_TIME_MESSAGE_UPDATE':
      return patch({ followers: num(d.fans), fansClub: num(d.fans_club) });
    case 'ROOM_CHANGE':
      return patch({ title: str(d.title), areaName: str(d.area_name), parentAreaName: str(d.parent_area_name) });
    default:
      return null;
  }
}
