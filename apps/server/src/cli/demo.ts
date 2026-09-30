// 演示用的服务（给 README 截图）：用真实的程序，但直播间、账号、观众、礼物全是编的，不连 B 站弹幕服务器。
// 用临时数据目录运行，不要指向正式数据：
//   STARFALL_DATA=/tmp/starfall-demo STARFALL_PORT=17601 node apps/server/src/cli/demo.ts
// 启动后打印后台密码和特效页地址。B 站的头像框、荣耀勋章、船锚图标还是运行时从 B 站加载（只引用地址）。
import fs from 'node:fs';
import type { ClientState, GuardPage, ListViewer, OnlineRank } from '@starfall/bili';
import type { StdEvent, Viewer } from '@starfall/shared';
import { buildApp } from '../app.ts';
import { loadConfig, paths } from '../config.ts';
import { createContext, startBackground } from '../context.ts';
import { account, room, ruleExclusive, viewers } from '../db/schema.ts';

const config = loadConfig();
if (fs.existsSync(paths(config.dataDir).db)) throw new Error(`${config.dataDir} 里已经有数据库：演示服务只能用空的临时目录`);

const ROOM = 10086000;
const ANCHOR = 20001;
const now = Date.now();
const LIVE_SINCE = now - (2 * 3600 + 14 * 60) * 1000;

type Person = { uid: number; name: string; guard?: 0 | 1 | 2 | 3; honor?: number; medal?: number; mod?: boolean; score?: number };
const P: Person[] = [
  { uid: 101, name: '长夜未央', guard: 1, honor: 68, medal: 44, score: 52000 },
  { uid: 102, name: '月下独酌', guard: 2, mod: true, honor: 53, medal: 38, score: 21000 },
  { uid: 103, name: '白开水不加糖', honor: 61, medal: 22, score: 8800 },
  { uid: 104, name: '听雨的鲸', guard: 3, honor: 44, medal: 31, score: 3180 },
  { uid: 105, name: '半糖主义', guard: 3, honor: 37, medal: 27, score: 1330 },
  { uid: 106, name: '星河漫步', guard: 3, honor: 21, medal: 26, score: 900 },
  { uid: 107, name: '南山有鹿', honor: 33, medal: 18, score: 120 },
  { uid: 108, name: '晚风与你', honor: 28, medal: 21, score: 66 },
  { uid: 109, name: '青柠汽水', mod: true, honor: 12, medal: 15, score: 30 },
  { uid: 110, name: '今天也要早睡', honor: 17, medal: 9, score: 12 },
  { uid: 111, name: '路过的猫', honor: 5, score: 4 },
  { uid: 112, name: '一颗柠檬糖', honor: 9, score: 2 },
];
const MISSING = ['雾里看花', '一只小企鹅', '栗子不甜', '夏至未至', '深海的鱼', '阿白', '橘子汽水', '晴天娃娃', '慢慢来', '白日梦想家', '温柔的风', '小熊软糖'];
const by = (name: string) => P.find((p) => p.name === name)!;
const medalOf = (p: Person) => (p.medal ? { name: '星临', level: p.medal, anchorUid: ANCHOR } : undefined);
const viewer = (p: Person): Viewer => ({ uid: p.uid, name: p.name, guard: p.guard ?? 0, isMod: Boolean(p.mod), ...(medalOf(p) ? { medal: medalOf(p)! } : {}), ...(p.honor ? { honor: p.honor } : {}), mystery: false });
const listViewer = (p: Person): ListViewer => ({ uid: p.uid, name: p.name, face: '', guard: p.guard ?? 0, honor: p.honor ?? 0, ...(medalOf(p) ? { medal: medalOf(p)! } : {}), mystery: false });

// 封面：一张渐变图
const cover = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2B2B6E"/><stop offset=".55" stop-color="#6E4BD8"/><stop offset="1" stop-color="#E0689B"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><g fill="#fff" opacity=".85"><circle cx="90" cy="70" r="2"/><circle cx="520" cy="60" r="1.6"/><circle cx="420" cy="120" r="1.2"/><circle cx="160" cy="260" r="1.4"/><circle cx="580" cy="250" r="2"/></g><text x="320" y="200" font-family="sans-serif" font-size="64" font-weight="700" fill="#fff" text-anchor="middle" opacity=".92">今晚听歌</text></svg>`)}`;

const online: OnlineRank = { count: 268, items: [...P].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p, i) => ({ ...listViewer(p), rank: i + 1, score: p.score ?? 0 })) };
const fleetMembers: ListViewer[] = [...P.filter((p) => p.guard), ...MISSING.map((name, i) => ({ uid: 900 + i, name, guard: 3 as const }))].map((p) => listViewer(p));

