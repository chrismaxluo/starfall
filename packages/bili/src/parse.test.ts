import { describe, expect, it } from 'vitest';
import { encodePb } from './proto.ts';
import { guardTotal, parseMessage } from './parse.ts';
import type { ParseContext } from './parse.ts';
import { FIXTURE_ANCHOR, fixture } from './testing.ts';

let n = 0;
const ctx = { newId: () => `e${++n}`, now: () => 1_790_000_000_000, isMod: (uid: number) => uid === 10002 };

describe('进场 INTERACT_WORD_V2', () => {
  it('解析 UID、昵称、头像、大航海、本直播间粉丝牌和颜色', () => {
    const ev = parseMessage(fixture('interact_word_v2.enter.guard-medal'), ctx);
    expect(ev).toMatchObject({ kind: 'enter', source: 'interact', ts: 1_790_000_000_000 });
    if (ev?.kind !== 'enter') throw new Error();
    expect(ev.viewer).toMatchObject({ uid: 10001, name: '测试舰长', face: 'https://example.invalid/face/10001.jpg', guard: 3, isMod: false });
    expect(ev.viewer.medal).toEqual({ name: '测试牌', level: 25, anchorUid: FIXTURE_ANCHOR, colors: { bg: '#3FB4F699', level: '#3FB4F6E6', border: '#5FC7F4', text: '#FFFFFF' } });
  });

  it('别的直播间的牌子保留所属主播 UID，由匹配逻辑判断；房管靠名单识别', () => {
    const ev = parseMessage(fixture('interact_word_v2.enter.other-medal'), ctx);
    if (ev?.kind !== 'enter') throw new Error();
    expect(ev.viewer.medal?.anchorUid).toBe(99999);
    expect(ev.viewer.isMod).toBe(true);
    expect(ev.viewer.guard).toBe(0);
  });

  it('粉丝牌上的大航海等级只在牌子属于本直播间时采用（别的主播的舰长不算本直播间舰长）', () => {
    const enter = (ruid: number, guardLevel: number, own?: number) => ({
      cmd: 'INTERACT_WORD_V2',
      data: { pb: encodePb('InteractWord', { uid: 10009, uname: '路人', msgType: 1, uinfo: { uid: 10009, base: { name: '路人' }, medal: { name: '别家', level: 20, ruid, guardLevel }, ...(own ? { guard: { level: own } } : {}) } }) },
    });
    const at = { ...ctx, anchorUid: FIXTURE_ANCHOR };
    const guard = (raw: object, c: ParseContext = at) => { const ev = parseMessage(raw, c); if (ev?.kind !== 'enter') throw new Error(); return ev.viewer.guard; };
    expect(guard(enter(99999, 3))).toBe(0);
    expect(guard(enter(FIXTURE_ANCHOR, 3))).toBe(3);
    expect(guard(enter(99999, 3, 2))).toBe(2);
    // 不知道主播 UID 时，只相信用户自己的等级
    expect(guard(enter(FIXTURE_ANCHOR, 3), ctx)).toBe(0);
  });

  it('荣耀等级：来自 uinfo.wealth；0 级或者没有时不填', () => {
    const enter = (wealth?: number) => ({ cmd: 'INTERACT_WORD_V2', data: { pb: encodePb('InteractWord', { uid: 10009, uname: '路人', msgType: 1, uinfo: { uid: 10009, base: { name: '路人' }, ...(wealth !== undefined ? { wealth: { level: wealth } } : {}) } }) } });
    const honor = (raw: object) => { const ev = parseMessage(raw, ctx); if (ev?.kind !== 'enter') throw new Error(); return ev.viewer.honor; };
    expect(honor(enter(53))).toBe(53);
    expect(honor(enter(0))).toBeUndefined();
    expect(honor(enter())).toBeUndefined();
  });

  it('关注消息、未登录（UID 为 0）的消息不产生进场事件', () => {
    expect(parseMessage(fixture('interact_word_v2.follow'), ctx)).toBeNull();
    expect(parseMessage(fixture('interact_word_v2.anonymous'), ctx)).toBeNull();
  });
});

describe('进场 ENTRY_EFFECT', () => {
  it('从文案里取出昵称，大航海来自 privilege_type', () => {
    const ev = parseMessage(fixture('entry_effect.guard'), ctx);
    expect(ev).toMatchObject({ kind: 'enter', source: 'entry_effect', viewer: { uid: 10001, name: '测试舰长', guard: 3 } });
  });

  it('荣耀等级触发的进场特效：没有大航海，荣耀等级来自 wealthy_info', () => {
    expect(parseMessage(fixture('entry_effect.wealth'), ctx)).toMatchObject({ viewer: { uid: 10004, name: '测试富', guard: 0, honor: 37 } });
  });
});

