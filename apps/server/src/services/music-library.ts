// 本地歌库（点歌用）：上传的音乐按内容哈希存在 data/music 里；桌面版还可以选一个文件夹，直接用里面的文件。
// 歌名、歌手、专辑、时长、封面、歌词从文件自带的信息里读；读不到歌名时按文件名「歌手 - 歌名」猜。
// 歌词也可以另外放一个同名的 .lrc 文件（上传时按文件名配上；文件夹里的放在音乐文件旁边）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { parseFile } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';
import type { Candidate } from '@starfall/music';
import { norm, words } from '@starfall/music';
import type { MusicSong } from '@starfall/shared';
import type { Db } from '../db/index.ts';
import { musicLocal } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { cleanName } from './assets.ts';
import type { Secret } from './secret.ts';

export type LocalRow = typeof musicLocal.$inferSelect;

/** 能放的格式（直播姬、OBS 的浏览器里都能放） */
export const MUSIC_EXTS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav'] as const;
const MAX_LYRIC = 200_000;
/** 文件夹里最多收多少首（太多了扫描慢） */
export const FOLDER_MAX = 5000;

export interface LocalSongDto {
  id: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  cover: string | null;
  hasLyric: boolean;
  filename: string;
  size: number;
  /** 桌面版文件夹里的（不能在这里删，从文件夹里删掉后重新扫描） */
  folder: boolean;
  createdAt: number;
}

/** 文件名猜歌名、歌手：「歌手 - 歌名」「01. 歌名」 */
export function guessFromName(filename: string): { title: string; artist: string } {
  const base = path.basename(filename, path.extname(filename)).replace(/^\d{1,3}[\s._-]+/, '').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1]!.trim(), title: m[2]!.trim() } : { title: base || '未命名', artist: '' };
}