const ctx = createContext(config, {
  fetchGifts: async () => [],
  audience: {
    fetchOnline: async () => online,
    fetchGuards: async (_h, _r, _a, page): Promise<GuardPage> => ({ total: fleetMembers.length, pages: 1, items: page === 1 ? fleetMembers : [] }),
  },
  liveDeps: {
    getRoomInit: async () => ({ roomId: ROOM, shortId: 0, anchorUid: ANCHOR, liveStatus: 1, isPortrait: true, liveSince: LIVE_SINCE }),
    getRoomAdmins: async () => [{ uid: 109, name: '青柠汽水', face: '' }, { uid: 102, name: '月下独酌', face: '' }],
    getDanmuInfo: async () => ({ token: 'demo', hosts: [{ host: '127.0.0.1', wssPort: 1 }] }),
    // 假的弹幕连接：一连上就推几条直播间数据（看过、高能榜、点赞、粉丝）
    createClient: (o) => {
      let state: ClientState = 'idle';
      return {
        start: () => {
          state = 'connected';
          o.onState?.('connected');
          setTimeout(() => {
            o.onMessage({ cmd: 'WATCHED_CHANGE', data: { num: 12580 } });
            o.onMessage({ cmd: 'ONLINE_RANK_COUNT', data: { count: online.count } });
            o.onMessage({ cmd: 'LIKE_INFO_V3_UPDATE', data: { click_count: 34567 } });
            o.onMessage({ cmd: 'ROOM_REAL_TIME_MESSAGE_UPDATE', data: { fans: 128_000, fans_club: 2140 } });
          }, 1500);
        },
        stop: () => void (state = 'idle'),
        get state() {
          return state;
        },
      };
    },
    now: Date.now,
  },
  roomInfoDeps: {
    getRoomInfo: async () => ({ roomId: ROOM, anchorUid: ANCHOR, title: '周三夜聊｜今天也来听歌吧', liveStatus: 1, liveTime: '', liveSince: LIVE_SINCE, isPortrait: true, parentAreaName: '虚拟主播', areaName: '虚拟日常', cover, keyframe: '', followers: 128_000 }),
    getAnchorInfo: async () => ({ uid: ANCHOR, name: '星临演示主播', face: '', followers: 128_000 }),
    getLiveCounts: async () => ({ likes: 34567, watched: 12580 }),
    now: Date.now,
  },
});

// ---- 编的数据 ----
const db = ctx.db;
db.insert(room).values({ id: 1, roomId: ROOM, anchorUid: ANCHOR, anchorName: '星临演示主播' }).run();
db.insert(account).values({ id: 1, uid: 30001, name: '星临小助手', face: '', cookiesEnc: ctx.secret.encrypt(JSON.stringify({ SESSDATA: 'demo', DedeUserID: '30001', buvid3: 'demo' })), expiresAt: now + 172 * 86400_000 }).run();
ctx.settings.set('onboarded' as never, true as never);
for (const p of P) db.insert(viewers).values({ uid: p.uid, name: p.name, face: '', guard: p.guard ?? 0, guardRoom: ROOM, honor: p.honor ?? 0, updatedAt: now }).run();

const effects = ctx.effects.list();
const eff = (name: string) => effects.find((e) => e.name === name)!.id;
db.insert(ruleExclusive).values([{ uid: 101, effectId: eff('金銮'), cooldownMin: 30, until: null, enabled: true }, { uid: 103, effectId: eff('晶耀'), cooldownMin: 60, until: null, enabled: true }]).run();
ctx.danmuRules.create({ keywords: ['晚安', '好梦'], mode: 'contains', who: { all: false, anchor: true, mod: true, guards: [1, 2, 3], fanMin: 20, honorMin: null, uids: [] }, effectId: eff('晶语'), globalCdSec: 10, userCdMin: 10, enabled: true });
ctx.danmuRules.create({ keywords: ['打卡'], mode: 'exact', who: { all: false, anchor: false, mod: false, guards: [], fanMin: null, honorMin: 30, uids: [] }, effectId: eff('晶语'), globalCdSec: 30, userCdMin: 60, enabled: true });

type Ev = Exclude<StdEvent, { kind: 'live' }>;
const log = (ev: Ev, status: 'played' | 'no_rule' | 'cooldown', rule: string | null = null, effect: string | null = null) =>
  ctx.log.record(ev, { roomId: ROOM, sessionId: null, rule, effectId: effect ? eff(effect) : null, status });