describe('弹幕 DANMU_MSG', () => {
  it('内容、UID、昵称、提督、房管、粉丝牌', () => {
    const ev = parseMessage(fixture('danmu_msg.guard-mod'), ctx);
    expect(ev).toMatchObject({ kind: 'danmu', text: '主播生日快乐！', ts: 1790000004000 });
    if (ev?.kind !== 'danmu') throw new Error();
    expect(ev.viewer).toMatchObject({ uid: 10005, name: '测试提督', guard: 2, isMod: true, medal: { name: '测试牌', level: 39, anchorUid: FIXTURE_ANCHOR }, honor: 11 });
    expect(ev.emots).toBeUndefined();
    expect(ev.sticker).toBeUndefined();
  });

  // 表情的结构来自真实弹幕（extra.emots、info[0][13]），地址换成测试值
  const withImages = (meta13: unknown, emots: unknown) => {
    const raw = structuredClone(fixture('danmu_msg.guard-mod')) as { info: unknown[][] };
    raw.info[0]![13] = meta13;
    const m15 = raw.info[0]![15] as { extra: string };
    m15.extra = JSON.stringify({ ...JSON.parse(m15.extra), emots });
    return raw;
  };
  it('文字里的小表情：写法 → 图片地址（http 换成 https，只要 B 站图床的）', () => {
    const ev = parseMessage(withImages('{}', { '[dog]': { url: 'http://i0.hdslb.com/bfs/live/dog.png', width: 20, height: 20 }, '[坏]': { url: 'https://evil.example/x.png' } }), ctx);
    expect(ev).toMatchObject({ kind: 'danmu', emots: { '[dog]': 'https://i0.hdslb.com/bfs/live/dog.png' } });
    if (ev?.kind !== 'danmu') throw new Error();
    expect(ev.emots?.['[坏]']).toBeUndefined();
  });
  it('整条是表情包：info[0][13] 带图片地址和大小', () => {
    const ev = parseMessage(withImages({ emoticon_unique: 'upower_[测试_好耶]', url: 'http://i0.hdslb.com/bfs/emote/haoye.png', width: 162, height: 162 }, null), ctx);
    expect(ev).toMatchObject({ kind: 'danmu', sticker: { url: 'https://i0.hdslb.com/bfs/emote/haoye.png', width: 162, height: 162 } });
  });
});

describe('醒目留言 SUPER_CHAT_MESSAGE', () => {
  // 结构来自 av/v1/SuperChat/getMessageList（和弹幕服务器推送的一样），昵称头像换成测试值
  const sc = (p: object = {}) => ({
    cmd: 'SUPER_CHAT_MESSAGE',
    data: {
      id: 19367413, uid: 10010, price: 50, time: 60, start_time: 1790781411, message: '主播能帮我抽一下吗',
      user_info: { face: 'https://example.invalid/face/10010.jpg', uname: '测试 SC', guard_level: 3, manager: 0 },
      medal_info: { medal_name: '测试牌', medal_level: 21, target_id: FIXTURE_ANCHOR },
      uinfo: { uid: 10010, base: { name: '测试 SC', face: 'https://example.invalid/face/10010.jpg', is_mystery: false }, medal: null, wealth: { level: 33 }, guard: { level: 3 } },
      ...p,
    },
  });
  it('价格（元）、内容、编号、身份', () => {
    expect(parseMessage(sc(), ctx)).toEqual({
      kind: 'sc', id: expect.any(String), ts: 1790781411000, text: '主播能帮我抽一下吗', priceYuan: 50, scId: '19367413',
      viewer: { uid: 10010, name: '测试 SC', face: 'https://example.invalid/face/10010.jpg', guard: 3, isMod: false, medal: { name: '测试牌', level: 21, anchorUid: FIXTURE_ANCHOR }, honor: 33, mystery: false },
    });
  });
  it('没有价格、没有 UID 的不要；带日文翻译的那条（_JPN）不要', () => {
    expect(parseMessage(sc({ price: 0 }), ctx)).toBeNull();
    expect(parseMessage(sc({ uid: 0, uinfo: undefined }), ctx)).toBeNull();
    expect(parseMessage({ ...sc(), cmd: 'SUPER_CHAT_MESSAGE_JPN' }, ctx)).toBeNull();
  });
});

describe('送礼 SEND_GIFT_V2', () => {
  it('礼物 ID、名称、单价、数量、付费、连击批次', () => {
    expect(parseMessage(fixture('send_gift_v2.combo'), ctx)).toMatchObject({
      kind: 'gift', giftId: 31164, giftName: '粉丝团灯牌', unitPrice: 100, count: 10, paid: true,
      comboKey: 'batch:gift:combo_id:10006:20000:31164:1790000005.0001', viewer: { uid: 10006, name: '测试金主', medal: { level: 30 } },
    });
  });

  it('免费礼物标记为非付费', () => {
    expect(parseMessage(fixture('send_gift_v2.free'), ctx)).toMatchObject({ giftName: '辣条', paid: false });
  });

  it('读出消息里自带的官方礼物图标（10.35.1），没有时不带这个字段', () => {
    expect(parseMessage(fixture('send_gift_v2.combo'), ctx)).toMatchObject({ icon: 'https://s1.hdslb.com/bfs/live/e051dfd4557678f8edcac4993ed00a0935cbd9cc.png' });
    expect(parseMessage(fixture('send_gift_v2.free'), ctx)).not.toHaveProperty('icon');
  });
});

