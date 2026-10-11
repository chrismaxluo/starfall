import { describe, expect, it } from 'vitest';
import { mix } from './color.ts';

describe('mix', () => {
  it('和透明混合 = 只改透明度', () => {
    expect(mix('#3D8BFF', 94)).toBe('rgba(61, 139, 255, 0.94)');
    expect(mix('#fff', 70)).toBe('rgba(255, 255, 255, 0.7)');
  });
  it('和黑色混合', () => {
    expect(mix('#FF9D00', 85, '#000')).toBe('rgba(217, 133, 0, 1)');
  });
  it('和半透明色混合按预乘算', () => {
    // 透明度 .18 + .82 × .4 = .508；红 = (255 × .18 + 16 × .4 × .82) / .508
    expect(mix('#FF0000', 18, 'rgba(16,14,32,.4)')).toBe('rgba(101, 9, 21, 0.508)');
  });
  it('本身半透明的颜色', () => {
    expect(mix('rgba(255,255,255,.55)', 55)).toBe('rgba(255, 255, 255, 0.3025)');
  });
});
