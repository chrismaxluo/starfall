// 用正式的 bili 包连接真实直播间，打印解析出的事件（不显示观众昵称，只显示统计）。
// 用法：node spike/live-check.ts <房间号> [秒数]
import fs from 'node:fs';
import path from 'node:path';
import { BiliHttp, LiveClient, WbiSigner, getDanmuInfo, getRoomAdmins, getRoomInit, parseMessage } from '../packages/bili/src/index.ts';
import { EnterMerger, matchEnter } from '../packages/core/src/index.ts';

const roomArg = Number(process.argv[2]);
const seconds = Number(process.argv[3] || 60);
const account = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../data/bili-account.json'), 'utf8'));
const http = new BiliHttp(account.cookies);
const wbi = new WbiSigner(http);
const room = await getRoomInit(http, roomArg);
const admins = new Set((await getRoomAdmins(http, room.roomId)).map((a) => a.uid));
console.log(`房间 ${room.roomId}，主播 ${room.anchorUid}，${room.liveStatus === 1 ? '直播中' : '未开播'}，房管 ${admins.size} 人`);
const buvid = await http.ensureBuvid();
let seq = 0;
const ctx = { newId: () => String(++seq), now: () => Date.now(), isMod: (uid: number) => admins.has(uid) };
const merger = new EnterMerger();
const rules = {
  tiers: { gov: { effectId: 1, cooldownMin: 5, enabled: true }, adm: { effectId: 2, cooldownMin: 5, enabled: true }, cap: { effectId: 3, cooldownMin: 5, enabled: true }, mod: { effectId: 4, cooldownMin: 10, enabled: true }, nor: { effectId: 6, cooldownMin: 30, enabled: true } },
  bands: [{ fromLevel: 21, effectId: 5, cooldownMin: 10, enabled: true }, { fromLevel: 1, effectId: 5, cooldownMin: 15, enabled: true }],
  exclusives: [], cooldownMode: 'minutes' as const,
};
const today = new Date().toISOString().slice(0, 10);
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] || 0) + 1);
const onEnter = (ev: import('../packages/shared/src/index.ts').EnterEvent) => bump(matchEnter(ev.viewer, { rules, anchorUid: room.anchorUid, today })?.label ?? '进场 · 未命中');
function handle(raw: { cmd?: string; [k: string]: unknown }) {
  if (process.env.DEBUG && (raw.cmd === 'INTERACT_WORD_V2' || raw.cmd === 'ENTRY_EFFECT')) {
    let r: unknown;
    try { r = parseMessage(raw, { ...ctx, newId: () => 'dbg' }); } catch (e) { r = 'ERR ' + (e as Error).message; }
    const v = r as { kind?: string; source?: string; viewer?: { uid: number } } | null;
    console.log('DEBUG', raw.cmd, v && typeof v === 'object' ? `${v.kind}/${v.source}/uid=${(v.viewer?.uid ?? 0) > 0}` : String(r));
  }
  bump(`消息 ${raw.cmd}`);
  let ev;
  try { ev = parseMessage(raw, ctx); } catch (e) { bump('解析失败 ' + (e as Error).message); return; }
  if (!ev) { if (/INTERACT|ENTRY/.test(raw.cmd ?? '')) bump(`${raw.cmd} → 未产生事件`); return; }
  if (ev.kind === 'enter') { try { for (const e of merger.push(ev, Date.now())) onEnter(e); } catch (e) { bump('处理失败 ' + (e as Error).stack?.split('\n').slice(0, 2).join(' ')); } }
  else bump(`事件 ${ev.kind}`);
}
const client = new LiveClient({
  roomId: room.roomId, uid: http.uid, buvid,
  getDanmuInfo: () => getDanmuInfo(http, wbi, room.roomId),
  onState: (s, d) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 连接状态：${s}${d ? `（${d}）` : ''}`),
  onMessage: (raw) => handle(raw),
});
const flush = setInterval(() => { for (const e of merger.flush(Date.now())) onEnter(e); }, 200);
if (process.env.REPLAY) {
  for (const line of fs.readFileSync(process.env.REPLAY, 'utf8').split('\n').filter(Boolean)) handle(JSON.parse(JSON.parse(line).raw));
  for (const e of merger.flush(Date.now() + 10_000)) onEnter(e);
  for (const [k, v] of Object.entries(counts).sort()) console.log(String(v).padStart(5), k);
  process.exit(0);
}
client.start();
setTimeout(() => {
  client.stop(); clearInterval(flush);
  const lines = Object.entries(counts).sort().filter(([k]) => !k.startsWith('消息 ') || /INTERACT|ENTRY|DANMU|GIFT|LIVE|PREPARING/.test(k));
  // 写完再退出：管道输出是异步的，直接被结束会丢掉最后几行
  process.stdout.write(lines.map(([k, v]) => `${String(v).padStart(5)} ${k}`).join('\n') + '\n', () => process.exit(0));
}, seconds * 1000);
