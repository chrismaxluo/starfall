import { describe, expect, it } from 'vitest';
import { parseRoomStats } from './stats.ts';

describe('直播间实时数据', () => {
  it('看过、高能榜、点赞、粉丝（实际抓包的格式）', () => {
    expect(parseRoomStats({ cmd: 'WATCHED_CHANGE', data: { num: 366, text_small: '366', text_large: '366人看过' } })).toEqual({ watched: 366 });
    expect(parseRoomStats({ cmd: 'ONLINE_RANK_COUNT', data: { count: 4, count_text: '4', online_count: 4, online_count_text: '4' } })).toEqual({ rankCount: 4 });
    expect(parseRoomStats({ cmd: 'LIKE_INFO_V3_UPDATE', data: { click_count: 35791 } })).toEqual({ likes: 35791 });
    expect(parseRoomStats({ cmd: 'ROOM_REAL_TIME_MESSAGE_UPDATE', data: { roomid: 22746343, fans: 665313, red_notice: -1, fans_club: 1982 } })).toEqual({ followers: 665313, fansClub: 1982 });
  });

  it('改标题、分区', () => {
    expect(parseRoomStats({ cmd: 'ROOM_CHANGE', data: { title: '新标题', area_name: '视频唱见', parent_area_name: '娱乐', area_id: 190 } })).toEqual({ title: '新标题', areaName: '视频唱见', parentAreaName: '娱乐' });
  });

  it('其他消息、字段缺失或格式不对时返回 null', () => {
    expect(parseRoomStats({ cmd: 'DANMU_MSG', data: {} })).toBeNull();
    expect(parseRoomStats({ cmd: 'WATCHED_CHANGE', data: { num: '366' } })).toBeNull();
    expect(parseRoomStats({ cmd: 'WATCHED_CHANGE' })).toBeNull();
  });
});
