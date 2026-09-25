import { describe, expect, it } from 'vitest';
import { fillText, pickText, textPool } from './text.ts';
import { medal, viewer } from './testing.ts';

const texts = { enter: ['{guard} {name} 驾临', '欢迎 {name}'], gift: ['感谢 {name} 送出 {gift} ×{count}，价值 {value}'], guard: [' ', ''] };

describe('欢迎语文案池（F-AS-09）', () => {
  it('事件写了就用事件的，没写或只有空行时用通用', () => {
    expect(textPool(texts, 'gift')).toEqual(['感谢 {name} 送出 {gift} ×{count}，价值 {value}']);
    expect(textPool(texts, 'guard')).toEqual(texts.enter);
    expect(textPool(texts, 'danmu')).toEqual(texts.enter);
  });

  it('随机选一句（rng 可注入）', () => {
    expect(pickText(texts, 'enter', () => 0)).toBe('{guard} {name} 驾临');
    expect(pickText(texts, 'enter', () => 0.99)).toBe('欢迎 {name}');
    expect(pickText(texts, 'enter', () => 1)).toBe('欢迎 {name}');
  });

  it('全部为空时退回只显示昵称', () => {
    expect(pickText({ enter: ['  '] }, 'enter')).toBe('{name}');
  });
});

describe('变量替换（F-AS-10）', () => {
  it('进场：昵称、大航海、牌子、等级', () => {
    const v = viewer({ name: '长夜未央', guard: 1, medal: medal(44) });
    expect(fillText('{guard} {name} 驾临 · {medal} {level}', { viewer: v })).toBe('总督 长夜未央 驾临 · 咕惑宰 44');
  });

  it('没有大航海时去掉多余空格', () => {
    expect(fillText('{guard} {name} 驾临', { viewer: viewer({ name: '路过的猫' }) })).toBe('路过的猫 驾临');
  });

  it('礼物：名称、数量、价值换算成元', () => {
    const s = fillText('感谢 {name} 送出 {gift} ×{count}，价值 {value}', { viewer: viewer({ name: '雾里看花' }), gift: '告白花束', count: 3, valueGold: 59700 });
    expect(s).toBe('感谢 雾里看花 送出 告白花束 ×3，价值 59.7 元');
    expect(fillText('{value}', { viewer: viewer(), valueGold: 1245000 })).toBe('1245 元');
  });

  it('上舰：用新等级和月数', () => {
    expect(fillText('{name} 开通{guard} {months} 个月', { viewer: viewer({ name: '北岛以北' }), guardLevel: 1, months: 3 })).toBe('北岛以北 开通总督 3 个月');
  });

  it('弹幕内容原样保留（显示时按纯文本处理）', () => {
    expect(fillText('{name}：{text}', { viewer: viewer({ name: 'a' }), text: '<b>生日快乐</b>' })).toBe('a：<b>生日快乐</b>');
  });

  it('未知变量保持原样', () => {
    expect(fillText('{name} {unknown}', { viewer: viewer({ name: 'x' }) })).toBe('x {unknown}');
  });
});
