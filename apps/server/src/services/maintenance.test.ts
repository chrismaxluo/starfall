import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blacklist, ruleExclusive, viewers } from '../db/schema.ts';
import { testApp } from '../testing.ts';

let close: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of close) await c(); close = []; });
const setup = async () => { const t = await testApp(); close.push(() => t.app.close()); return t; };

const DAY = 86400_000;

describe('定时清理', () => {
  it('观众表：很久没出现的删除，专属用户和黑名单里的保留；保留期为 0 时不清理', async () => {
    const t = await setup();
    const old = Date.now() - 100 * DAY;
    t.ctx.db.insert(viewers).values([
      { uid: 1, name: '老观众', updatedAt: old },
      { uid: 2, name: '专属', updatedAt: old },
      { uid: 3, name: '黑名单', updatedAt: old },
      { uid: 4, name: '新观众', updatedAt: Date.now() },
    ]).run();
    const effectId = t.ctx.effects.list()[0]!.id;
    t.ctx.db.insert(ruleExclusive).values({ uid: 2, effectId, cooldownMin: 0, until: null, enabled: true }).run();
    t.ctx.db.insert(blacklist).values({ uid: 3 }).run();
    expect(t.ctx.viewers.prune(0)).toBe(0);
    expect(t.ctx.viewers.prune(90)).toBe(1);
    expect(t.ctx.db.select({ uid: viewers.uid }).from(viewers).all().map((v) => v.uid).sort()).toEqual([2, 3, 4]);
  });

  it('临时目录：超过时间的文件删除，新的保留；传 0 全部清掉', async () => {
    const t = await setup();
    const dir = t.ctx.assets.tmpDir;
    const a = path.join(dir, 'import-old.zip');
    const b = path.join(dir, 'upload-new.webm');
    fs.writeFileSync(a, 'x');
    fs.writeFileSync(b, 'y');
    const past = (Date.now() - 2 * 3600_000) / 1000;
    fs.utimesSync(a, past, past);
    expect(t.ctx.assets.cleanTmp(3600_000)).toBe(1);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(true);
    expect(t.ctx.assets.cleanTmp(0)).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
