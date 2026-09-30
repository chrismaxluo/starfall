// 上传的文件（方案设计第 8 节）：流式写入临时文件 → 校验文件头 → 识别 → 按 SHA-256 命名存储，相同文件只存一份。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { eq, or } from 'drizzle-orm';
import { MAX_UPLOAD_BYTES } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { assets, effects } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { ALLOWED, probe, sniff } from './probe.ts';
import type { AssetKind, SvgaSlot } from './probe.ts';

export const MAX_UPLOAD = MAX_UPLOAD_BYTES;
/** 超过这个大小在界面提示"加载慢"（F-AS-04） */
export const LARGE_FILE = 10 * 1024 * 1024;

export type AssetRow = typeof assets.$inferSelect;

export interface AssetDto {
  id: number;
  kind: AssetKind;
  filename: string;
  url: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAlpha: boolean;
  /** 界面提示：no_alpha 没有透明通道（会挡住画面），large 文件较大（加载慢） */
  warnings: Array<'no_alpha' | 'large'>;
  createdAt: number;
  /** SVGA 里可以替换的图层 */
  slots: SvgaSlot[] | null;
}

export const fileName = (a: Pick<AssetRow, 'sha256' | 'ext'>) => `${a.sha256}.${a.ext}`;

export function assetDto(a: AssetRow): AssetDto {
  const warnings: AssetDto['warnings'] = [];
  if (a.kind !== 'audio' && !a.hasAlpha) warnings.push('no_alpha');
  if (a.size > LARGE_FILE) warnings.push('large');
  return {
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    url: `/files/${fileName(a)}`,
    ext: a.ext,
    size: a.size,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    hasAlpha: a.hasAlpha,
    slots: a.slots ?? null,
    warnings,
    createdAt: a.createdAt,
  };
}

/** 只保留文件名里安全、可读的部分（只用于显示，不用作路径） */
export function cleanName(name: string): string {
  const base = path.basename(name.replaceAll('\\', '/'));
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 120) || '未命名';
}

export class AssetStore {
  private readonly db: Db;
  readonly dir: string;
  readonly tmpDir: string;
  /** 单个文件上限（测试时调小） */
  readonly maxBytes: number;

  constructor(db: Db, dirs: { assets: string; tmp: string }, maxBytes = MAX_UPLOAD) {
    this.db = db;
    this.dir = dirs.assets;
    this.tmpDir = dirs.tmp;
    this.maxBytes = maxBytes;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }
  /** 清理临时目录里超过 maxAgeMs 的文件（上传中断、没有确认的导入包）；启动时传 0 全部清掉 */
  cleanTmp(maxAgeMs: number, now = Date.now()): number {
    let n = 0;
    for (const f of fs.readdirSync(this.tmpDir)) {
      const p = path.join(this.tmpDir, f);
      try {
        if (now - fs.statSync(p).mtimeMs >= maxAgeMs) {
          fs.rmSync(p, { recursive: true, force: true });
          n++;
        }
      } catch {
        /* 正在被删除 */
      }
    }
    return n;
  }


  get(id: number): AssetRow | undefined {
    return this.db.select().from(assets).where(eq(assets.id, id)).get();
  }

  list(kind?: AssetKind): AssetRow[] {
    const q = this.db.select().from(assets);
    return (kind ? q.where(eq(assets.kind, kind)) : q).orderBy(assets.id).all();
  }

  path(a: Pick<AssetRow, 'sha256' | 'ext'>): string {
    return path.join(this.dir, fileName(a));
  }

