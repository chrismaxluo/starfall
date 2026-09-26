import { describe, expect, it } from 'vitest';
import { parseMessage } from './parse.ts';
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

  it('财富等级触发的进场特效：没有大航海', () => {
    expect(parseMessage(fixture('entry_effect.wealth'), ctx)).toMatchObject({ viewer: { uid: 10004, name: '测试富', guard: 0 } });
  });
});

describe('弹幕 DANMU_MSG', () => {
  it('内容、UID、昵称、提督、房管、粉丝牌', () => {
    const ev = parseMessage(fixture('danmu_msg.guard-mod'), ctx);
    expect(ev).toMatchObject({ kind: 'danmu', text: '主播生日快乐！', ts: 1790000004000 });
    if (ev?.kind !== 'danmu') throw new Error();
    expect(ev.viewer).toMatchObject({ uid: 10005, name: '测试提督', guard: 2, isMod: true, medal: { name: '测试牌', level: 39, anchorUid: FIXTURE_ANCHOR } });
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
  it('续费、按年购买、缺字段', () => {
    const renew = { cmd: 'USER_TOAST_MSG', data: { uid: 1, username: 'a', guard_level: 2, num: 1, unit: '年', payflow_id: 'p', toast_msg: '<%a%> 在主播b的直播间续费了提督' } };
    expect(parseMessage(renew, ctx)).toMatchObject({ level: 2, months: 12, op: 'renew' });
    expect(parseMessage({ cmd: 'USER_TOAST_MSG', data: { uid: 1, guard_level: 0 } }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'USER_TOAST_MSG_V2', data: { guard_info: { guard_level: 3 } } }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'GUARD_BUY', data: {} }, ctx)).toBeNull();
    expect(parseMessage({ cmd: 'USER_TOAST_MSG_V2', data: { sender_uinfo: { uid: 3 }, guard_info: { guard_level: 1 }, pay_info: {} } }, ctx)).toMatchObject({ level: 1, months: 1, op: 'open', viewer: { name: '' } });
  });
});
