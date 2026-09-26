// 数据：导出 / 导入配置（F-DA-04）、自动备份（F-DA-03）
// 导出：只导出配置（JSON），或连同素材文件打包成 zip。
// 导入分两步：先上传文件得到变化预览，确认后再应用；中间的文件临时保存在 data/tmp。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';
import { KEEP_BACKUPS, KEEP_MANUAL } from '../services/backup.ts';
import { CONFIG_ENTRY, parseConfigFile } from '../services/config-io.ts';
import type { ConfigFile } from '../services/config-io.ts';

/** 导入文件的大小上限：配置 JSON 20 MB，带素材的 zip 4 GB */
const MAX_JSON = 20 * 1024 * 1024;
const MAX_ZIP = 4 * 1024 * 1024 * 1024;
/** 上传后多久内要确认导入 */
const PENDING_MS = 30 * 60_000;
const FILE_ENTRY = /^files\/([0-9a-f]{64})\.([a-z0-9]{2,5})$/;

interface Pending {
  token: string;
  file: string;
  zip: boolean;
  config: ConfigFile;
  /** zip 里带的文件：sha256 → 条目名 */
  entries: Map<string, string>;
  expires: number;
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e || !z ? reject(e) : resolve(z))));
}

/** 列出 zip 的条目 */
async function zipEntries(zip: yauzl.ZipFile): Promise<Map<string, yauzl.Entry>> {
  const out = new Map<string, yauzl.Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      out.set(e.fileName, e);
      zip.readEntry();
    });
    zip.once('end', resolve);
    zip.once('error', reject);
    zip.readEntry();
  });
  return out;
}

function entryStream(zip: yauzl.ZipFile, e: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(e, (err, s) => (err || !s ? reject(err) : resolve(s))));
}