  /**
   * 保存上传的文件。only 限定允许的类型（例如音效只收音频）。
   * 返回文件记录，created=false 表示已经有相同的文件。
   */
  async ingest(stream: Readable, originalName: string, only?: AssetKind[]): Promise<{ asset: AssetRow; created: boolean }> {
    const filename = cleanName(originalName);
    const extRaw = path.extname(filename).slice(1).toLowerCase();
    const type = ALLOWED[extRaw];
    if (!type || (only && !only.includes(type.kind))) {
      stream.resume();
      throw new HttpError(415, 'unsupported_file', `不支持的文件格式：${extRaw ? `.${extRaw}` : '没有扩展名'}`);
    }

    const tmp = path.join(this.tmpDir, `${crypto.randomUUID()}.${type.ext}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const max = this.maxBytes;
    const tooLarge = () => new HttpError(413, 'file_too_large', `文件太大，单个文件不能超过 ${Math.round(max / 1024 / 1024)} MB`);
    const head: Buffer[] = [];
    let headLen = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) return cb(tooLarge());
        if (headLen < 64) {
          head.push(chunk);
          headLen += chunk.length;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, tap, fs.createWriteStream(tmp, { mode: 0o600 }));
      if ((stream as Readable & { truncated?: boolean }).truncated) throw tooLarge();
      if (size === 0) throw new HttpError(400, 'empty_file', '文件是空的');
      if (!sniff(type.ext, Buffer.concat(head).subarray(0, 64))) throw new HttpError(415, 'file_mismatch', `文件内容和扩展名 .${extRaw} 不符，可能是改过扩展名的其他文件`);

      const sha256 = hash.digest('hex');
      const existing = this.db.select().from(assets).where(eq(assets.sha256, sha256)).get();
      if (existing) return { asset: existing, created: false };

      let info;
      try {
        info = await probe(tmp, type);
      } catch (e) {
        throw new HttpError(415, 'file_invalid', `无法识别这个文件：${(e as Error).message}`);
      }
      const final = path.join(this.dir, `${sha256}.${type.ext}`);
      fs.renameSync(tmp, final);
      // 同一个文件同时上传两次时，检测期间另一个请求可能已经存好了：用已有的那条
      const asset = this.db
        .insert(assets)
        .values({ kind: type.kind, filename, sha256, ext: type.ext, mime: type.mime, size, ...info })
        .onConflictDoNothing({ target: assets.sha256 })
        .returning()
        .get();
      if (!asset) return { asset: this.db.select().from(assets).where(eq(assets.sha256, sha256)).get()!, created: false };
      return { asset, created: true };
    } catch (e) {
      stream.resume();
      // @fastify/multipart 在超过大小限制时报 FST_REQ_FILE_TOO_LARGE
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** 引用这个文件的素材（作为画面或音效） */
  users(id: number): Array<{ id: number; name: string; as: 'visual' | 'sound' }> {
    return this.db
      .select({ id: effects.id, name: effects.name, assetId: effects.assetId })
      .from(effects)
      .where(or(eq(effects.assetId, id), eq(effects.soundAssetId, id)))
      .all()
      .map((e) => ({ id: e.id, name: e.name, as: e.assetId === id ? ('visual' as const) : ('sound' as const) }));
  }

  /** 删除文件记录和文件本身；仍被素材使用时抛出 409 */
  remove(id: number): void {
    const a = this.get(id);
    if (!a) throw new HttpError(404, 'not_found', '文件不存在');
    const users = this.users(id);
    if (users.length) throw new HttpError(409, 'in_use', `还有 ${users.length} 个素材在使用，不能删除`, { usedBy: users });
    this.db.delete(assets).where(eq(assets.id, id)).run();
    fs.rmSync(this.path(a), { force: true });
  }

  /** 升级前上传的 SVGA 没有图层信息：重新读一遍文件补上（读不了的记成空列表，不再重试） */
  async backfillSlots(): Promise<number> {
    const rows = this.db.select().from(assets).where(eq(assets.ext, 'svga')).all().filter((a) => a.slots === null);
    for (const a of rows) {
      let slots: SvgaSlot[] = [];
      try {
        slots = (await probe(this.path(a), ALLOWED.svga!)).slots ?? [];
      } catch {
        /* 文件坏了：当作没有图层 */
      }
      this.db.update(assets).set({ slots }).where(eq(assets.id, a.id)).run();
    }
    return rows.length;
  }

  /** 改名：只改显示的名字，扩展名不变 */
  rename(id: number, name: string): AssetRow {
    const a = this.get(id);
    if (!a) throw new HttpError(404, 'not_found', '文件不存在');
    const base = cleanName(name.replaceAll('/', '').replaceAll('\\', ''));
    this.db.update(assets).set({ filename: `${base}.${a.ext}` }).where(eq(assets.id, id)).run();
    return this.get(id)!;
  }

  /** 没有素材使用时删除（替换文件、删除素材后调用） */
  removeIfUnused(id: number | null): void {
    if (id !== null && this.get(id) && this.users(id).length === 0) this.remove(id);
  }
}
