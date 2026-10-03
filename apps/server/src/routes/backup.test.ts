import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DANMU_WHO_ALL, danmuWhoFromOld } from '@starfall/shared';
import { KEEP_BACKUPS, KEEP_MANUAL } from '../services/backup.ts';
import { formFile, media, testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of close) await c();
  close = [];
});
const setup = async () => {
  const t = await testApp();
  close.push(() => t.app.close());
  const req = await t.login();
  const effectId = async (name: string) => ((await req({ method: 'GET', url: '/api/effects' })).json().effects as Array<{ id: number; name: string }>).find((e) => e.name === name)?.id;
  return { ...t, req, effectId };
};
type T = Awaited<ReturnType<typeof setup>>;

/** 准备一套有内容的配置：上传的素材、弹幕规则、专属用户、指定礼物、黑名单、第二个输出、改过的设置 */
async function populate(t: T): Promise<void> {
  const up = (await t.req({ method: 'POST', url: '/api/assets', ...formFile('生日.webm', media('alpha.webm')) })).json();
  const bday = up.effect.id as number;
  await t.req({ method: 'PUT', url: `/api/effects/${bday}`, payload: { showText: true, texts: { enter: ['{name} 生日快乐'] } } });
  const sound = (await t.req({ method: 'POST', url: '/api/sounds', ...formFile('叮.wav', media('beep.wav')) })).json().sound.id as number;
  await t.req({ method: 'PUT', url: `/api/effects/${bday}`, payload: { soundAssetId: sound } });
  await t.req({ method: 'POST', url: '/api/rules/danmu', payload: { keywords: ['生日快乐', '生快'], mode: 'contains', who: DANMU_WHO_ALL, effectId: bday, globalCdSec: 10, userCdMin: 5, enabled: true } });
  await t.req({ method: 'POST', url: '/api/rules/exclusive', payload: { uid: 10001, effectId: bday, cooldownMin: 0, until: '2026-12-31', enabled: true } });
  const gift = (await t.req({ method: 'GET', url: '/api/rules/gift' })).json();
  gift.specific = [{ giftId: 31036, giftName: '小花花', effectId: bday, enabled: true }];
  await t.req({ method: 'PUT', url: '/api/rules/gift', payload: gift });
  await t.req({ method: 'POST', url: '/api/blacklist', payload: { uid: 10009, name: '欢迎机器人', note: '刷屏' } });
  await t.req({ method: 'POST', url: '/api/outputs', payload: { name: '横屏录播', app: 'obs', orient: 'landscape', width: 1920, height: 1080 } });
  await t.req({ method: 'PUT', url: '/api/settings', payload: { queueMax: 15, cooldownMode: 'oncePerLive' } });
}

const importFile = (t: T, name: string, content: Buffer | string) => t.req({ method: 'POST', url: '/api/backup/import', ...formFile(name, content) });

