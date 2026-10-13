import { describe, expect, it } from 'vitest';
import { LEVEL_MAX_DB, LEVEL_MIN_DB, levelGainDb, rmsOf } from './music-level.ts';

describe('音量均衡', () => {
  it('按响度算增益：太响调小、太轻调大，有上下限', () => {
    expect(levelGainDb(-14)).toBe(0);
    expect(levelGainDb(-8)).toBe(-6);
    expect(levelGainDb(-18)).toBe(4);
    expect(levelGainDb(0)).toBe(LEVEL_MIN_DB);
    expect(levelGainDb(-40)).toBe(LEVEL_MAX_DB);
  });

  it('RMS 按音量滑块换算回原始响度，静音和音量太小时不算', () => {
    const buf = new Float32Array(1000).fill(0.1);
    expect(rmsOf(buf, 1)).toBeCloseTo(0.1);
    expect(rmsOf(new Float32Array(1000).fill(0.05), 0.5)).toBeCloseTo(0.1);
    expect(rmsOf(new Float32Array(1000), 1)).toBeNull();
    expect(rmsOf(buf, 0.01)).toBeNull();
  });
});
