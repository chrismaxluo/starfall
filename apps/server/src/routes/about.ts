// 关于：版本、有没有新版本、运行信息（后台「关于」页面用）
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { paths } from '../config.ts';
import { parseBody } from '../http.ts';

/** 正式版从这里读最新的发布（只用来比较版本号，页面上不显示地址） */
const RELEASES_API = 'https://api.github.com/repos/chrismaxluo/starfall/releases/latest';
/** 查到的最新版本记多久 */
const LATEST_TTL_MS = 3600_000;
const SERVER_DIR = path.resolve(import.meta.dirname, '../..');

function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8')) as { version?: string }).version ?? '未知';
  } catch {
    return '未知';
  }
}

/** 代码目录是 git 仓库时，正好在正式版标签上返回标签（v1.4.0），否则返回提交编号；不是仓库、没装 git 时为 null */
function gitDescribe(): Promise<string | null> {
  return new Promise((resolve) => {
    // 服务用单独的账号运行，代码目录属于 root：加 safe.directory，不然 git 会拒绝读。只认 v 开头的版本标签
    execFile('git', ['-c', 'safe.directory=*', 'describe', '--tags', '--match', 'v*', '--always'], { cwd: SERVER_DIR, timeout: 3000 }, (err, out) => {
      const d = err ? '' : out.trim();
      // v1.4.0-27-gc8d9f5e → c8d9f5e
      resolve(d ? (/-g([0-9a-f]+)$/.exec(d)?.[1] ?? d) : null);
    });
  });
}

/** 比较两个 x.y.z 版本号：a 比 b 新返回正数 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** 目录里所有文件的大小（字节），读不到的跳过 */
function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else {
      try {
        total += fs.statSync(p).size;
      } catch {
        // 刚好被删掉
      }
    }
  }
  return total;
}

const fileSize = (p: string) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};

export interface LatestRelease {
  version: string;
  publishedAt: string | null;
}

export function aboutRoutes(app: FastifyInstance, ctx: AppContext): void {
  const version = readVersion();
  const describe = gitDescribe();
  let latest: { at: number; value: LatestRelease | null; error: string | null } | null = null;

  async function checkLatest(force: boolean): Promise<{ value: LatestRelease | null; error: string | null; checkedAt: number }> {
    if (!force && latest && Date.now() - latest.at < LATEST_TTL_MS) return { value: latest.value, error: latest.error, checkedAt: latest.at };
    let value: LatestRelease | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `starfall/${version}` }, signal: AbortSignal.timeout(6000) });
      if (res.status === 404) value = null;
      else if (!res.ok) error = `查询失败（${res.status}）`;
      else {
        const j = (await res.json()) as { tag_name?: string; published_at?: string };
        value = j.tag_name ? { version: j.tag_name.replace(/^v/, ''), publishedAt: j.published_at ?? null } : null;
      }
    } catch {
      error = '连不上更新服务器（国内网络可能访问不了，可以稍后再试）';
    }
    latest = { at: Date.now(), value, error };
    return { value, error, checkedAt: latest.at };
  }

  app.get('/api/about', async (req) => {
    const { check } = parseBody(z.object({ check: z.enum(['0', '1']).optional() }).passthrough(), req.query);
    const p = paths(ctx.config.dataDir);
    const [git, upd] = await Promise.all([describe, checkLatest(check === '1')]);
    const mem = process.memoryUsage();
    return {
      version,
      /** 不在正式版标签上时的提交编号（开发版） */
      build: git && git !== `v${version}` ? git : null,
      edition: 'server' as const,
      update: { latest: upd.value, newer: upd.value ? compareVersions(upd.value.version, version) > 0 : false, error: upd.error, checkedAt: upd.checkedAt },
      runtime: {
        startedAt: Date.now() - Math.round(process.uptime() * 1000),
        node: process.version,
        os: `${os.type()} ${os.release()}（${process.arch}）`,
        memoryMb: Math.round(mem.rss / 1048576),
        dataDir: ctx.config.dataDir,
        dbBytes: fileSize(p.db) + fileSize(`${p.db}-wal`),
        assetBytes: dirSize(p.assets),
        backupBytes: dirSize(p.backups),
        port: ctx.config.port,
        timeZone: ctx.config.timeZone,
      },
    };
  });
}
