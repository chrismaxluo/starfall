import { describe, expect, it } from 'vitest';
import { bubbleSvg, ornaments, pickCat, simpleFrame, themeFrame } from './chat-theme-art.ts';

describe('弹幕列表主题外观：小八表情', () => {
  it('按弹幕内容挑，先对上的先用；表情包配抱爱心', () => {
    expect(pickCat('哈哈哈哈笑死', false, 0).id).toBe('laughing');
    expect(pickCat('哈哈', false, 0).id).toBe('grin');
    expect(pickCat('呜呜呜', false, 0).id).toBe('crying');
    expect(pickCat('卧槽！', false, 0).id).toBe('shocked');
    expect(pickCat('无语……', false, 0).id).toBe('exhausted');
    expect(pickCat('晚安', false, 0).id).toBe('sleepy');
    expect(pickCat('这是什么？', false, 0).id).toBe('puzzled');
    expect(pickCat('', true, 0)).toEqual({ id: 'heart', fallback: false });
  });
  it('都对不上的轮流用开心、眨眼、眯眼', () => {
    expect([0, 1, 2, 3].map((i) => pickCat('666', false, i))).toEqual([
      { id: 'happy', fallback: true },
      { id: 'wink', fallback: true },
      { id: 'content', fallback: true },
      { id: 'happy', fallback: true },
    ]);
  });
});

describe('弹幕列表主题外观：图形', () => {
  it('舰长一颗星、提督两颗、总督皇冠，普通观众没有', () => {
    expect(ornaments('cream', 0)).toEqual([]);
    expect(ornaments('cream', 3).map((o) => o[0])).toEqual(['s1']);
    expect(ornaments('night', 2).map((o) => o[0])).toEqual(['s1', 's2']);
    expect(ornaments('pixel', 1).map((o) => [o[0], o[2]])).toEqual([['crown', true]]);
  });
  it('头像框、气泡按身份换色；底色浓淡用 --bga，改浓淡不用重画', () => {
    expect(themeFrame('night', 2)).toContain('#9B6CF0');
    expect(themeFrame('pixel', 1)).toContain('#F0A925');
    expect(simpleFrame('cream', 'anchor')).toContain('#F06E9C');
    const art = { img: (n: string) => `/x/${n}.webp`, catAtEnd: false, charm: 'heart-charm' as const, uid: 't1' };
    for (const look of ['cream', 'night', 'pixel'] as const) {
      const s = bubbleSvg(look, 3, 360, 100, 1, art);
      expect(s).toContain('var(--bga)');
      expect(s).not.toContain('NaN');
    }
    // 奶油贴纸：尾巴、爪印、吊坠用图片；小八坐在气泡右端时不放爪印
    expect(bubbleSvg('cream', 'n', 360, 100, 1, art)).toContain('/x/paw.webp');
    expect(bubbleSvg('cream', 'n', 360, 100, 1, { ...art, catAtEnd: true })).not.toContain('/x/paw.webp');
  });
});
