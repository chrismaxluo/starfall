// 素材库：素材、文件上传、音效（需求 F-AS-01 ~ 15）
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';
import { assetDto } from '../services/assets.ts';
import { EffectPatchSchema } from '../services/effects.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const idOf = (req: FastifyRequest) => parseBody(IdParam, req.params).id;

/** 取出上传的文件（表单字段名 file） */
async function upload(req: FastifyRequest) {
  if (!req.isMultipart()) throw new HttpError(415, 'unsupported_media_type', '请用表单方式上传文件');
  const file = await req.file();
  if (!file) throw new HttpError(400, 'no_file', '没有收到文件');
  return file;
}

export function libraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/effects', async () => ({ effects: ctx.effects.list() }));

  app.get('/api/effects/:id', async (req) => ctx.effects.get(idOf(req)));

  app.put('/api/effects/:id', async (req) => ctx.effects.update(idOf(req), parseBody(EffectPatchSchema, req.body)));

  app.delete('/api/effects/:id', async (req) => {
    ctx.effects.remove(idOf(req));
    return { ok: true };
  });

  app.post('/api/effects/:id/copy', async (req) => {
    const b = parseBody(z.object({ name: z.string().trim().min(1).max(40).optional(), replaceRefs: z.boolean().optional() }).strict(), req.body ?? {});
    return ctx.effects.copy(idOf(req), b);
  });

  app.put('/api/effects/:id/file', async (req) => {
    const id = idOf(req);
    const file = await upload(req);
    return ctx.effects.replaceFile(id, file.file, file.filename);
  });

  // 上传：动画文件自动生成素材；音效只保存文件
  app.post('/api/assets', async (req) => {
    const file = await upload(req);
    const { asset, created } = await ctx.assets.ingest(file.file, file.filename);
    const effect = asset.kind === 'audio' ? null : ctx.effects.createFromAsset(asset);
    return { asset: assetDto(asset), duplicate: !created, effect };
  });

  app.post('/api/sounds', async (req) => {
    const file = await upload(req);
    const { asset, created } = await ctx.assets.ingest(file.file, file.filename, ['audio']);
    return { sound: { ...assetDto(asset), usedBy: ctx.assets.users(asset.id) }, duplicate: !created };
  });

  app.get('/api/sounds', async () => ({ sounds: ctx.assets.list('audio').map((a) => ({ ...assetDto(a), usedBy: ctx.assets.users(a.id) })) }));

  app.put('/api/sounds/:id', async (req) => {
    const id = idOf(req);
    const { name } = parseBody(z.object({ name: z.string().trim().min(1).max(60) }).strict(), req.body);
    if (ctx.assets.get(id)?.kind !== 'audio') throw new HttpError(404, 'not_found', '音效不存在');
    return { sound: { ...assetDto(ctx.assets.rename(id, name)), usedBy: ctx.assets.users(id) } };
  });

  app.delete('/api/assets/:id', async (req) => {
    ctx.assets.remove(idOf(req));
    return { ok: true };
  });
}
