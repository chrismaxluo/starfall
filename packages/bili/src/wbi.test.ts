import { describe, expect, it } from 'vitest';
import { mixinKey, signQuery } from './wbi.ts';

describe('WBI 签名', () => {
  // 公开资料中的示例密钥与结果
  const key = mixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');

  it('混淆密钥', () => {
    expect(key).toBe('ea1db124af3c7062474693fa704f4ff8');
  });

  it('参数排序、过滤特殊字符并追加 w_rid', () => {
    const q = signQuery({ foo: '114', bar: '514', zab: 1919810 }, key, 1702204169000);
    expect(q).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });
});
