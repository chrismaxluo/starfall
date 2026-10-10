// 弹幕点歌：设置、列表操作、搜歌、模拟点歌、历史、网易云账号、本地歌库；点歌窗口用的音乐文件（/music-files/，带签名，不用登录）
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { NeteaseError } from '@starfall/music';
import { MusicSettingsPatchSchema } from '@starfall/shared';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import { HttpError, parseBody } from '../http.ts';

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const SongSchema = z
  .object({
    source: z.enum(['netease', 'local']),
    id: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    artists: z.string().max(300),
    album: z.string().max(200).optional(),
    cover: z.string().max(500).optional(),
    durationMs: z.number().int().min(0).max(24 * 3600_000),
  })
  .strict();

function neteaseError(e: unknown, what: string): never {
  if (e instanceof NeteaseError) throw new HttpError(502, 'netease_error', e.message);
  const err = e as Error;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new HttpError(504, 'netease_timeout', `${what}超时：连不上网易云，请稍后再试`);
  throw new HttpError(502, 'netease_error', `${what}失败：${err.message}`);
}

export function musicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { music, musicAccount: account, musicLibrary: library } = ctx;

  app.get('/api/music', async () => ({ settings: music.cfg(), ...music.snapshot(), account: account.status(), library: { count: library.count() }, desktop: ctx.config.desktop }));

  app.put('/api/music/settings', async (req) => ({ settings: music.updateSettings(parseBody(MusicSettingsPatchSchema, req.body)) }));

  app.post('/api/music/pause', async (req) => {
    const { paused } = parseBody(z.object({ paused: z.boolean() }).strict(), req.body);
    music.setPaused(paused);
    return { ok: true };
  });

  app.post('/api/music/skip', async () => {
    if (!music.skip()) throw new HttpError(409, 'nothing_playing', '现在没有在放的歌');
    return { ok: true };
  });

  app.post('/api/music/queue', async (req) => {
    const { song, front } = parseBody(z.object({ song: SongSchema, front: z.boolean().optional() }).strict(), req.body);
    if (song.source === 'local' && !library.get(Number(song.id))) throw new HttpError(404, 'not_found', '这首歌不在歌库里了');
    return { item: music.add(song, front) };
  });

  app.delete('/api/music/queue/:id', async (req) => {
    music.remove(parseBody(IdParam, req.params).id);
    return { ok: true };
  });

  app.put('/api/music/queue/order', async (req) => {
    const { ids } = parseBody(z.object({ ids: z.array(z.number().int().positive()).max(200) }).strict(), req.body);
    music.reorder(ids);
    return { ok: true };
  });

  app.post('/api/music/queue/clear', async () => ({ cleared: music.clear() }));

  app.get('/api/music/search', async (req) => {
    const { q } = parseBody(z.object({ q: z.string().trim().min(1, '写一下歌名').max(60) }), req.query);
    return music.search(q);
  });

  app.post('/api/music/simulate', async (req) => {
    const { text, guard } = parseBody(z.object({ text: z.string().max(100), guard: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict(), req.body);
    return music.simulate(text, guard ? { guard } : {});
  });

  app.get('/api/music/history', async (req) => {
    const { before, limit } = parseBody(z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { items: music.history(limit, before) };
  });

  app.get('/api/music/stats', async (req) => {
    const { days } = parseBody(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    return music.stats(days);
  });

  // ---------- 网易云账号 ----------

  app.get('/api/music/account', async () => account.status());
  app.post('/api/music/account/check', async () => account.check());
  app.delete('/api/music/account', async () => {
    await account.logout();
    return { ok: true };
  });
  app.post('/api/music/qrcode', async () => {
    try {
      return await account.startQr();
    } catch (e) {
      return neteaseError(e, '申请二维码');
    }
  });
  app.get<{ Params: { key: string } }>('/api/music/qrcode/:key', async (req) => {
    try {
      const state = await account.pollQr(req.params.key);
      return { state, ...(state === 'success' ? { account: account.status() } : {}) };
    } catch (e) {
      return neteaseError(e, '查询扫码状态');
    }
  });

  // ---------- 本地歌库 ----------

  app.get('/api/music/local', async () => ({ songs: library.list(), folder: ctx.settings.getRaw<string>('musicFolder') ?? null }));

  app.post('/api/music/local', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'no_file', '没有收到文件');
    return library.upload(file.file, file.filename);
  });

  app.put('/api/music/local/:id', async (req) => {
    const { id } = parseBody(IdParam, req.params);
    const body = parseBody(z.object({ title: z.string().trim().min(1).max(200).optional(), artist: z.string().trim().max(200).optional(), lyric: z.string().max(200_000).nullable().optional() }).strict(), req.body);
    if (body.lyric !== undefined) library.setLyric(id, body.lyric);
    return { song: library.rename(id, body) };
  });

  app.delete('/api/music/local/:id', async (req) => {
    library.remove(parseBody(IdParam, req.params).id);
    return { ok: true };
  });

  // 桌面版：选一个文件夹（不选了传 null）、重新扫描。服务器版不能用（文件夹要在运行星临的电脑上）
  app.put('/api/music/local/folder', async (req) => {
    if (!ctx.config.desktop) throw new HttpError(400, 'desktop_only', '只有电脑版能选文件夹；服务器版请上传音乐文件');
    const { dir } = parseBody(z.object({ dir: z.string().min(1).max(1000).nullable() }).strict(), req.body);
    if (dir !== null && !path.isAbsolute(dir)) throw new HttpError(400, 'bad_folder', '文件夹路径不对');
    const r = await library.scanFolder(dir);
    if (dir === null) ctx.settings.deleteRaw('musicFolder');
    else ctx.settings.setRaw('musicFolder', dir);
    return r;
  });
  app.post('/api/music/local/rescan', async () => {
    const dir = ctx.settings.getRaw<string>('musicFolder') ?? null;
    if (!dir) throw new HttpError(400, 'no_folder', '还没有选文件夹');
    return library.scanFolder(dir);
  });

  // ---------- 点歌窗口用的音乐、封面（带签名） ----------

  const send = (what: 'audio' | 'cover') => async (req: { params: unknown; query: unknown }, reply: { header: (k: string, v: string) => unknown; sendFile: (name: string, dir: string) => unknown }) => {
    const { id } = parseBody(IdParam, req.params);
    const { s } = parseBody(z.object({ s: z.string().max(40) }), req.query);
    const f = library.file(id, s, what);
    if (!f || !fs.existsSync(path.join(f.dir, f.name))) throw new HttpError(404, 'not_found', '没有这个文件');
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.sendFile(f.name, f.dir);
  };
  app.get('/music-files/:id', send('audio'));
  app.get('/music-files/:id/cover', send('cover'));
}