/** 文件自带的歌词：同步歌词（带时间）转成 LRC；只有文字的、本来就是 LRC 写法的原样用 */
function lyricOf(meta: IAudioMetadata): string | null {
  for (const l of meta.common.lyrics ?? []) {
    const tag = l as unknown as { text?: string; syncText?: Array<{ text: string; timestamp?: number }> } | string;
    if (typeof tag === 'string') {
      if (/\[\d{1,3}:\d{1,2}/.test(tag)) return tag.slice(0, MAX_LYRIC);
      continue;
    }
    if (tag.syncText?.length) {
      const mmss = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
      return tag.syncText
        .filter((x) => x.timestamp !== undefined)
        .map((x) => `[${mmss(x.timestamp!)}]${x.text}`)
        .join('\n')
        .slice(0, MAX_LYRIC);
    }
    if (tag.text && /\[\d{1,3}:\d{1,2}/.test(tag.text)) return tag.text.slice(0, MAX_LYRIC);
  }
  return null;
}

async function readMeta(file: string): Promise<IAudioMetadata> {
  try {
    return await parseFile(file, { duration: true });
  } catch (e) {
    throw new HttpError(415, 'file_invalid', `无法识别这个音乐文件：${(e as Error).message}`);
  }
}

export class MusicLibrary {
  private readonly db: Db;
  readonly dir: string;
  private readonly tmpDir: string;
  private readonly maxBytes: number;
  private readonly secret: Secret;
  private readonly listeners = new Set<() => void>();

  constructor(deps: { db: Db; dir: string; tmpDir: string; maxBytes: number; secret: Secret }) {
    this.db = deps.db;
    this.dir = deps.dir;
    this.tmpDir = deps.tmpDir;
    this.maxBytes = deps.maxBytes;
    this.secret = deps.secret;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get(id: number): LocalRow | undefined {
    return this.db.select().from(musicLocal).where(eq(musicLocal.id, id)).get();
  }

  rows(): LocalRow[] {
    return this.db.select().from(musicLocal).orderBy(asc(musicLocal.id)).all();
  }

  count(): number {
    return this.rows().length;
  }

  /** 给点歌窗口的文件地址：带签名，猜不出别的文件 */
  url(r: Pick<LocalRow, 'id' | 'sha256' | 'path'>): string {
    return `/music-files/${r.id}?s=${this.sig(r)}`;
  }

  coverUrl(r: Pick<LocalRow, 'id' | 'cover' | 'sha256' | 'path'>): string | null {
    return r.cover ? `/music-files/${r.id}/cover?s=${this.sig(r)}` : null;
  }

  private sig(r: Pick<LocalRow, 'id' | 'sha256' | 'path'>): string {
    return this.secret.hmac(`music:${r.id}:${r.sha256 ?? r.path ?? ''}`).slice(0, 22);
  }

  /** 签名对不上、文件不在了时返回 null */
  file(id: number, sig: string, what: 'audio' | 'cover'): { dir: string; name: string } | null {
    const r = this.get(id);
    if (!r || sig !== this.sig(r)) return null;
    if (what === 'cover') return r.cover ? { dir: this.dir, name: r.cover } : null;
    const full = r.path ?? path.join(this.dir, `${r.sha256}.${r.ext}`);
    if (!fs.existsSync(full)) return null;
    return { dir: path.dirname(full), name: path.basename(full) };
  }

  dto(r: LocalRow): LocalSongDto {
    return { id: r.id, title: r.title, artist: r.artist, album: r.album, durationMs: r.durationMs, cover: this.coverUrl(r), hasLyric: Boolean(r.lyric), filename: r.filename, size: r.size, folder: r.path !== null, createdAt: r.createdAt };
  }

  list(): LocalSongDto[] {
    return this.rows().map((r) => this.dto(r));
  }

  song(r: LocalRow): MusicSong {
    const cover = this.coverUrl(r);
    return { source: 'local', id: String(r.id), name: r.title, artists: r.artist, ...(r.album ? { album: r.album } : {}), ...(cover ? { cover } : {}), durationMs: r.durationMs };
  }

  /** 选歌用：歌名、歌手、专辑、文件名里含观众写的词的，按对上的词数排前面 */
  search(query: string, limit = 20): Array<Candidate & { row: LocalRow }> {
    const ws = words(query);
    if (!ws.length) return [];
    const scored: Array<{ r: LocalRow; n: number }> = [];
    for (const r of this.rows()) {
      const text = norm([r.title, r.artist, r.album, path.basename(r.filename, path.extname(r.filename))].join('|'));
      const n = ws.filter((w) => text.includes(w)).length;
      if (n) scored.push({ r, n });
    }
    return scored
      .sort((a, b) => b.n - a.n || a.r.id - b.r.id)
      .slice(0, limit)
      // 文件名当作别名：歌名读错了时按文件名也能点到
      .map(({ r }) => ({ row: r, name: r.title, alias: [path.basename(r.filename, path.extname(r.filename))], artists: r.artist ? r.artist.split(/\s*[/&、]\s*/) : [], durationMs: r.durationMs, playable: true }));
  }

  /** 保存上传的音乐文件（同样的文件只存一份）；.lrc 歌词按文件名配到已有的歌上 */
  async upload(stream: Readable, originalName: string): Promise<{ song: LocalSongDto; created: boolean } | { lyricFor: LocalSongDto }> {
    const filename = cleanName(originalName);
    const ext = path.extname(filename).slice(1).toLowerCase();
    if (ext === 'lrc') return { lyricFor: await this.uploadLyric(stream, filename) };
    if (!(MUSIC_EXTS as readonly string[]).includes(ext)) {
      stream.resume();
      throw new HttpError(415, 'unsupported_file', `不支持的音乐格式：${ext ? `.${ext}` : '没有扩展名'}（支持 ${MUSIC_EXTS.join('、')}，歌词用 .lrc）`);
    }
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const tmp = path.join(this.tmpDir, `${crypto.randomUUID()}.${ext}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const max = this.maxBytes;
    const tooLarge = () => new HttpError(413, 'file_too_large', `文件太大，单个文件不能超过 ${Math.round(max / 1024 / 1024)} MB`);
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) return cb(tooLarge());
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, tap, fs.createWriteStream(tmp, { mode: 0o600 }));
      if ((stream as Readable & { truncated?: boolean }).truncated) throw tooLarge();
      if (size === 0) throw new HttpError(400, 'empty_file', '文件是空的');
      const sha256 = hash.digest('hex');
      const existing = this.db.select().from(musicLocal).where(eq(musicLocal.sha256, sha256)).get();
      if (existing) return { song: this.dto(existing), created: false };
      const meta = await readMeta(tmp);
      if (!meta.format.duration) throw new HttpError(415, 'file_invalid', '读不出这个文件的时长，可能不是完整的音乐文件');
      const final = path.join(this.dir, `${sha256}.${ext}`);
      fs.renameSync(tmp, final);
      const cover = this.saveCover(meta, sha256);
      const row = this.db
        .insert(musicLocal)
        .values({ sha256, ext, filename, size, ...this.info(meta, filename), cover, lyric: lyricOf(meta) })
        .onConflictDoNothing()
        .returning()
        .get();
      const r = row ?? this.db.select().from(musicLocal).where(eq(musicLocal.sha256, sha256)).get()!;
      this.emit();
      return { song: this.dto(r), created: Boolean(row) };
    } catch (e) {
      stream.resume();
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  private info(meta: IAudioMetadata, filename: string): { title: string; artist: string; album: string; durationMs: number } {
    const g = guessFromName(filename);
    const c = meta.common;
    const artist = (c.artists?.length ? c.artists.join(' / ') : c.artist) ?? '';
    return {
      title: (c.title?.trim() || g.title).slice(0, 200),
      artist: (artist.trim() || g.artist).slice(0, 200),
      album: (c.album?.trim() ?? '').slice(0, 200),
      durationMs: Math.round((meta.format.duration ?? 0) * 1000),
    };
  }

  /** 文件自带的封面存成单独的图片（点歌窗口直接加载） */
  private saveCover(meta: IAudioMetadata, stem: string): string | null {
    const pic = meta.common.picture?.[0];
    if (!pic?.data?.length || pic.data.length > 5 * 1024 * 1024) return null;
    const ext = /png/i.test(pic.format) ? 'png' : /webp/i.test(pic.format) ? 'webp' : 'jpg';
    const name = `${stem}.cover.${ext}`;
    fs.writeFileSync(path.join(this.dir, name), pic.data, { mode: 0o600 });
    return name;
  }

  /** 上传的 .lrc：配到文件名（去掉扩展名）一样的歌上，没有的话配到歌名一样的歌上 */
  private async uploadLyric(stream: Readable, filename: string): Promise<LocalSongDto> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of stream) {
      size += (c as Buffer).length;
      if (size > MAX_LYRIC * 4) throw new HttpError(413, 'file_too_large', '歌词文件太大了');
      chunks.push(c as Buffer);
    }
    const text = decodeText(Buffer.concat(chunks));
    const stem = norm(path.basename(filename, '.lrc'));
    const rows = this.rows();
    const r = rows.find((x) => norm(path.basename(x.filename, path.extname(x.filename))) === stem) ?? rows.find((x) => norm(x.title) === stem || norm(`${x.artist} - ${x.title}`) === stem);
    if (!r) throw new HttpError(404, 'no_song', `歌库里没有和「${path.basename(filename, '.lrc')}」同名的歌，请先上传音乐文件，歌词文件名要和音乐文件名一样`);
    return this.setLyric(r.id, text);
  }

  setLyric(id: number, lrc: string | null): LocalSongDto {
    const r = this.get(id);
    if (!r) throw new HttpError(404, 'not_found', '这首歌不在歌库里了');
    if (lrc !== null && !/\[\d{1,3}:\d{1,2}/.test(lrc)) throw new HttpError(400, 'invalid_lyric', '不是 LRC 格式的歌词（每句前面要有 [分:秒] 时间）');
    this.db.update(musicLocal).set({ lyric: lrc?.slice(0, MAX_LYRIC) ?? null }).where(eq(musicLocal.id, id)).run();
    this.emit();
    return this.dto(this.get(id)!);
  }

  /** 改歌名、歌手（文件里的信息不对时） */
  rename(id: number, p: { title?: string; artist?: string }): LocalSongDto {
    const r = this.get(id);
    if (!r) throw new HttpError(404, 'not_found', '这首歌不在歌库里了');
    this.db.update(musicLocal).set({ ...(p.title !== undefined ? { title: p.title } : {}), ...(p.artist !== undefined ? { artist: p.artist } : {}) }).where(eq(musicLocal.id, id)).run();
    this.emit();
    return this.dto(this.get(id)!);
  }

  /** 删掉上传的歌（文件一起删）；文件夹里的不能在这里删 */
  remove(id: number): void {
    const r = this.get(id);
    if (!r) throw new HttpError(404, 'not_found', '这首歌不在歌库里了');
    if (r.path) throw new HttpError(409, 'in_folder', '这首歌在你选的文件夹里：从文件夹里删掉后点「重新扫描」');
    this.db.delete(musicLocal).where(eq(musicLocal.id, id)).run();
    fs.rmSync(path.join(this.dir, `${r.sha256}.${r.ext}`), { force: true });
    if (r.cover) fs.rmSync(path.join(this.dir, r.cover), { force: true });
    this.emit();
  }

  /**
   * 桌面版：扫描文件夹（包括子文件夹），新的加进来、不在了的去掉、改过的重新读。dir 为 null 时清掉文件夹里的歌。
   * 返回现在文件夹里有几首、新加了几首
   */
  async scanFolder(dir: string | null): Promise<{ total: number; added: number; removed: number; skipped: number }> {
    const found = new Map<string, fs.Stats>();
    if (dir) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(400, 'no_folder', `找不到文件夹：${dir}`);
      const walk = (d: string, depth: number) => {
        if (depth > 6 || found.size >= FOLDER_MAX) return;
        let ents: fs.Dirent[];
        try {
          ents = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of ents) {
          if (e.name.startsWith('.')) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (e.isFile() && (MUSIC_EXTS as readonly string[]).includes(path.extname(e.name).slice(1).toLowerCase())) {
            try {
              found.set(p, fs.statSync(p));
            } catch {
              /* 读不了的跳过 */
            }
            if (found.size >= FOLDER_MAX) return;
          }
        }
      };
      walk(dir, 0);
    }
    let added = 0;
    let removed = 0;
    let skipped = 0;
    const existing = this.db.select().from(musicLocal).where(isNotNull(musicLocal.path)).all();
    for (const r of existing) {
      const st = found.get(r.path!);
      if (st && st.size === r.size) {
        found.delete(r.path!);
        continue;
      }
      this.db.delete(musicLocal).where(eq(musicLocal.id, r.id)).run();
      if (r.cover) fs.rmSync(path.join(this.dir, r.cover), { force: true });
      removed++;
    }
    for (const [p, st] of found) {
      try {
        const meta = await parseFile(p, { duration: true });
        if (!meta.format.duration) {
          skipped++;
          continue;
        }
        const stem = `f-${crypto.createHash('sha1').update(p).digest('hex').slice(0, 16)}`;
        const side = p.slice(0, -path.extname(p).length) + '.lrc';
        let lyric = lyricOf(meta);
        if (fs.existsSync(side)) {
          try {
            const t = decodeText(fs.readFileSync(side));
            if (/\[\d{1,3}:\d{1,2}/.test(t)) lyric = t.slice(0, MAX_LYRIC);
          } catch {
            /* 歌词读不了不影响 */
          }
        }
        const filename = path.basename(p);
        this.db
          .insert(musicLocal)
          .values({ path: p, ext: path.extname(p).slice(1).toLowerCase(), filename, size: st.size, ...this.info(meta, filename), cover: this.saveCover(meta, stem), lyric })
          .onConflictDoNothing()
          .run();
        added++;
      } catch {
        skipped++;
      }
    }
    if (added || removed) this.emit();
    const total = this.db.select({ id: musicLocal.id }).from(musicLocal).where(isNotNull(musicLocal.path)).all().length;
    return { total, added, removed, skipped };
  }

  /** 上传的歌有几首（不算文件夹里的） */
  uploadedCount(): number {
    return this.db.select({ id: musicLocal.id }).from(musicLocal).where(isNull(musicLocal.path)).all().length;
  }
}

/** 歌词文件：UTF-8（带不带 BOM），不是的话按 GBK 读（以前的 .lrc 常见） */
export function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/^\uFEFF/, '');
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return utf8;
  }
}
