// 识别上传文件：按文件头判断真实类型，读取尺寸、时长、是否透明（需求 F-AS-02 ~ 04）。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import protobuf from 'protobufjs';
import yauzl from 'yauzl';

const run = promisify(execFile);

export type AssetKind = 'video' | 'image' | 'fx' | 'audio';

export interface FileType {
  ext: string;
  kind: AssetKind;
  mime: string;
}

export const ALLOWED: Record<string, FileType> = {
  webm: { ext: 'webm', kind: 'video', mime: 'video/webm' },
  mp4: { ext: 'mp4', kind: 'video', mime: 'video/mp4' },
  gif: { ext: 'gif', kind: 'image', mime: 'image/gif' },
  png: { ext: 'png', kind: 'image', mime: 'image/png' },
  apng: { ext: 'apng', kind: 'image', mime: 'image/apng' },
  webp: { ext: 'webp', kind: 'image', mime: 'image/webp' },
  jpg: { ext: 'jpg', kind: 'image', mime: 'image/jpeg' },
  jpeg: { ext: 'jpg', kind: 'image', mime: 'image/jpeg' },
  svga: { ext: 'svga', kind: 'fx', mime: 'application/octet-stream' },
  json: { ext: 'json', kind: 'fx', mime: 'application/json' },
  mp3: { ext: 'mp3', kind: 'audio', mime: 'audio/mpeg' },
  wav: { ext: 'wav', kind: 'audio', mime: 'audio/wav' },
  ogg: { ext: 'ogg', kind: 'audio', mime: 'audio/ogg' },
};

