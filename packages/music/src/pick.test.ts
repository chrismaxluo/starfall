import { describe, expect, it } from 'vitest';
import { blockedBy, norm, pick, words } from './pick.ts';
import type { Candidate } from './pick.ts';

const song = (name: string, artists: string[], p: Partial<Candidate> = {}): Candidate => ({ name, artists, durationMs: 240_000, playable: true, ...p });
const O = { maxMs: 420_000, blockWords: [] };

describe('选歌', () => {
  it('写法不同也算一样：全角半角、大小写、空格和符号', () => {
    expect(norm('Ｓhape  of You')).toBe('shapeofyou');
    expect(words('晴天 周杰伦')).toEqual(['晴天', '周杰伦']);
    expect(words('晴天-周杰伦')).toEqual(['晴天', '周杰伦']);
    expect(words('  ')).toEqual([]);
  });

  it('按搜索顺序选第一首能放的；放不了、太长的跳过', () => {
    const r = pick('起风了', [song('起风了', ['买辣椒也用券'], { playable: false }), song('起风了', ['周深'], { durationMs: 500_000 }), song('起风了', ['吴青峰'])], O);
    expect(r).toMatchObject({ ok: true, song: { artists: ['吴青峰'] } });
  });

  it('写了歌手：每个词都要对得上；歌手不在搜索结果里时不放别人的翻唱', () => {
    const results = [song('晴天(深情版)', ['Lucky小爱']), song('晴天', ['某翻唱'])];
    expect(pick('晴天 周杰伦', results, O)).toMatchObject({ ok: false, reason: 'no_version', text: '没有找到「周杰伦」的版本' });
    expect(pick('光年之外 邓紫棋', [song('光年之外', ['G.E.M.邓紫棋'])], O)).toMatchObject({ ok: true });
    // 歌手的别名、译名也算
    expect(pick('光年之外 GEM', [song('光年之外', ['邓紫棋'], { artistAlias: ['G.E.M.'] })], O)).toMatchObject({ ok: true });
    // 歌名的别名也算
    expect(pick('Lemon 柠檬', [song('Lemon', ['米津玄師'], { alias: ['柠檬'] })], O)).toMatchObject({ ok: true });
  });

  it('只写歌名：伴奏、翻唱、Live、加速版往后排；观众自己写了就不算', () => {
    const results = [song('孤勇者 (伴奏)', ['陈奕迅']), song('孤勇者 (Live)', ['陈奕迅']), song('孤勇者', ['陈奕迅'])];
    expect(pick('孤勇者', results, O)).toMatchObject({ ok: true, song: { name: '孤勇者' } });
    expect(pick('孤勇者 live', results, O)).toMatchObject({ ok: true, song: { name: '孤勇者 (Live)' } });
  });

  it('只写一个词、结果里都不含这个词（拼音、错别字）时相信搜索排序；含这个词的都放不了时不拿别的顶替', () => {
    expect(pick('qifengle', [song('起风了', ['买辣椒也用券'])], O)).toMatchObject({ ok: true, song: { name: '起风了' } });
    const r = pick('孤勇者', [song('孤勇者', ['陈奕迅'], { playable: false }), song('别的歌', ['某人'])], O);
    expect(r).toMatchObject({ ok: false, reason: 'unplayable', text: '《孤勇者》需要会员或者暂时放不了' });
  });

  it('说明为什么不能点：太长、不让点、搜不到', () => {
    expect(pick('长歌', [song('长歌', ['某人'], { durationMs: 900_000 })], O)).toMatchObject({ ok: false, reason: 'too_long', text: '《长歌》太长了（超过 7 分钟）' });
    expect(pick('坏歌', [song('坏歌', ['某人'])], { ...O, blockWords: ['坏'] })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(pick('没有', [], O)).toMatchObject({ ok: false, reason: 'not_found', text: '没有找到「没有」' });
    expect(blockedBy({ name: 'ABC', artists: ['某某DJ'] }, ['dj'])).toBe('dj');
    expect(blockedBy({ name: 'ABC', artists: ['某某'] }, ['dj'])).toBeNull();
  });
});