describe('导出配置', () => {
  it('JSON 里用名称和文件哈希关联，不含登录信息、密码和特效页密钥', async () => {
    const t = await setup();
    await populate(t);
    const res = await t.req({ method: 'GET', url: '/api/backup/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="starfall-config-\d{8}-\d{4}\.json"$/);
    const f = res.json();
    expect(f).toMatchObject({ format: 'starfall-config', version: 2 });
    expect(f.rules.danmu).toEqual([{ keywords: ['生日快乐', '生快'], mode: 'contains', who: DANMU_WHO_ALL, effect: '生日', globalCdSec: 10, userCdMin: 5, enabled: true }]);
    expect(f.rules.exclusives[0]).toMatchObject({ uid: 10001, effect: '生日', until: '2026-12-31' });
    expect(f.rules.enter.tiers.gov.effect).toBe('金銮');
    expect(f.settings).toMatchObject({ queueMax: 15, cooldownMode: 'oncePerLive' });
    expect(f.settings).not.toHaveProperty('paused');
    expect(f.assets.map((a: { kind: string }) => a.kind).sort()).toEqual(['audio', 'video']);
    expect(f.outputs.map((o: { name: string }) => o.name)).toEqual(['竖屏直播', '横屏录播']);
    const text = res.body;
    for (const o of t.ctx.outputs.list()) expect(text).not.toContain(o.key);
    expect(text).not.toMatch(/cookie|SESSDATA|password|refresh/i);
  });

  it('?files=1 连同素材文件打包成 zip', async () => {
    const t = await setup();
    await populate(t);
    const res = await t.req({ method: 'GET', url: '/api/backup/export?files=1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const names = [...res.rawPayload.toString('latin1').matchAll(/files\/[0-9a-f]{64}\.(webm|wav)/g)].map((m) => m[0]);
    expect(new Set(names).size).toBe(2);
  });
});

describe('导入配置', () => {
  it('先预览、确认后才生效；zip 带文件时上传的素材一起恢复', async () => {
    const src = await setup();
    await populate(src);
    const zip = (await src.req({ method: 'GET', url: '/api/backup/export?files=1' })).rawPayload;

    const dst = await setup();
    const pre = await importFile(dst, 'starfall-backup.zip', zip);
    expect(pre.statusCode).toBe(200);
    const { token, plan } = pre.json();
    const sec = Object.fromEntries(plan.sections.map((s: { key: string; summary: string }) => [s.key, s.summary]));
    expect(sec).toMatchObject({ effects: '新增 1', danmu: '0 条 → 1 条', exclusive: '新增 1', blacklist: '新增 1 人（已有的保留）', outputs: '新增 1', guard: '没有变化' });
    expect(plan.sections.find((s: { key: string }) => s.key === 'settings').details).toEqual(['进场冷却方式：按分钟 → 每场一次', '最多排队数：10 → 15']);
    expect(plan.warnings).toEqual([]);
    expect(plan.files).toEqual({ needed: 2, missing: 0 });

    // 确认前什么都没变
    expect((await dst.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules).toEqual([]);
    expect(await dst.effectId('生日')).toBeUndefined();

    const ok = await dst.req({ method: 'POST', url: `/api/backup/import/${token}` });
    expect(ok.json()).toMatchObject({ ok: true, savedFiles: 2 });
    const bday = await dst.effectId('生日');
    expect(bday).toBeDefined();
    const eff = (await dst.req({ method: 'GET', url: `/api/effects/${bday}` })).json();
    expect(eff).toMatchObject({ showText: true, texts: { enter: ['{name} 生日快乐'] }, asset: { kind: 'video' }, sound: { kind: 'audio' } });
    expect((await dst.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules[0]).toMatchObject({ keywords: ['生日快乐', '生快'], effectId: bday });
    expect((await dst.req({ method: 'GET', url: '/api/rules/exclusive' })).json().exclusives[0]).toMatchObject({ uid: 10001, effectId: bday });
    expect((await dst.req({ method: 'GET', url: '/api/rules/gift' })).json().specific).toEqual([{ giftId: 31036, giftName: '小花花', effectId: bday, enabled: true }]);
    expect((await dst.req({ method: 'GET', url: '/api/blacklist' })).json().blacklist.map((b: { uid: number }) => b.uid)).toEqual([10009]);
    expect(dst.ctx.settings.get('queueMax')).toBe(15);
    expect(dst.ctx.settings.get('cooldownMode')).toBe('oncePerLive');
    // 已有的输出保留原来的地址，新的输出有自己的密钥
    const outs = dst.ctx.outputs.list();
    expect(outs.map((o) => o.name)).toEqual(['竖屏直播', '横屏录播']);
    expect(outs[1]).toMatchObject({ orient: 'landscape', width: 1920 });

    // 再次导入同一份：没有变化；令牌只能用一次
    expect((await dst.req({ method: 'POST', url: `/api/backup/import/${token}` })).statusCode).toBe(410);
    const again = (await importFile(dst, 'starfall-backup.zip', zip)).json();
    expect(again.plan.sections.every((s: { changed: boolean }) => !s.changed)).toBe(true);
  });

  it('只导入 JSON 时缺少的文件会提示，缺文件的素材和用到它的规则不导入', async () => {
    const src = await setup();
    await populate(src);
    const json = (await src.req({ method: 'GET', url: '/api/backup/export' })).body;
    const dst = await setup();
    const { token, plan } = (await importFile(dst, 'starfall-config.json', json)).json();
    expect(plan.files).toEqual({ needed: 2, missing: 2 });
    expect(plan.warnings).toContain('素材「生日」缺少画面文件，没有导入');
    expect(plan.warnings.some((w: string) => /^专属用户 .+ 的素材找不到，这条不会导入$/.test(w))).toBe(true);
    expect(plan.warnings).toContain('规则里用到的素材「生日」找不到，这些规则会变成"未选素材"');
    await dst.req({ method: 'POST', url: `/api/backup/import/${token}` });
    expect(await dst.effectId('生日')).toBeUndefined();
    expect((await dst.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules[0]).toMatchObject({ keywords: ['生日快乐', '生快'], effectId: null });
    expect((await dst.req({ method: 'GET', url: '/api/rules/exclusive' })).json().exclusives).toEqual([]);
  });

  it('导入会整体替换规则：本机多出来的弹幕规则、专属用户被删除，素材和黑名单保留', async () => {
    const src = await setup();
    const json = (await src.req({ method: 'GET', url: '/api/backup/export' })).body;
    const dst = await setup();
    await populate(dst);
    const { token, plan } = (await importFile(dst, 'a.json', json)).json();
    expect(plan.sections.find((s: { key: string }) => s.key === 'exclusive').summary).toBe('删除 1');
    await dst.req({ method: 'POST', url: `/api/backup/import/${token}` });
    expect((await dst.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules).toEqual([]);
    expect(await dst.effectId('生日')).toBeDefined();
    expect((await dst.req({ method: 'GET', url: '/api/blacklist' })).json().blacklist).toHaveLength(1);
    expect(dst.ctx.outputs.list()).toHaveLength(2);
  });

  it('旧版本导出的文件：弹幕规则的发送人是单选，导入后换成多选', async () => {
    const src = await setup();
    await populate(src);
    const f = JSON.parse((await src.req({ method: 'GET', url: '/api/backup/export' })).body);
    f.version = 1;
    f.rules.danmu[0].who = 'fan';
    const dst = await setup();
    const { token } = (await importFile(dst, 'old.json', JSON.stringify(f))).json();
    await dst.req({ method: 'POST', url: `/api/backup/import/${token}` });
    expect((await dst.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules[0].who).toEqual(danmuWhoFromOld('fan'));
  });

  it('以前导出的文件没有弹幕列表的设置：用默认值；新文件带上这些设置', async () => {
    const src = await setup();
    await populate(src);
    src.ctx.outputs.update(src.ctx.outputs.list()[1]!.id, { chatSide: 'right', chatMedal: 'all', chatMax: 12 });
    const f = JSON.parse((await src.req({ method: 'GET', url: '/api/backup/export' })).body);
    expect(f.outputs[1]).toMatchObject({ chatEnabled: true, chatSide: 'right', chatSize: 'normal', chatMedal: 'all', chatMax: 12 });
    const old = structuredClone(f);
    for (const o of old.outputs) for (const k of ['chatEnabled', 'chatSide', 'chatSize', 'chatMedal', 'chatMax', 'chatFadeSec']) delete o[k];
    const dst = await setup();
    const { token } = (await importFile(dst, 'old.json', JSON.stringify(old))).json();
    expect((await dst.req({ method: 'POST', url: `/api/backup/import/${token}` })).statusCode).toBe(200);
    expect(dst.ctx.outputs.list()[1]).toMatchObject({ name: '横屏录播', chatEnabled: true, chatSide: 'left', chatMedal: 'own', chatMax: 8, chatFadeSec: 0 });
  });

  it('取消导入；无效的文件给出能看懂的错误', async () => {
    const t = await setup();
    const json = (await t.req({ method: 'GET', url: '/api/backup/export' })).body;
    const { token } = (await importFile(t, 'a.json', json)).json();
    expect((await t.req({ method: 'DELETE', url: `/api/backup/import/${token}` })).statusCode).toBe(200);
    expect((await t.req({ method: 'POST', url: `/api/backup/import/${token}` })).statusCode).toBe(410);
    expect(fs.readdirSync(t.ctx.assets.tmpDir).filter((f) => f.startsWith('import-'))).toEqual([]);

    const err = async (name: string, content: string | Buffer) => {
      const r = await importFile(t, name, content);
      return [r.statusCode, r.json().error?.message ?? r.json().message];
    };
    expect(await err('a.txt', 'x')).toEqual([415, '请选择星临导出的 .json 配置文件或 .zip 备份']);
    expect(await err('a.json', '{')).toEqual([400, '不是有效的配置文件（JSON 格式错误）']);
    expect(await err('a.json', '{"format":"other"}')).toEqual([400, '这不是星临导出的配置文件']);
    expect(await err('a.json', JSON.stringify({ ...JSON.parse(json), version: 99 }))).toEqual([400, '这个配置文件来自更新的版本，请先升级星临再导入']);
    expect((await err('a.json', JSON.stringify({ ...JSON.parse(json), outputs: [{ name: 'x' }] })))[0]).toBe(400);
    expect(await err('a.zip', 'not a zip')).toEqual([400, '无法读取这个 zip 文件，请确认是星临导出的备份']);
    expect(fs.readdirSync(t.ctx.assets.tmpDir).filter((f) => f.startsWith('import-'))).toEqual([]);
  });

  it('未登录不能导出或导入', async () => {
    const t = await setup();
    expect((await t.app.inject({ method: 'GET', url: '/api/backup/export' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/backup/import', ...formFile('a.json', '{}') })).statusCode).toBe(401);
  });
});

describe('自动备份', () => {
  it('立即备份：数据库和配置各一份，可以下载配置', async () => {
    const t = await setup();
    const item = (await t.req({ method: 'POST', url: '/api/backup/run' })).json();
    expect(item.stamp).toMatch(/^\d{8}-\d{6}-m$/);
    expect(item.manual).toBe(true);
    expect(item.dbSize).toBeGreaterThan(0);
    const list = (await t.req({ method: 'GET', url: '/api/backup/list' })).json();
    expect(list).toMatchObject({ autoBackup: true, keep: 7, keepManual: 5, items: [{ stamp: item.stamp }] });
    const dl = await t.req({ method: 'GET', url: `/api/backup/files/${item.config}` });
    expect(dl.json().format).toBe('starfall-config');
    expect((await t.req({ method: 'GET', url: `/api/backup/files/starfall-${item.stamp}.db` })).statusCode).toBe(400);
    expect((await t.req({ method: 'GET', url: '/api/backup/files/..%2Fstarfall.db' })).statusCode).toBe(400);
    expect((await t.req({ method: 'GET', url: '/api/backup/files/starfall-20000101-0000.json' })).statusCode).toBe(404);
    // 备份出来的数据库是完整的
    const dir = path.join(t.dataDir, 'backups');
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, `starfall-${item.stamp}.db`)).mode & 0o777).toBe(0o600);
  });

  it('每天凌晨 4 点后备份一次，只保留最近 7 份；关闭后不备份', async () => {
    const t = await setup();
    const b = t.ctx.backups;
    // 北京时间 2026-09-01 03:00 还不到时间；04:10 备份；同一天不再备份
    const day = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h - 8, m);
    expect(await b.tick(day(1, 3))).toBe(false);
    expect(await b.tick(day(1, 4, 10))).toBe(true);
    expect(await b.tick(day(1, 23))).toBe(false);
    expect(b.list()[0]!.stamp).toBe('20260901-0410');
    for (let d = 2; d <= 10; d++) expect(await b.tick(day(d, 5))).toBe(true);
    const stamps = b.list().map((x) => x.stamp);
    expect(stamps).toHaveLength(KEEP_BACKUPS);
    expect(stamps[0]).toBe('20260910-0500');
    expect(stamps.at(-1)).toBe('20260904-0500');
    expect(fs.readdirSync(path.join(t.dataDir, 'backups'))).toHaveLength(KEEP_BACKUPS * 2);
    await t.req({ method: 'PUT', url: '/api/settings', payload: { autoBackup: false } });
    expect(await b.tick(day(11, 5))).toBe(false);
  });

  it('手动备份单独保留，不会挤掉自动备份；同一分钟多次也不会互相覆盖；当天手动备份过也照常自动备份', async () => {
    const t = await setup();
    const b = t.ctx.backups;
    const at = (d: number, h: number, m = 0, s = 0) => Date.UTC(2026, 8, d, h - 8, m, s);
    for (let d = 1; d <= 3; d++) await b.tick(at(d, 5));
    for (let i = 0; i < 8; i++) await b.run(at(3, 12, 0, i), true);
    const list = b.list();
    expect(list.filter((x) => !x.manual)).toHaveLength(3);
    expect(list.filter((x) => x.manual)).toHaveLength(KEEP_MANUAL);
    expect(list.filter((x) => x.manual)[0]!.stamp).toBe('20260903-120007-m');
    await b.run(at(4, 2), true);
    expect(await b.tick(at(4, 5))).toBe(true);
  });
});

describe('从备份恢复', () => {
  it('选一份备份先预览，确认后恢复；恢复前自动再备份一份现在的配置', async () => {
    const t = await setup();
    await populate(t);
    const item = (await t.req({ method: 'POST', url: '/api/backup/run' })).json();
    // 备份之后又删掉了弹幕规则
    const rules = (await t.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules as Array<{ id: number }>;
    for (const r of rules) await t.req({ method: 'DELETE', url: `/api/rules/danmu/${r.id}` });
    expect((await t.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules).toHaveLength(0);
    const pre = await t.req({ method: 'POST', url: `/api/backup/restore/${item.config}` });
    expect(pre.statusCode).toBe(200);
    const { token, filename } = pre.json();
    expect(filename).toBe(item.config);
    const before = (await t.req({ method: 'GET', url: '/api/backup/list' })).json().items.length;
    // 备份名字精确到秒：隔开一秒，免得和上面那份同名
    await new Promise((r) => setTimeout(r, 1100));
    const ok = (await t.req({ method: 'POST', url: `/api/backup/import/${token}` })).json();
    expect(ok.backup).toMatch(/-m$/);
    expect((await t.req({ method: 'GET', url: '/api/rules/danmu' })).json().rules).toHaveLength(1);
    // 恢复前多了一份手动备份；原来那份备份文件还在
    expect((await t.req({ method: 'GET', url: '/api/backup/list' })).json().items.length).toBe(before + 1);
    expect((await t.req({ method: 'GET', url: `/api/backup/files/${item.config}` })).statusCode).toBe(200);
  });
  it('不存在的备份、乱写的名字', async () => {
    const t = await setup();
    expect((await t.req({ method: 'POST', url: '/api/backup/restore/starfall-20200101-0400.json' })).statusCode).toBe(404);
    expect((await t.req({ method: 'POST', url: '/api/backup/restore/..%2Fsecret.json' })).statusCode).toBe(400);
  });
});
