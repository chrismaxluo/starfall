import { describe, expect, it } from 'vitest';
import { describe as describeEvent, statusCls } from './events.ts';
import { bigNum, clock, dateTime, fileSize, gcd, hms, seconds, setTimeZone, today, when } from './format.ts';
import { identityOf, medalColors } from './identity.ts';
import type { EventDto, Viewer } from './types.ts';

const v = (p: Partial<Viewer> = {}): Viewer => ({ uid: 1, name: '小星', guard: 0, isMod: false, mystery: false, ...p });

describe('观众身份', () => {
  it('大航海 > 房管 > 本直播间粉丝牌 > 普通', () => {
    expect(identityOf(v({ guard: 3, isMod: true }), 20000)).toBe('cap');
    expect(identityOf(v({ isMod: true, medal: { name: '牌', level: 30, anchorUid: 20000 } }), 20000)).toBe('mod');
    expect(identityOf(v({ medal: { name: '牌', level: 30, anchorUid: 20000 } }), 20000)).toBe('fan');
    expect(identityOf(v({ medal: { name: '牌', level: 30, anchorUid: 999 } }), 20000)).toBe('nor');
    expect(identityOf(v(), 20000)).toBe('nor');
  });
  it('粉丝牌颜色按等级；大航海有亮边', () => {
    expect(medalColors(5).bg).toBe('#5762A799');
    expect(medalColors(25, true).border).toBe('#5FC7F4');
    expect(medalColors(25, false).border).toBe('#3FB4F699');
  });
});

describe('事件说明', () => {
  const e = (p: Partial<EventDto>): EventDto => ({ id: 1, ts: 0, kind: 'enter', uid: 1, uname: '小星', viewer: v(), payload: null, rule: null, effectId: null, status: 'played', ...p });
  it('按事件类型描述', () => {
    expect(describeEvent(e({}))).toBe('进场');
    expect(describeEvent(e({ kind: 'danmu', payload: { text: '晚上好' } }))).toBe('「晚上好」');
    expect(describeEvent(e({ kind: 'gift', payload: { giftName: '小花花', count: 10 } }))).toBe('送出 小花花 ×10');
    expect(describeEvent(e({ kind: 'guard', payload: { level: 3, months: 1, op: 'open' } }))).toBe('开通舰长 1 个月');
  });
  it('状态颜色', () => {
    expect(statusCls('played')).toBe('ok');
    expect(statusCls('blacklist')).toBe('bad');
    expect(statusCls('no_overlay')).toBe('warn');
    expect(statusCls('cooldown')).toBe('skip');
  });
});

describe('格式化', () => {
  it('文件大小、时长、比例', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(15 * 1024 * 1024)).toBe('15.0 MB');
    expect(seconds(4200)).toBe('4.2s');
    expect(seconds(null)).toBe('静态');
    expect(gcd(1080, 1920)).toBe(120);
  });

  it('大数字、时刻、直播时长', () => {
    expect(bigNum(null)).toBe('—');
    expect(bigNum(9999)).toBe('9,999');
    expect(bigNum(13_000)).toBe('1.3万');
    expect(bigNum(3_671_294)).toBe('367.1万');
    const now = new Date(2026, 8, 26, 21, 0).getTime();
    expect(when(new Date(2026, 8, 26, 19, 2).getTime(), now)).toBe('今天 19:02');
    expect(when(new Date(2026, 8, 25, 23, 40).getTime(), now)).toBe('昨天 23:40');
    expect(when(new Date(2026, 8, 20, 9, 5).getTime(), now)).toBe('9月20日 09:05');
    expect(hms((2 * 3600 + 14 * 60 + 37) * 1000)).toBe('2:14:37');
  });
});

describe('时间按主播所在时区显示', () => {
  it('北京时间：UTC 2026-09-26 20:00 显示为 09-27 04:00:00，"今天"也按这个时区', () => {
    setTimeZone('Asia/Shanghai');
    const ts = Date.UTC(2026, 8, 26, 20, 0, 0);
    expect(dateTime(ts)).toBe('09-27 04:00:00');
    expect(clock(ts)).toBe('04:00:00');
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    setTimeZone('America/New_York');
    expect(dateTime(ts)).toBe('09-26 16:00:00');
    setTimeZone('Not/AZone');
    expect(dateTime(ts)).toMatch(/^\d{2}-\d{2} \d{2}:00:00$/);
    setTimeZone(undefined);
  });
});