/** 文件头是否与扩展名相符 */
export function sniff(ext: string, head: Buffer): boolean {
  const s = (a: number, b: number) => head.subarray(a, b).toString('latin1');
  switch (ext) {
    case 'webm':
      return head.readUInt32BE(0) === 0x1a45dfa3;
    case 'mp4':
      return s(4, 8) === 'ftyp';
    case 'gif':
      return s(0, 4) === 'GIF8';
    case 'png':
    case 'apng':
      return head.readUInt32BE(0) === 0x89504e47;
    case 'webp':
      return s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP';
    case 'jpg':
    case 'jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'svga': // 2.x 为 zlib 压缩的 protobuf，1.x 为 zip
      return (head[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(head[1]!)) || s(0, 2) === 'PK';
    case 'json':
      return s(0, 64).trimStart().startsWith('{');
    case 'mp3':
      return s(0, 3) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
    case 'wav':
      return s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE';
    case 'ogg':
      return s(0, 4) === 'OggS';
    default:
      return false;
  }
}

/** SVGA 里可以替换的图层：图片的名字（imageKey）和原图大小 */
export interface SvgaSlot {
  key: string;
  w: number;
  h: number;
}

export interface ProbeResult {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAlpha: boolean;
  /** 只有 SVGA 有：可以动态替换的图层 */
  slots?: SvgaSlot[];
}

const EMPTY: ProbeResult = { width: null, height: null, durationMs: null, hasAlpha: false };

let ffprobeOk: boolean | null = null;
async function hasFfprobe(): Promise<boolean> {
  if (ffprobeOk === null) ffprobeOk = await run('ffprobe', ['-version']).then(() => true, () => false);
  return ffprobeOk;
}

/**
 * 按扩展名指定 ffprobe 的格式（不让它按内容猜：否则一个 .mp3 文件可以被当成播放列表去读别的文件），
 * 并且只允许读本地文件。APNG 有可能其实是普通 PNG，失败时按 PNG 再试一次
 */
const FFPROBE_FORMAT: Record<string, string[]> = {
  webm: ['matroska'],
  mp4: ['mov'],
  gif: ['gif'],
  png: ['png_pipe'],
  apng: ['apng', 'png_pipe'],
  webp: ['webp_pipe'],
  jpg: ['jpeg_pipe'],
  jpeg: ['jpeg_pipe'],
  mp3: ['mp3'],
  wav: ['wav'],
  ogg: ['ogg'],
};

async function ffprobe(file: string, ext: string): Promise<ProbeResult> {
  if (!(await hasFfprobe())) return EMPTY;
  const formats = FFPROBE_FORMAT[ext];
  if (!formats) throw new Error(`不支持的文件类型：${ext}`);
  let stdout = '';
  for (const [i, f] of formats.entries()) {
    try {
      ({ stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-f', f, '-show_entries', 'stream=codec_type,width,height,pix_fmt,duration:stream_tags=alpha_mode:format=duration', '-of', 'json', file], { timeout: 20_000 }));
      break;
    } catch (e) {
      if (i === formats.length - 1) throw e;
    }
  }
  const j = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number; pix_fmt?: string; duration?: string; tags?: { alpha_mode?: string; ALPHA_MODE?: string } }>; format?: { duration?: string } };
  const v = j.streams?.find((x) => x.codec_type === 'video');
  // WebM 的时长只在容器上（流上是 N/A）
  const secs = [v?.duration, j.format?.duration].map(Number).find((x) => Number.isFinite(x) && x > 0);
  const alpha = v?.tags?.alpha_mode === '1' || v?.tags?.ALPHA_MODE === '1' || /^(yuva|rgba|bgra|argb|abgr|ya|gbrap|pal8)/.test(v?.pix_fmt ?? '');
  return { width: v?.width ?? null, height: v?.height ?? null, durationMs: secs ? Math.round(secs * 1000) : null, hasAlpha: Boolean(v) && alpha };
}

const svgaRoot = protobuf.Root.fromJSON({
  nested: {
    MovieParams: { fields: { viewBoxWidth: { type: 'float', id: 1 }, viewBoxHeight: { type: 'float', id: 2 }, fps: { type: 'int32', id: 3 }, frames: { type: 'int32', id: 4 } } },
    SpriteEntity: { fields: { imageKey: { type: 'string', id: 1 }, matteKey: { type: 'string', id: 3 } } },
    MovieEntity: { fields: { version: { type: 'string', id: 1 }, params: { type: 'MovieParams', id: 2 }, images: { keyType: 'string', type: 'bytes', id: 3 }, sprites: { rule: 'repeated', type: 'SpriteEntity', id: 4 } } },
  },
} as protobuf.INamespace);

/** PNG 的宽高（文件头里的 IHDR）；不是 PNG 时为 0 */
function pngSize(b: Buffer | Uint8Array | undefined): { w: number; h: number } {
  if (!b || b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return { w: 0, h: 0 };
  const v = Buffer.from(b.buffer, b.byteOffset, 24);
  return { w: v.readUInt32BE(16), h: v.readUInt32BE(20) };
}

/** 图层：被精灵用到的图片（遮罩用的除外），按第一次出现的顺序 */
function slotsOf(sprites: Array<{ imageKey?: string; matteKey?: string }>, size: (key: string) => { w: number; h: number }): SvgaSlot[] {
  const mattes = new Set(sprites.map((s) => s.matteKey).filter(Boolean));
  const seen = new Set<string>();
  const out: SvgaSlot[] = [];
  for (const sp of sprites) {
    const k = sp.imageKey;
    if (!k || seen.has(k) || mattes.has(k) || k.endsWith('.matte')) continue;
    seen.add(k);
    out.push({ key: k, ...size(k) });
  }
  return out.slice(0, 200);
}

async function probeSvga(file: string): Promise<ProbeResult> {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return probeSvga1(file);
  const T = svgaRoot.lookupType('MovieEntity');
  // 限制解压后的大小：防止很小的压缩炸弹解压出几个 GB 把内存撑爆
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(buf, { maxOutputLength: SVGA_MAX_BYTES });
  } catch {
    throw new Error('SVGA 文件损坏或解压后太大');
  }
  const m = T.toObject(T.decode(raw), { defaults: false }) as { params?: { viewBoxWidth?: number; viewBoxHeight?: number; fps?: number; frames?: number }; images?: Record<string, Uint8Array>; sprites?: Array<{ imageKey?: string; matteKey?: string }> };
  const p = m.params ?? {};
  return {
    width: p.viewBoxWidth ? Math.round(p.viewBoxWidth) : null,
    height: p.viewBoxHeight ? Math.round(p.viewBoxHeight) : null,
    durationMs: p.fps && p.frames ? Math.round((p.frames / p.fps) * 1000) : null,
    hasAlpha: true,
    slots: slotsOf(m.sprites ?? [], (k) => pngSize(m.images?.[k])),
  };
}

/** 1.x：zip 里的 movie.spec（JSON）和图片 */
async function probeSvga1(file: string): Promise<ProbeResult> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (e, z) => (e || !z ? reject(e ?? new Error('zip')) : resolve(z))));
  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    let total = 0;
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      // 只读 movie.spec 和图片的文件头（取宽高），不整个解压
      const want = name === 'movie.spec' || name.endsWith('.png');
      if (!want || entry.uncompressedSize > SVGA_MAX_BYTES) return zip.readEntry();
      zip.openReadStream(entry, (e, st) => {
        if (e || !st) return reject(e ?? new Error('zip'));
        const chunks: Buffer[] = [];
        let got = 0;
        st.on('data', (c: Buffer) => {
          got += c.length; total += c.length;
          if (total > SVGA_MAX_BYTES) { st.destroy(); return reject(new Error('SVGA 文件解压后太大')); }
          // 图片只留开头几十个字节（够读宽高）
          if (name === 'movie.spec' || got - c.length < 64) chunks.push(c);
        });
        st.on('end', () => { files.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        st.on('error', reject);
      });
    });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });
  zip.close();
  const specBuf = files.get('movie.spec');
  if (!specBuf) return { ...EMPTY, hasAlpha: true, slots: [] };
  let spec: { movie?: { viewBox?: { width?: number; height?: number }; fps?: number; frames?: number }; images?: Record<string, string>; sprites?: Array<{ imageKey?: string; matteKey?: string }> };
  try {
    spec = JSON.parse(specBuf.toString('utf8'));
  } catch {
    throw new Error('SVGA 文件损坏（movie.spec 不是有效的 JSON）');
  }
  const mv = spec.movie ?? {};
  return {
    width: mv.viewBox?.width ? Math.round(mv.viewBox.width) : null,
    height: mv.viewBox?.height ? Math.round(mv.viewBox.height) : null,
    durationMs: mv.fps && mv.frames ? Math.round((mv.frames / mv.fps) * 1000) : null,
    hasAlpha: true,
    slots: slotsOf(spec.sprites ?? [], (k) => pngSize(files.get(`${spec.images?.[k] ?? k}.png`))),
  };
}

