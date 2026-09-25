import { describe, expect, it } from 'vitest';
import { describe as describeEvent, statusCls } from './events.ts';
import { fileSize, gcd, seconds } from './format.ts';
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
});