let t = now - 40 * 60_000;
const at = (sec: number) => (t += sec * 1000);
const enter = (n: string, s: 'played' | 'no_rule' | 'cooldown', rule: string | null, e: string | null, sec = 40) => log({ kind: 'enter', id: `e${t}`, ts: at(sec), source: 'interact', viewer: viewer(by(n)) }, s, rule, e);
const danmu = (n: string, text: string, sec = 25) => {
  const ev = { kind: 'danmu' as const, id: `d${t}`, ts: at(sec), viewer: viewer(by(n)), text };
  log(ev, 'no_rule');
  // 弹幕列表里也放上这些
  ctx.hub.toChat(ctx.pipeline.chatItem(ev));
};
const gift = (n: string, giftName: string, unitPrice: number, count: number, e: string | null, sec = 30) =>
  log({ kind: 'gift', id: `g${t}`, ts: at(sec), viewer: viewer(by(n)), giftId: 1, giftName, unitPrice, count, paid: true }, e ? 'played' : 'no_rule', e ? '礼物 · 单次 10 – 100 元' : null, e);

enter('星河漫步', 'played', '进场 · 舰长', '门楼');
enter('半糖主义', 'played', '进场 · 舰长', '门楼');
danmu('晚风与你', '晚上好呀');
enter('南山有鹿', 'no_rule', null, null);
gift('半糖主义', '告白花束', 22000, 1, '晶礼');
enter('月下独酌', 'played', '进场 · 提督', '亭阁');
danmu('月下独酌', '来了来了');
gift('白开水不加糖', '天空之翼', 1_314_000, 1, '晶耀');
enter('听雨的鲸', 'played', '进场 · 舰长', '门楼');
log({ kind: 'guard', id: 'u1', ts: at(20), viewer: viewer(by('听雨的鲸')), level: 3, months: 1, op: 'renew', source: 'toast', priceGold: 138_000 }, 'played', '上舰 · 续费舰长', '门楼');
danmu('今天也要早睡', '打卡');
gift('月下独酌', '小花花', 100, 66, null);
log({ kind: 'sc', id: 's1', ts: at(30), viewer: viewer(by('白开水不加糖')), text: '生日快乐！今天也要开心', priceYuan: 50, scId: 'demo-1' }, 'no_rule');
enter('路过的猫', 'no_rule', null, null);
danmu('青柠汽水', '欢迎新来的朋友～');
gift('长夜未央', '星愿水晶球', 100_000, 1, '晶礼');
enter('晚风与你', 'played', '进场 · 粉丝牌 21 级及以上', '霜玻');
danmu('南山有鹿', '这首歌好好听');
enter('一颗柠檬糖', 'no_rule', null, null, 20);
enter('长夜未央', 'played', '进场 · 专属 长夜未央', '金銮', 15);

// ---- 启动 ----
const app = await buildApp(ctx, { logger: false });
await startBackground(ctx);
await app.listen({ port: config.port, host: '127.0.0.1' });
const out = ctx.outputs.list()[0]!;
process.stdout.write(`演示服务已启动：http://127.0.0.1:${config.port}/\n后台密码：${ctx.initialPassword}\n特效页：http://127.0.0.1:${config.port}/overlay/?output=${out.id}&key=${out.key}\n弹幕列表：http://127.0.0.1:${config.port}/overlay/?output=${out.id}&key=${out.key}&chat=1\n`);

// 弹幕列表：每隔几秒来一条编的弹幕（只进弹幕列表，不触发特效、不写记录）
const LINES = ['晚上好呀', '来了来了[dog]', '主播今天好好看[比心]', '这首歌好听！', '打卡[花]', '前排[吃瓜]', '刚下班，赶上了', '主播唱一首晴天吧', '666', '[鼓掌][鼓掌]', '今天播到几点呀', '笑死我了[大笑]'];
const EMOTS: Record<string, string> = {
  '[dog]': 'https://i0.hdslb.com/bfs/live/4428c84e694fbf4e0ef6c06e958d9352c3582740.png',
  '[比心]': 'https://i0.hdslb.com/bfs/live/4e029593562283f00d39b99e0557878c4199c71d.png',
  '[花]': 'https://i0.hdslb.com/bfs/live/7dd2ef03e13998575e4d8a803c6e12909f94e72b.png',
  '[吃瓜]': 'https://i0.hdslb.com/bfs/live/ffb53c252b085d042173379ac724694ce3196194.png',
  '[鼓掌]': 'https://i0.hdslb.com/bfs/live/d581d0bc30c8f9712b46ec02303579840c72c42d.png',
  '[大笑]': 'https://i0.hdslb.com/bfs/live/e2589d086df0db8a7b5ca2b1273c02d31d4433d4.png',
};
let n = 0;
setInterval(() => {
  const p = P[(n * 7) % P.length]!;
  const text = LINES[n++ % LINES.length]!;
  const emots = Object.fromEntries(Object.entries(EMOTS).filter(([k]) => text.includes(k)));
  ctx.hub.toChat(ctx.pipeline.chatItem({ kind: 'danmu', id: `live${n}`, ts: Date.now(), viewer: viewer(p), text, ...(Object.keys(emots).length ? { emots } : {}) }));
}, 2500).unref();
