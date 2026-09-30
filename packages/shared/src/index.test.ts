import { describe, expect, it } from 'vitest';
import { chatHeight, goldToYuan } from './index.ts';

describe('goldToYuan', () => {
  it('按 1 元 = 1000 金瓜子换算', () => {
    expect(goldToYuan(100)).toBe(0.1); // 小花花
    expect(goldToYuan(19900)).toBe(19.9); // 告白花束
    expect(goldToYuan(1245000)).toBe(1245); // 小电视飞船
  });
});

describe('弹幕列表建议高度', () => {
  it('默认 8 条、标准字号是 900；字号大、条数多时更高；按 50 取整，至少 300', () => {
    expect(chatHeight(8, 'normal')).toBe(900);
    expect(chatHeight(8, 'large')).toBe(1100);
    expect(chatHeight(20, 'normal')).toBe(2250);
    expect(chatHeight(1, 'normal')).toBe(300);
    for (let n = 1; n < 20; n++) expect(chatHeight(n + 1, 'normal')).toBeGreaterThan(chatHeight(n, 'normal') - 1);
  });
});
