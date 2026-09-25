// B 站新版 protobuf 消息的结构定义（只列出用到的字段；未列出的字段会被安全忽略）。
// 字段号来自 P0 实测，见 docs/bili-protocol.md。标注"推测"的字段需要在实际运行中确认。
import protobuf from 'protobufjs';

const root = protobuf.Root.fromJSON({
  nested: {
    Base: { fields: { name: { type: 'string', id: 1 }, face: { type: 'string', id: 2 } } },
    Medal: {
      fields: {
        name: { type: 'string', id: 1 },
        level: { type: 'int32', id: 2 },
        isLight: { type: 'int32', id: 9 },
        ruid: { type: 'int64', id: 10 },
        guardLevel: { type: 'int32', id: 11 }, // 推测
        v2ColorStart: { type: 'string', id: 15 },
        v2ColorEnd: { type: 'string', id: 16 },
        v2ColorBorder: { type: 'string', id: 17 },
        v2ColorText: { type: 'string', id: 18 },
        v2ColorLevel: { type: 'string', id: 19 },
      },
    },
    Wealth: { fields: { level: { type: 'int32', id: 1 } } },
    Guard: { fields: { level: { type: 'int32', id: 1 } } }, // 推测
    UserInfo: {
      fields: {
        uid: { type: 'int64', id: 1 },
        base: { type: 'Base', id: 2 },
        medal: { type: 'Medal', id: 3 },
        wealth: { type: 'Wealth', id: 4 },
        guard: { type: 'Guard', id: 6 }, // 推测
      },
    },
    FansMedal: {
      fields: {
        targetId: { type: 'int64', id: 1 },
        level: { type: 'int32', id: 2 },
        name: { type: 'string', id: 3 },
        isLighted: { type: 'int32', id: 8 }, // 推测
        guardLevel: { type: 'int32', id: 9 }, // 推测
      },
    },
    InteractWord: {
      fields: {
        uid: { type: 'int64', id: 1 },
        uname: { type: 'string', id: 2 },
        msgType: { type: 'int32', id: 5 },
        roomid: { type: 'int64', id: 6 },
        timestamp: { type: 'int64', id: 7 },
        fansMedal: { type: 'FansMedal', id: 9 },
        uinfo: { type: 'UserInfo', id: 22 },
      },
    },
    GiftInfo: {
      fields: {
        giftId: { type: 'int64', id: 1 },
        giftName: { type: 'string', id: 2 },
        num: { type: 'int32', id: 3 },
        price: { type: 'int64', id: 5 },
        totalCoin: { type: 'int64', id: 7 },
        coinType: { type: 'string', id: 8 },
        timestamp: { type: 'int64', id: 10 },
        comboIndex: { type: 'int32', id: 11 },
        batchComboId: { type: 'string', id: 12 },
        comboTotalCoin: { type: 'int64', id: 14 },
      },
    },
    SendGift: {
      fields: {
        uid: { type: 'int64', id: 1 },
        uname: { type: 'string', id: 2 },
        face: { type: 'string', id: 3 },
        gift: { type: 'GiftInfo', id: 10 },
        senderUinfo: { type: 'UserInfo', id: 15 },
      },
    },
  },
});

export interface PbMedal {
  name?: string;
  level?: number;
  isLight?: number;
  ruid?: number;
  guardLevel?: number;
  v2ColorStart?: string;
  v2ColorEnd?: string;
  v2ColorBorder?: string;
  v2ColorText?: string;
  v2ColorLevel?: string;
}
export interface PbUserInfo {
  uid?: number;
  base?: { name?: string; face?: string };
  medal?: PbMedal;
  wealth?: { level?: number };
  guard?: { level?: number };
}
export interface PbInteractWord {
  uid?: number;
  uname?: string;
  msgType?: number;
  roomid?: number;
  timestamp?: number;
  fansMedal?: { targetId?: number; level?: number; name?: string; isLighted?: number; guardLevel?: number };
  uinfo?: PbUserInfo;
}
export interface PbSendGift {
  uid?: number;
  uname?: string;
  face?: string;
  gift?: {
    giftId?: number;
    giftName?: string;
    num?: number;
    price?: number;
    totalCoin?: number;
    coinType?: string;
    timestamp?: number;
    comboIndex?: number;
    batchComboId?: string;
    comboTotalCoin?: number;
  };
  senderUinfo?: PbUserInfo;
}

const opts = { longs: Number, defaults: false } as const;

function decoder<T>(name: string) {
  const type = root.lookupType(name);
  return (b64: string): T => type.toObject(type.decode(Buffer.from(b64, 'base64')), opts) as T;
}

export const decodeInteractWord = decoder<PbInteractWord>('InteractWord');
export const decodeSendGift = decoder<PbSendGift>('SendGift');

/** 测试用：按同样的结构编码（生成脱敏样本） */
export function encodePb(name: 'InteractWord' | 'SendGift', obj: object): string {
  const type = root.lookupType(name);
  return Buffer.from(type.encode(type.fromObject(obj)).finish()).toString('base64');
}