describe('其他消息', () => {
  it('PREPARING 为下播', () => {
    expect(parseMessage(fixture('preparing'), ctx)).toMatchObject({ kind: 'live', live: false });
  });

  it('LIVE 为开播', () => {
    expect(parseMessage({ cmd: 'LIVE' }, ctx)).toMatchObject({ kind: 'live', live: true });
  });

  it('UNIVERSAL_EVENT_GIFT 是连麦状态，忽略', () => {
    expect(parseMessage(fixture('universal_event_gift'), ctx)).toBeNull();
  });

  it('损坏的 protobuf 数据抛出错误，由调用方记录', () => {
    expect(() => parseMessage({ cmd: 'INTERACT_WORD_V2', data: { pb: '////' } }, ctx)).toThrow();
  });
});

describe('上舰', () => {
  it('USER_TOAST_MSG_V2：结构化用户信息、月数、按文案判断开通 / 续费、支付流水号', () => {
    expect(parseMessage(fixture('user_toast_msg_v2.cap-open'), ctx)).toMatchObject({
      kind: 'guard', level: 3, months: 1, op: 'open', source: 'toast', dedupeKey: '2609260000000000000000001',
      viewer: { uid: 10006, name: '测试新舰长', face: 'https://example.invalid/face/10006.jpg', guard: 3 },
    });
  });
  it('USER_TOAST_MSG：和 V2 同一个流水号（用于去重）', () => {
    expect(parseMessage(fixture('user_toast_msg.cap-open'), ctx)).toMatchObject({ kind: 'guard', level: 3, months: 1, op: 'open', source: 'toast', dedupeKey: '2609260000000000000000001', viewer: { uid: 10006 } });
  });
  it('GUARD_BUY：没有开通 / 续费信息、没有流水号', () => {
    const ev = parseMessage(fixture('guard_buy.cap'), ctx);
    expect(ev).toMatchObject({ kind: 'guard', level: 3, months: 1, op: 'open', source: 'guard_buy', viewer: { uid: 10006, name: '测试新舰长' } });
    expect(ev).not.toHaveProperty('dedupeKey');
  });
  it('价格：toast 里是实际支付的（有折扣），GUARD_BUY 里是原价；买多个月按大小判断是总价还是单价', () => {
    expect(parseMessage(fixture('user_toast_msg_v2.cap-open'), ctx)).toMatchObject({ priceGold: 168_000 });
    expect(parseMessage(fixture('user_toast_msg.cap-open'), ctx)).toMatchObject({ priceGold: 168_000 });
    expect(parseMessage(fixture('guard_buy.cap'), ctx)).toMatchObject({ priceGold: 198_000 });
    expect(parseMessage({ cmd: 'USER_TOAST_MSG_V2', data: { sender_uinfo: { uid: 3 }, guard_info: { guard_level: 3 }, pay_info: {} } }, ctx)).not.toHaveProperty('priceGold');
    expect(guardTotal(3, 138_000, 1)).toBe(138_000);
    expect(guardTotal(3, 138_000, 3)).toBe(414_000);
    expect(guardTotal(3, 414_000, 3)).toBe(414_000);
    expect(guardTotal(2, 1_998_000, 12)).toBe(23_976_000);
    expect(guardTotal(3, 0, 1)).toBe(0);
  });

  it('续费、按年购买、缺字段', () => {
    const renew = { cmd: 'USER_TOAST_MSG', data: { uid: 1, username: 'a', guard_level: 2, num: 1, unit: '年', payflow_id: 'p', toast_msg: '<%a%> 在主播b的直播间续费了提督' } };
    expect(parseMessage(renew, ctx)).toMatchObject({ level: 2, months: 12, op: 'renew' });
    expect(parseMessage({ cmd: 'USER_TOAST_MSG', data: { uid: 1, guard_level: 0 } }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'USER_TOAST_MSG_V2', data: { guard_info: { guard_level: 3 } } }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'GUARD_BUY', data: {} }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'USER_TOAST_MSG_V2', data: { sender_uinfo: { uid: 3 }, guard_info: { guard_level: 1 }, pay_info: {} } }, ctx)).toMatchObject({ level: 1, months: 1, op: 'open', viewer: { name: '' } });
  });
});