const SVGA_MAX_BYTES = 64 * 1024 * 1024;
const LOTTIE_MAX_BYTES = 20 * 1024 * 1024;

function probeLottie(file: string): ProbeResult {
  if (fs.statSync(file).size > LOTTIE_MAX_BYTES) throw new Error(`Lottie 动画文件不能超过 ${LOTTIE_MAX_BYTES / 1024 / 1024} MB`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { w?: number; h?: number; fr?: number; ip?: number; op?: number; layers?: unknown };
  if (!Array.isArray(j.layers)) throw new Error('不是有效的 Lottie 动画文件');
  const frames = (j.op ?? 0) - (j.ip ?? 0);
  return { width: j.w ?? null, height: j.h ?? null, durationMs: j.fr && frames > 0 ? Math.round((frames / j.fr) * 1000) : null, hasAlpha: true };
}

export async function probe(file: string, type: FileType): Promise<ProbeResult> {
  if (type.ext === 'svga') return probeSvga(file);
  if (type.ext === 'json') return probeLottie(file);
  const r = await ffprobe(file, type.ext);
  if (type.kind === 'audio') return { ...r, width: null, height: null, hasAlpha: false };
  if (type.ext === 'jpg') return { ...r, durationMs: null, hasAlpha: false };
  if (type.ext === 'mp4') return { ...r, hasAlpha: false };
  // 静态 PNG 没有时长
  if (type.ext === 'png') return { ...r, durationMs: null };
  return r;
}
