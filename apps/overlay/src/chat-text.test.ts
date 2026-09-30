import { describe, expect, it } from 'vitest';
import { segments } from './chat-text.ts';

describe('弹幕列表：表情换成图片', () => {
  const E = { '[dog]': 'https://i0.hdslb.com/dog.png', '[比心]': 'https://i0.hdslb.com/heart.png' };
  it('有图片的表情切出来，其余照原样', () => {
    expect(segments('来了[dog]主播[比心][比心]', E)).toEqual([
      { text: '来了' },
      { img: E['[dog]'], alt: '[dog]' },
      { text: '主播' },
      { img: E['[比心]'], alt: '[比心]' },
      { img: E['[比心]'], alt: '[比心]' },
    ]);
  });
  it('没有图片的方括号不动；没有表情时整段是文字', () => {
    expect(segments('[不存在]好[dog]', E)).toEqual([{ text: '[不存在]好' }, { img: E['[dog]'], alt: '[dog]' }]);
    expect(segments('晚上好', undefined)).toEqual([{ text: '晚上好' }]);
    expect(segments('', undefined)).toEqual([]);
  });
});
