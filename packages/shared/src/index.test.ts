import { describe, expect, it } from 'vitest';
import { goldToYuan } from './index.ts';

describe('goldToYuan', () => {
  it('按 1 元 = 1000 金瓜子换算', () => {
    expect(goldToYuan(100)).toBe(0.1); // 小花花
    expect(goldToYuan(19900)).toBe(19.9); // 告白花束
    expect(goldToYuan(1245000)).toBe(1245); // 小电视飞船
  });
});
