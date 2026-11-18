import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { HttpError } from '../http.ts';
import { applyHistory, exportHistory, HISTORY_MAX_BYTES, previewHistory } from '../services/history-transfer.ts';
import type { HistoryReview } from '../services/history-transfer.ts';

const PATH = '/api/backup/history';
const PENDING_MS = 30 * 60_000;
type Pending = HistoryReview & { token: string; file: string; filename: string };

export function historyRoutes(app: FastifyInstance, ctx: AppContext): void {
  let pending: Pending | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const removeFile = (file: string) => {
    try {
      for (const suffix of ['', '-shm', '-wal', '-journal']) fs.rmSync(file + suffix, { force: true });
    } catch (error) {
      app.log.warn({ err: error }, '清理历史数据临时文件失败');
    }
  };
  const clear = () => {
    clearTimeout(timeout);
    const file = pending?.file;
    pending = null;
    if (file) removeFile(file);
  };
  const checkBusy = () => {
    if (busy) throw new HttpError(409, 'history_busy', '正在处理另一份历史文件，请稍后再试');
  };
  const days = () => ctx.settings.get('retentionDays');
  const hasChanges = (p: HistoryReview['plan']) => p.sessions.added > 0 || Object.values(p.events).some((x) => x.added > 0);

  app.get(PATH + '/export', (_req, reply) => {
    const now = Date.now();
    const file = path.join(ctx.assets.tmpDir, 'history-export-' + crypto.randomUUID() + '.db');
    try {
      fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
      exportHistory(ctx.db.$client, file, now);
      if (fs.statSync(file).size > HISTORY_MAX_BYTES) {
        throw new HttpError(413, 'history_too_large', '历史文件超过 512 MB，当前版本无法导出');
      }
      const stream = fs.createReadStream(file);
      stream.once('close', () => {
        void fs.promises.rm(file, { force: true }).catch((error: unknown) => app.log.warn(error));
      });
      return reply.type('application/octet-stream')
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', 'attachment; filename="starfall-history-' + ctx.backups.stamp(now) + '.db"')
        .send(stream);
    } catch (error) {
      removeFile(file);
      throw error;
    }
  });

  app.post(PATH + '/import', async (req) => {
    checkBusy();
    if (!req.isMultipart()) throw new HttpError(415, 'unsupported_media_type', '请选择历史 .db 文件');
    busy = true;
    const token = crypto.randomUUID();
    const file = path.join(ctx.assets.tmpDir, 'history-import-' + token + '.db');
    try {
      const part = await req.file({ limits: { fileSize: HISTORY_MAX_BYTES, files: 1 } });
      if (!part) throw new HttpError(400, 'no_file', '没有收到文件');
      const filename = path.win32.basename(part.filename);
      if (path.extname(filename).toLowerCase() !== '.db') {
        part.file.resume();
        throw new HttpError(415, 'unsupported_file', '请选择星临导出的历史 .db 文件或数据库备份');
      }
      await pipeline(part.file, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }));
      if (part.file.truncated) throw new HttpError(413, 'history_too_large', '历史文件最大支持 512 MB');
      const review = previewHistory(ctx.db.$client, file, days());
      clear();
      pending = { ...review, file, filename, token };
      timeout = setTimeout(clear, PENDING_MS);
      timeout.unref();
      return { token, filename, plan: review.plan };
    } catch (error) {
      removeFile(file);
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'history_too_large', '历史文件最大支持 512 MB');
      throw error;
    } finally {
      busy = false;
    }
  });

  app.post<{ Params: { token: string } }>(PATH + '/import/:token', async (req) => {
    checkBusy();
    const current = pending;
    if (!current || current.token !== req.params.token) throw new HttpError(410, 'import_expired', '导入已过期，请重新选择文件');
    busy = true;
    clearTimeout(timeout);
    let keep = false;
    try {
      if (!hasChanges(current.plan)) return { plan: current.plan };
      const backup = await ctx.backups.run(Date.now(), true);
      const result = applyHistory(ctx.db.$client, current.file, days(), current.signature);
      try {
        ctx.pipeline.giftBoards.restore(true);
        ctx.hub.toAdmins({ type: 'changed', what: 'history' });
      } catch (error) {
        app.log.error({ err: error }, '刷新导入后的历史记录失败');
      }
      return { plan: result.plan, backup: backup.stamp };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'history_changed') {
        const next = error.details as HistoryReview;
        pending = { ...current, ...next };
        timeout = setTimeout(clear, PENDING_MS);
        timeout.unref();
        keep = true;
        throw new HttpError(error.status, error.code, '本机记录或保留期有变化，请核对更新后的预览', next.plan);
      }
      throw error;
    } finally {
      if (!keep) clear();
      busy = false;
    }
  });

  app.delete<{ Params: { token: string } }>(PATH + '/import/:token', (req) => {
    if (!busy && pending?.token === req.params.token) clear();
    return { ok: true };
  });
  app.addHook('onClose', (_instance, done) => {
    clear();
    done();
  });
}