async function readText(s: Readable, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of s) {
    n += (c as Buffer).length;
    if (n > max) throw new HttpError(413, 'file_too_large', '配置文件太大');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const badZip = () => new HttpError(400, 'invalid_config', '无法读取这个 zip 文件，请确认是星临导出的备份');

export function backupRoutes(app: FastifyInstance, ctx: AppContext): void {
  let pending: Pending | null = null;
  const drop = () => {
    if (pending) fs.rmSync(pending.file, { force: true });
    pending = null;
  };
  const take = (token: string): Pending => {
    if (pending && pending.expires < Date.now()) drop();
    if (!pending || pending.token !== token) throw new HttpError(410, 'import_expired', '导入已过期，请重新选择文件');
    return pending;
  };

  // ---------- 导出 ----------
  app.get<{ Querystring: { files?: string } }>('/api/backup/export', async (req, reply) => {
    const file = ctx.io.export();
    const stamp = ctx.backups.stamp();
    const json = Buffer.from(JSON.stringify(file, null, 2));
    if (req.query.files !== '1') {
      return reply
        .type('application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="starfall-config-${stamp}.json"`)
        .header('Cache-Control', 'no-store')
        .send(json);
    }
    // 素材文件本身已经压缩过，只打包不再压缩
    const zip = new yazl.ZipFile();
    zip.addBuffer(json, CONFIG_ENTRY);
    for (const a of ctx.io.exportFiles(file)) {
      const p = ctx.assets.path(a);
      if (fs.existsSync(p)) zip.addFile(p, `files/${a.sha256}.${a.ext}`, { compress: false });
    }
    zip.end();
    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="starfall-backup-${stamp}.zip"`)
      .header('Cache-Control', 'no-store')
      .send(zip.outputStream);
  });

  // ---------- 导入：上传 → 预览 ----------
  app.post('/api/backup/import', async (req) => {
    if (!req.isMultipart()) throw new HttpError(415, 'unsupported_media_type', '请用表单方式上传文件');
    const part = await req.file({ limits: { fileSize: MAX_ZIP, files: 1 } });
    if (!part) throw new HttpError(400, 'no_file', '没有收到文件');
    const ext = path.extname(part.filename).toLowerCase();
    if (ext !== '.json' && ext !== '.zip') {
      part.file.resume();
      throw new HttpError(415, 'unsupported_file', '请选择星临导出的 .json 配置文件或 .zip 备份');
    }
    drop();
    const token = crypto.randomUUID();
    const tmp = path.join(ctx.assets.tmpDir, `import-${token}${ext}`);
    try {
      await pipeline(part.file, fs.createWriteStream(tmp, { mode: 0o600 }));
      if (part.file.truncated) throw new HttpError(413, 'file_too_large', '文件太大');
      let config: ConfigFile;
      const entries = new Map<string, string>();
      if (ext === '.json') {
        if (fs.statSync(tmp).size > MAX_JSON) throw new HttpError(413, 'file_too_large', '配置文件太大');
        config = parseConfigFile(fs.readFileSync(tmp, 'utf8'));
      } else {
        const zip = await openZip(tmp).catch(() => {
          throw badZip();
        });
        try {
          const all = await zipEntries(zip).catch(() => {
            throw badZip();
          });
          const main = all.get(CONFIG_ENTRY);
          if (!main) throw new HttpError(400, 'invalid_config', `zip 里没有 ${CONFIG_ENTRY}，请确认是星临导出的备份`);
          config = parseConfigFile(await readText(await entryStream(zip, main), MAX_JSON));
          for (const name of all.keys()) {
            const m = FILE_ENTRY.exec(name);
            if (m) entries.set(m[1]!, name);
          }
        } finally {
          zip.close();
        }
      }
      pending = { token, file: tmp, zip: ext === '.zip', config, entries, expires: Date.now() + PENDING_MS };
      return { token, filename: part.filename, plan: ctx.io.plan(config, new Set(entries.keys())) };
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'file_too_large', '文件太大');
      throw e;
    }
  });

  // ---------- 导入：确认 ----------
  app.post<{ Params: { token: string } }>('/api/backup/import/:token', async (req) => {
    const p = take(req.params.token);
    try {
      // 先把 zip 里本机没有的文件存进素材库
      let saved = 0;
      if (p.zip && p.entries.size) {
        const have = new Set(ctx.assets.list().map((a) => a.sha256));
        const names = new Map(p.config.assets.map((a) => [a.sha256, a.filename]));
        const zip = await openZip(p.file);
        try {
          const all = await zipEntries(zip);
          for (const [sha, entry] of p.entries) {
            if (have.has(sha) || !names.has(sha)) continue;
            const e = all.get(entry);
            if (!e) continue;
            // 用条目的扩展名，防止清单里的文件名被改过
            const ext = path.extname(entry);
            const base = path.parse(names.get(sha)!).name;
            await ctx.assets.ingest(await entryStream(zip, e), `${base}${ext}`);
            saved++;
          }
        } finally {
          zip.close();
        }
      }
      ctx.io.apply(p.config);
      await ctx.live.reconcile();
      return { ok: true, savedFiles: saved };
    } finally {
      drop();
    }
  });

  app.delete<{ Params: { token: string } }>('/api/backup/import/:token', async (req) => {
    if (pending?.token === req.params.token) drop();
    return { ok: true };
  });

  // ---------- 自动备份 ----------
  app.get('/api/backup/list', async () => ({ items: ctx.backups.list(), autoBackup: ctx.settings.get('autoBackup'), keep: KEEP_BACKUPS, keepManual: KEEP_MANUAL }));

  app.post('/api/backup/run', async () => ctx.backups.run(Date.now(), true));

  // 只能下载配置（JSON）：数据库备份里有加密的登录信息，留在服务器上
  app.get('/api/backup/files/:name', async (req, reply) => {
    const { name } = parseBody(z.object({ name: z.string().regex(/^starfall-\d{8}-\d{4}(?:\d{2}-m)?\.json$/) }), req.params);
    const p = ctx.backups.file(name);
    if (!p) throw new HttpError(404, 'not_found', '这份备份已经不在了');
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(p));
  });
}
