// 输出（需求 F-OU-01 ~ 06）：每个输出是一个特效页地址 + 一套画布设置。密钥只用于特效页，无法登录后台。
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { outputs } from '../db/schema.ts';
import { HttpError } from '../http.ts';

export type OutputRow = typeof outputs.$inferSelect;

export const OutputInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    app: z.enum(['livehime', 'obs']),
    orient: z.enum(['portrait', 'landscape']),
    width: z.number().int().min(320).max(7680),
    height: z.number().int().min(320).max(7680),
    safeTop: z.number().int().min(0).max(45),
    safeBottom: z.number().int().min(0).max(60),
    marginX: z.number().int().min(0).max(30),
    scale: z.number().int().min(50).max(200),
    liteMode: z.enum(['auto', 'on', 'off']),
  })
  .strict();
export type OutputInput = z.infer<typeof OutputInputSchema>;
export const OutputPatchSchema = OutputInputSchema.partial().strict();

/** 新建输出的默认值：竖屏 1080×1920，安全区按手机竖屏实测（P0 报告） */
const DEFAULTS: Omit<OutputInput, 'name'> = { app: 'livehime', orient: 'portrait', width: 1080, height: 1920, safeTop: 12, safeBottom: 40, marginX: 9, scale: 100, liteMode: 'auto' };

const newKey = () => crypto.randomBytes(16).toString('base64url');

/** 特效页地址（相对路径，界面上拼上当前访问的主机名） */
export const overlayPath = (o: Pick<OutputRow, 'id' | 'key'>) => `/overlay/?output=${o.id}&key=${o.key}`;

export class OutputStore {
  private readonly db: Db;
  private readonly listeners = new Set<(o: OutputRow, change: 'update' | 'key' | 'delete') => void>();

  constructor(db: Db) {
    this.db = db;
  }

  /** 设置变化时通知在线的特效页（重置密钥、删除时断开旧连接） */
  onChange(fn: (o: OutputRow, change: 'update' | 'key' | 'delete') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(o: OutputRow, change: 'update' | 'key' | 'delete'): void {
    for (const fn of this.listeners) fn(o, change);
  }

  list(): OutputRow[] {
    return this.db.select().from(outputs).orderBy(outputs.id).all();
  }

  get(id: number): OutputRow {
    const o = this.db.select().from(outputs).where(eq(outputs.id, id)).get();
    if (!o) throw new HttpError(404, 'not_found', '输出不存在');
    return o;
  }

  /** 特效页连接时校验：密钥用固定时间比较 */
  verify(id: number, key: string): OutputRow | null {
    const o = this.db.select().from(outputs).where(eq(outputs.id, id)).get();
    if (!o) return null;
    const a = Buffer.from(o.key);
    const b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? o : null;
  }

  create(input: Partial<OutputInput> & { name: string }): OutputRow {
    return this.db.insert(outputs).values({ ...DEFAULTS, ...input, key: newKey() }).returning().get();
  }

  update(id: number, patch: Partial<OutputInput>): OutputRow {
    this.get(id);
    const o = this.db.update(outputs).set(patch).where(eq(outputs.id, id)).returning().get()!;
    this.emit(o, 'update');
    return o;
  }

  resetKey(id: number): OutputRow {
    const old = this.get(id);
    const o = this.db.update(outputs).set({ key: newKey() }).where(eq(outputs.id, id)).returning().get()!;
    this.emit(old, 'key');
    return o;
  }

  remove(id: number): void {
    const o = this.get(id);
    if (this.list().length <= 1) throw new HttpError(409, 'last_output', '至少要保留一个输出');
    this.db.delete(outputs).where(eq(outputs.id, id)).run();
    this.emit(o, 'delete');
  }
}
