// 识别上传文件：按文件头判断真实类型，读取尺寸、时长、是否透明（需求 F-AS-02 ~ 04）。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import protobuf from 'protobufjs';

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

export interface ProbeResult {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAlpha: boolean;
}

const EMPTY: ProbeResult = { width: null, height: null, durationMs: null, hasAlpha: false };

let ffprobeOk: boolean | null = null;
async function hasFfprobe(): Promise<boolean> {
  if (ffprobeOk === null) ffprobeOk = await run('ffprobe', ['-version']).then(() => true, () => false);
  return ffprobeOk;
}

async function ffprobe(file: string): Promise<ProbeResult> {
  if (!(await hasFfprobe())) return EMPTY;
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,pix_fmt,duration:stream_tags=alpha_mode:format=duration', '-of', 'json', file], { timeout: 20_000 });
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
    MovieEntity: { fields: { version: { type: 'string', id: 1 }, params: { type: 'MovieParams', id: 2 } } },
  },
});

function probeSvga(file: string): ProbeResult {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return { ...EMPTY, hasAlpha: true }; // 1.x 格式不解析
  const T = svgaRoot.lookupType('MovieEntity');
  const m = T.toObject(T.decode(zlib.inflateSync(buf)), { defaults: false }) as { params?: { viewBoxWidth?: number; viewBoxHeight?: number; fps?: number; frames?: number } };
  const p = m.params ?? {};
  return {
    width: p.viewBoxWidth ? Math.round(p.viewBoxWidth) : null,
    height: p.viewBoxHeight ? Math.round(p.viewBoxHeight) : null,
    durationMs: p.fps && p.frames ? Math.round((p.frames / p.fps) * 1000) : null,
    hasAlpha: true,
  };
}

function probeLottie(file: string): ProbeResult {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { w?: number; h?: number; fr?: number; ip?: number; op?: number; layers?: unknown };
  if (!Array.isArray(j.layers)) throw new Error('不是有效的 Lottie 动画文件');
  const frames = (j.op ?? 0) - (j.ip ?? 0);
  return { width: j.w ?? null, height: j.h ?? null, durationMs: j.fr && frames > 0 ? Math.round((frames / j.fr) * 1000) : null, hasAlpha: true };
}

export async function probe(file: string, type: FileType): Promise<ProbeResult> {
  if (type.ext === 'svga') return probeSvga(file);
  if (type.ext === 'json') return probeLottie(file);
  const r = await ffprobe(file);
  if (type.kind === 'audio') return { ...r, width: null, height: null, hasAlpha: false };
  if (type.ext === 'jpg') return { ...r, durationMs: null, hasAlpha: false };
  if (type.ext === 'mp4') return { ...r, hasAlpha: false };
  // 静态 PNG 没有时长
  if (type.ext === 'png') return { ...r, durationMs: null };
  return r;
}
