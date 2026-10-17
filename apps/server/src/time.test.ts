import { describe, expect, it } from 'vitest';
import { dayShift, dayStart, monthStartDay, weekStartDay } from './time.ts';

describe('按主播时区算日子', () => {
  it('某一天 0 点', () => {
    expect(dayStart('2026-09-25', 'Asia/Shanghai')).toBe(Date.parse('2026-09-25T00:00:00+08:00'));
    expect(dayStart('2026-09-25', 'UTC')).toBe(Date.parse('2026-09-25T00:00:00Z'));
  });

  it('这一周的周一、这个月的 1 号；跨月、跨年往前数', () => {
    // 2026-10-17 是周六
    expect(weekStartDay('2026-10-17')).toBe('2026-10-12');
    expect(weekStartDay('2026-10-12')).toBe('2026-10-12');
    expect(weekStartDay('2026-10-18')).toBe('2026-10-12');
    expect(weekStartDay('2026-11-01')).toBe('2026-10-26');
    expect(weekStartDay('2027-01-01')).toBe('2026-12-28');
    expect(monthStartDay('2026-10-17')).toBe('2026-10-01');
    expect(dayShift('2026-03-01', -1)).toBe('2026-02-28');
  });
});
