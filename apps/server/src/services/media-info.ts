// 读取视频、图片、音频的宽高、时长、是否透明（代替 ffprobe：桌面版不用再带一个 100 多 MB 的 ffprobe.exe）。
// 只读文件头和必要的结构，不解码画面；文件结构不对时抛错（上传时会提示「无法识别这个文件」）
import fs from 'node:fs';

export interface MediaInfo {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAlpha: boolean;
}

const NONE: MediaInfo = { width: null, height: null, durationMs: null, hasAlpha: false };
const BLOCK = 64 * 1024;

/** 按位置读文件，带一块 64 KB 的缓存（顺着往下读的格式大多命中缓存）；超出文件末尾时返回较短的 Buffer */
class Reader {
  private start = 0;
  private buf = Buffer.alloc(0);
  private fd: number;
  readonly size: number;
  constructor(fd: number) {
    this.fd = fd;
    this.size = fs.fstatSync(fd).size;
  }
  read(pos: number, len: number): Buffer {
    if (pos >= this.start && pos + len <= this.start + this.buf.length) return this.buf.subarray(pos - this.start, pos - this.start + len);
    const n = Math.max(0, Math.min(Math.max(len, BLOCK), this.size - pos));
    const b = Buffer.alloc(n);
    const got = n > 0 ? fs.readSync(this.fd, b, 0, n, pos) : 0;
    this.start = pos;
    this.buf = b.subarray(0, got);
    return this.buf.subarray(0, len);
  }
  /** 读满 len 个字节，不够就是文件被截断了 */
  must(pos: number, len: number): Buffer {
    const b = this.read(pos, len);
    if (b.length < len) throw new Error('文件不完整');
    return b;
  }
}

const ms = (secs: number): number | null => (Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null);

// ---------- WebM（Matroska / EBML） ----------

const EBML = { Header: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, AlphaMode: 0x53c0, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b };
/** Cluster 里可能出现的子元素：大小未知的 Cluster 读到别的元素就算结束 */
const CLUSTER_CHILDREN = new Set([EBML.Timecode, EBML.SimpleBlock, EBML.BlockGroup, 0xa7, 0xab, 0x5854, 0xec, 0xbf]);

interface El {
  id: number;
  /** 内容开始的位置 */
  pos: number;
  /** 内容长度；null = 大小未知（边录边写的文件） */
  size: number | null;
  /** 元素头的长度 */
  head: number;
}

function vint(b: Buffer, at: number, keepMarker: boolean): { v: number; len: number; unknown: boolean } | null {
  const first = b[at];
  if (!first) return null;
  const len = Math.clz32(first) - 23;
  if (len > 8 || at + len > b.length) return null;
  let v = keepMarker ? first : first & (0xff >> len);
  let ones = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) ones = false;
  }
  return { v, len, unknown: !keepMarker && ones };
}

function element(r: Reader, pos: number): El | null {
  const b = r.read(pos, 12);
  const id = vint(b, 0, true);
  if (!id || id.len > 4) return null;
  const size = vint(b, id.len, false);
  if (!size) return null;
  return { id: id.v, pos: pos + id.len + size.len, size: size.unknown ? null : size.v, head: id.len + size.len };
}

function uint(r: Reader, el: El): number {
  const b = r.must(el.pos, el.size ?? 0);
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
}

function float(r: Reader, el: El): number {
  if (el.size === 4) return r.must(el.pos, 4).readFloatBE(0);
  if (el.size === 8) return r.must(el.pos, 8).readDoubleBE(0);
  return NaN;
}

/** 依次列出 [start, end) 里的子元素（大小未知的子元素会让列举停在那里） */
function children(r: Reader, start: number, end: number): El[] {
  const out: El[] = [];
  for (let pos = start; pos < end; ) {
    const el = element(r, pos);
    if (!el) break;
    out.push(el);
    if (el.size === null) break;
    pos = el.pos + el.size;
  }
  return out;
}

function probeWebm(r: Reader): MediaInfo {
  const header = element(r, 0);
  if (!header || header.id !== EBML.Header || header.size === null) throw new Error('不是有效的 WebM 文件');
  const seg = element(r, header.pos + header.size);
  if (!seg || seg.id !== EBML.Segment) throw new Error('不是有效的 WebM 文件');
  const segEnd = seg.size === null ? r.size : Math.min(r.size, seg.pos + seg.size);

  let scale = 1_000_000;
  let duration = NaN;
  let video: { num: number; w: number; h: number; alpha: boolean; frameNs: number } | null = null;
  let tracksSeen = false;
  // 容器上没写时长时，用最后一帧的时间（边录边写的文件）
  let lastTc = -1;
  let lastDur = 0;

  const block = (el: El, clusterTc: number, dur: number) => {
    const b = r.read(el.pos, 12);
    const track = vint(b, 0, false);
    if (!track || (video && track.v !== video.num) || b.length < track.len + 2) return;
    const tc = clusterTc + b.readInt16BE(track.len);
    if (tc >= lastTc) {
      lastTc = tc;
      lastDur = dur;
    }
  };

  const cluster = (el: El): number => {
    let tc = 0;
    let pos = el.pos;
    const end = el.size === null ? segEnd : el.pos + el.size;
    while (pos < end) {
      const c = element(r, pos);
      if (!c || c.size === null) return end;
      // 大小未知的 Cluster：遇到不属于 Cluster 的元素（下一个 Cluster 等）就结束
      if (el.size === null && !CLUSTER_CHILDREN.has(c.id)) return pos;
      if (c.id === EBML.Timecode) tc = uint(r, c);
      else if (c.id === EBML.SimpleBlock) block(c, tc, 0);
      else if (c.id === EBML.BlockGroup) {
        const kids = children(r, c.pos, c.pos + c.size);
        const d = kids.find((k) => k.id === EBML.BlockDuration);
        const b = kids.find((k) => k.id === EBML.Block);
        if (b) block(b, tc, d ? uint(r, d) : 0);
      }
      pos = c.pos + c.size;
    }
    return end;
  };

  for (let pos = seg.pos; pos < segEnd; ) {
    const el = element(r, pos);
    if (!el) break;
    if (el.id === EBML.Cluster) {
      // 容器上有时长，轨道也读到了：后面的画面数据不用看
      if (tracksSeen && Number.isFinite(duration)) break;
      pos = cluster(el);
      continue;
    }
    if (el.size === null) break;
    if (el.id === EBML.Info) {
      for (const c of children(r, el.pos, el.pos + el.size)) {
        if (c.id === EBML.TimecodeScale) scale = uint(r, c) || scale;
        else if (c.id === EBML.Duration) duration = float(r, c);
      }
    } else if (el.id === EBML.Tracks) {
      tracksSeen = true;
      for (const t of children(r, el.pos, el.pos + el.size)) {
        if (t.id !== EBML.TrackEntry || t.size === null || video) continue;
        const f = children(r, t.pos, t.pos + t.size);
        const get = (id: number) => f.find((c) => c.id === id);
        const type = get(EBML.TrackType);
        const v = get(EBML.Video);
        if (!type || uint(r, type) !== 1 || !v || v.size === null) continue;
        const vf = children(r, v.pos, v.pos + v.size);
        const vget = (id: number) => vf.find((c) => c.id === id);
        const num = get(EBML.TrackNumber);
        const dd = get(EBML.DefaultDuration);
        const w = vget(EBML.PixelWidth);
        const h = vget(EBML.PixelHeight);
        const a = vget(EBML.AlphaMode);
        video = { num: num ? uint(r, num) : 1, w: w ? uint(r, w) : 0, h: h ? uint(r, h) : 0, alpha: a ? uint(r, a) === 1 : false, frameNs: dd ? uint(r, dd) : 0 };
      }
    }
    pos = el.pos + el.size;
  }

  if (!tracksSeen) throw new Error('WebM 文件里没有轨道信息');
  let secs = (duration * scale) / 1e9;
  if (!(secs > 0) && lastTc >= 0) secs = ((lastTc + lastDur) * scale + (lastDur ? 0 : (video?.frameNs ?? 0))) / 1e9;
  return { width: video?.w || null, height: video?.h || null, durationMs: ms(secs), hasAlpha: Boolean(video?.alpha) };
}

// ---------- MP4（ISO BMFF） ----------

interface Box {
  type: string;
  pos: number;
  end: number;
}

function boxes(r: Reader, start: number, end: number): Box[] {
  const out: Box[] = [];
  for (let pos = start; pos + 8 <= end; ) {
    const h = r.read(pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    let head = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = Number(h.readBigUInt64BE(8));
      head = 16;
    } else if (size === 0) size = end - pos;
    if (size < head) break;
    out.push({ type: h.toString('latin1', 4, 8), pos: pos + head, end: Math.min(end, pos + size) });
    pos += size;
  }
  return out;
}

const child = (r: Reader, b: Box | undefined, type: string): Box | undefined => (b ? boxes(r, b.pos, b.end).find((x) => x.type === type) : undefined);

/** mvhd / mdhd：时间单位和时长（秒） */
function mediaHeader(r: Reader, b: Box | undefined): number {
  if (!b) return NaN;
  const h = r.must(b.pos, 32);
  const v1 = h[0] === 1;
  const timescale = h.readUInt32BE(v1 ? 20 : 12);
  const dur = v1 ? Number(h.readBigUInt64BE(24)) : h.readUInt32BE(16);
  // 全 1 表示时长未知
  if (!timescale || dur === 0xffffffff || (v1 && h.readBigUInt64BE(24) === 0xffffffffffffffffn)) return NaN;
  return dur / timescale;
}

function probeMp4(r: Reader): MediaInfo {
  const moov = boxes(r, 0, r.size).find((b) => b.type === 'moov');
  if (!moov) throw new Error('MP4 文件不完整（找不到 moov）');
  const top = boxes(r, moov.pos, moov.end);
  const mvhd = top.find((b) => b.type === 'mvhd');
  let width: number | null = null;
  let height: number | null = null;
  let videoSecs = NaN;
  let video: { id: number; timescale: number } | null = null;
  for (const trak of top.filter((b) => b.type === 'trak')) {
    const mdia = child(r, trak, 'mdia');
    const hdlr = child(r, mdia, 'hdlr');
    if (!hdlr || r.must(hdlr.pos + 8, 4).toString('latin1') !== 'vide') continue;
    const stsd = child(r, child(r, child(r, mdia, 'minf'), 'stbl'), 'stsd');
    if (stsd) {
      // stsd：版本和标记 4、条目数 4，第一个条目：大小 4、类型 4、保留 6、引用 2、预留 16、宽 2、高 2
      const e = r.must(stsd.pos + 8, 36);
      width = e.readUInt16BE(32) || null;
      height = e.readUInt16BE(34) || null;
    }
    const mdhd = child(r, mdia, 'mdhd');
    videoSecs = mediaHeader(r, mdhd);
    const tkhd = child(r, trak, 'tkhd');
    if (tkhd && mdhd) {
      const t = r.must(tkhd.pos, 24);
      const m = r.must(mdhd.pos, 24);
      video = { id: t.readUInt32BE(t[0] === 1 ? 20 : 12), timescale: m.readUInt32BE(m[0] === 1 ? 20 : 12) };
    }
    break;
  }
  let secs = videoSecs > 0 ? videoSecs : mediaHeader(r, mvhd);
  // 分片的 MP4（例如 OBS 的「分片 MP4」录像）：moov 里没有时长，把每个分片里画面的时长加起来
  if (!(secs > 0) && video) secs = fragmentSecs(r, top, video);
  return { width, height, durationMs: ms(secs), hasAlpha: false };
}

function fragmentSecs(r: Reader, moovKids: Box[], video: { id: number; timescale: number }): number {
  if (!video.timescale) return NaN;
  let defDur = 0;
  for (const trex of boxes(r, ...range(moovKids.find((b) => b.type === 'mvex'))).filter((b) => b.type === 'trex')) {
    const t = r.must(trex.pos, 16);
    if (t.readUInt32BE(4) === video.id) defDur = t.readUInt32BE(12);
  }
  let total = 0;
  for (const moof of boxes(r, 0, r.size).filter((b) => b.type === 'moof')) {
    for (const traf of boxes(r, moof.pos, moof.end).filter((b) => b.type === 'traf')) {
      const kids = boxes(r, traf.pos, traf.end);
      const tfhd = kids.find((b) => b.type === 'tfhd');
      if (!tfhd) continue;
      const h = r.must(tfhd.pos, 8);
      if (h.readUInt32BE(4) !== video.id) continue;
      const tf = h.readUIntBE(1, 3);
      // tfhd 里可选的字段：基准位置 8、样本描述 4，然后才是默认帧长
      let dur = defDur;
      if (tf & 0x08) dur = r.must(tfhd.pos + 8 + (tf & 0x01 ? 8 : 0) + (tf & 0x02 ? 4 : 0), 4).readUInt32BE(0);
      for (const trun of kids.filter((b) => b.type === 'trun')) {
        const t = r.must(trun.pos, 8);
        const f = t.readUIntBE(1, 3);
        const count = t.readUInt32BE(4);
        if (!(f & 0x100)) {
          total += count * dur;
          continue;
        }
        // 每帧单独写了时长：帧长 4、大小 4、标记 4、显示时间偏移 4（有哪些看标记）
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((x) => f & x).length;
        let p = trun.pos + 8 + (f & 0x01 ? 4 : 0) + (f & 0x04 ? 4 : 0);
        for (let i = 0; i < count && p + 4 <= trun.end; i++, p += stride) total += r.must(p, 4).readUInt32BE(0);
      }
    }
  }
  return total / video.timescale;
}

const range = (b: Box | undefined): [number, number] => (b ? [b.pos, b.end] : [0, 0]);

// ---------- 图片 ----------

function probeGif(r: Reader): MediaInfo {
  const h = r.must(0, 13);
  if (h.toString('latin1', 0, 3) !== 'GIF') throw new Error('不是有效的 GIF 文件');
  const width = h.readUInt16LE(6);
  const height = h.readUInt16LE(8);
  let pos = 13 + (h[10]! & 0x80 ? 3 * 2 ** ((h[10]! & 7) + 1) : 0);
  let delay = 0;
  let frames = 0;
  let cs = 0;
  // 跳过一串数据子块（每块开头一个字节是长度，0 结束）
  const skipBlocks = (p: number) => {
    for (;;) {
      const n = r.must(p, 1)[0]!;
      p += 1 + n;
      if (n === 0) return p;
    }
  };
  for (;;) {
    const t = r.read(pos, 1)[0];
    if (t === undefined || t === 0x3b) break;
    if (t === 0x21) {
      const label = r.must(pos + 1, 1)[0];
      if (label === 0xf9) delay = r.must(pos + 2, 6).readUInt16LE(2);
      pos = skipBlocks(pos + 2);
    } else if (t === 0x2c) {
      const d = r.must(pos, 10);
      pos += 10 + (d[9]! & 0x80 ? 3 * 2 ** ((d[9]! & 7) + 1) : 0) + 1;
      pos = skipBlocks(pos);
      // 和浏览器、ffmpeg 一样：小于 0.02 秒的间隔按 0.1 秒算
      cs += delay < 2 ? 10 : delay;
      frames++;
      delay = 0;
    } else throw new Error('GIF 文件损坏');
  }
  if (!frames) throw new Error('GIF 文件里没有画面');
  // GIF 的解码结果总是带透明通道（和 ffprobe 的 bgra 一致）
  return { width, height, durationMs: ms(cs / 100), hasAlpha: true };
}

function probePng(r: Reader): MediaInfo {
  const sig = r.must(0, 8);
  if (sig.readUInt32BE(0) !== 0x89504e47) throw new Error('不是有效的 PNG 文件');
  const ihdr = r.must(8, 25);
  if (ihdr.toString('latin1', 4, 8) !== 'IHDR') throw new Error('PNG 文件损坏');
  const width = ihdr.readUInt32BE(8);
  const height = ihdr.readUInt32BE(12);
  const colorType = ihdr[17]!;
  let trns = false;
  let animated = false;
  let secs = 0;
  for (let pos = 8; pos + 12 <= r.size; ) {
    const c = r.must(pos, 8);
    const len = c.readUInt32BE(0);
    const type = c.toString('latin1', 4, 8);
    if (type === 'tRNS') trns = true;
    else if (type === 'acTL') animated = true;
    else if (type === 'fcTL' && len >= 26) {
      const f = r.must(pos + 8, 26);
      const num = f.readUInt16BE(20);
      const den = f.readUInt16BE(22) || 100;
      // 间隔为 0 时浏览器按尽快播放，ffmpeg 按 1/15 秒；取 ffmpeg 的
      secs += num ? num / den : 1 / 15;
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  // 颜色类型 4（灰度 + 透明）、6（RGBA）自带透明；其他类型有 tRNS 块时也有透明色
  return { width, height, durationMs: animated ? ms(secs) : null, hasAlpha: colorType === 4 || colorType === 6 || trns };
}

function probeWebp(r: Reader): MediaInfo {
  const h = r.must(0, 12);
  if (h.toString('latin1', 0, 4) !== 'RIFF' || h.toString('latin1', 8, 12) !== 'WEBP') throw new Error('不是有效的 WebP 文件');
  let info: MediaInfo | null = null;
  let animMs = 0;
  let animated = false;
  for (let pos = 12; pos + 8 <= r.size; ) {
    const c = r.must(pos, 8);
    const type = c.toString('latin1', 0, 4);
    const len = c.readUInt32LE(4);
    const d = r.read(pos + 8, Math.min(len, 32));
    if (type === 'VP8X' && d.length >= 10) {
      animated = Boolean(d[0]! & 0x02);
      info = { width: d.readUIntLE(4, 3) + 1, height: d.readUIntLE(7, 3) + 1, durationMs: null, hasAlpha: Boolean(d[0]! & 0x10) };
    } else if (type === 'ANMF' && d.length >= 16) animMs += d.readUIntLE(12, 3);
    else if (!info && type === 'VP8 ' && d.length >= 10) {
      if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new Error('WebP 文件损坏');
      info = { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff, durationMs: null, hasAlpha: false };
    } else if (!info && type === 'VP8L' && d.length >= 5) {
      if (d[0] !== 0x2f) throw new Error('WebP 文件损坏');
      const bits = d.readUInt32LE(1);
      info = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, durationMs: null, hasAlpha: Boolean((bits >>> 28) & 1) };
    }
    pos += 8 + len + (len & 1);
  }
  if (!info) throw new Error('WebP 文件损坏');
  return { ...info, durationMs: animated ? ms(animMs / 1000) : null };
}

function probeJpeg(r: Reader): MediaInfo {
  if (r.must(0, 2).readUInt16BE(0) !== 0xffd8) throw new Error('不是有效的 JPEG 文件');
  for (let pos = 2; pos + 4 <= r.size; ) {
    const m = r.must(pos, 4);
    if (m[0] !== 0xff) throw new Error('JPEG 文件损坏');
    const marker = m[1]!;
    // 填充字节和没有长度的标记
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    // SOF0 ~ SOF15（C4 DHT、C8、CC DAC 除外）：精度 1、高 2、宽 2
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const f = r.must(pos + 4, 5);
      return { width: f.readUInt16BE(3), height: f.readUInt16BE(1), durationMs: null, hasAlpha: false };
    }
    pos += 2 + m.readUInt16BE(2);
  }
  throw new Error('JPEG 文件里找不到图片尺寸');
}

// ---------- 音频 ----------

const MP3_BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];

interface Mp3Frame {
  len: number;
  rate: number;
  spf: number;
  /** Xing / Info 标签相对帧开头的位置 */
  xingAt: number;
}

function mp3Frame(h: Buffer): Mp3Frame | null {
  if (h.length < 4 || h[0] !== 0xff || (h[1]! & 0xe0) !== 0xe0) return null;
  const ver = (h[1]! >> 3) & 3;
  const layer = (h[1]! >> 1) & 3;
  const bi = h[2]! >> 4;
  const ri = (h[2]! >> 2) & 3;
  const rates = MP3_RATES[ver];
  if (!rates || layer === 0 || bi === 0 || bi === 15 || ri === 3) return null;
  const v1 = ver === 3;
  const table = layer === 3 ? (v1 ? MP3_BITRATES.v1l1 : MP3_BITRATES.v2l1) : layer === 2 ? (v1 ? MP3_BITRATES.v1l2 : MP3_BITRATES.v2l23) : v1 ? MP3_BITRATES.v1l3 : MP3_BITRATES.v2l23;
  const bitrate = table[bi]! * 1000;
  const rate = rates[ri]!;
  const pad = (h[2]! >> 1) & 1;
  const spf = layer === 3 ? 384 : layer === 2 || v1 ? 1152 : 576;
  const len = layer === 3 ? (Math.floor((12 * bitrate) / rate) + pad) * 4 : Math.floor(((spf / 8) * bitrate) / rate) + pad;
  const mono = h[3]! >> 6 === 3;
  return { len, rate, spf, xingAt: 4 + (v1 ? (mono ? 17 : 32) : mono ? 9 : 17) };
}

function probeMp3(r: Reader): MediaInfo {
  let start = 0;
  const id3 = r.must(0, 10);
  if (id3.toString('latin1', 0, 3) === 'ID3') start = 10 + ((id3[6]! & 0x7f) << 21) + ((id3[7]! & 0x7f) << 14) + ((id3[8]! & 0x7f) << 7) + (id3[9]! & 0x7f) + (id3[5]! & 0x10 ? 10 : 0);
  // 找第一帧：帧头合法，并且下一帧也接得上（避免把普通数据误认成帧头）
  let pos = -1;
  let f: Mp3Frame | null = null;
  for (let p = start; p < Math.min(r.size, start + BLOCK); p++) {
    const cand = mp3Frame(r.read(p, 4));
    if (!cand) continue;
    const next = p + cand.len;
    if (next + 4 <= r.size && !mp3Frame(r.read(next, 4))) continue;
    pos = p;
    f = cand;
    break;
  }
  if (!f) throw new Error('不是有效的 MP3 文件（找不到音频帧）');
  // VBR 文件开头有 Xing / Info 或 VBRI 标签，里面写着总帧数
  let frames = 0;
  const x = r.read(pos + f.xingAt, 12);
  if (['Xing', 'Info'].includes(x.toString('latin1', 0, 4)) && x.length >= 12 && x.readUInt32BE(4) & 1) frames = x.readUInt32BE(8);
  const v = r.read(pos + 36, 18);
  if (!frames && v.toString('latin1', 0, 4) === 'VBRI' && v.length >= 18) frames = v.readUInt32BE(14);
  if (frames) return { ...NONE, durationMs: ms((frames * f.spf) / f.rate) };
  // 没有标签：一帧一帧数过去（每帧的长度写在帧头里，只读帧头）
  let samples = 0;
  let p = pos;
  for (let fr = mp3Frame(r.read(p, 4)); fr; fr = mp3Frame(r.read(p, 4))) {
    samples += fr.spf / fr.rate;
    p += fr.len;
  }
  return { ...NONE, durationMs: ms(samples) };
}

function probeWav(r: Reader): MediaInfo {
  const h = r.must(0, 12);
  if (h.toString('latin1', 0, 4) !== 'RIFF' || h.toString('latin1', 8, 12) !== 'WAVE') throw new Error('不是有效的 WAV 文件');
  let byteRate = 0;
  for (let pos = 12; pos + 8 <= r.size; ) {
    const c = r.must(pos, 8);
    const type = c.toString('latin1', 0, 4);
    let len = c.readUInt32LE(4);
    if (type === 'fmt ') byteRate = r.must(pos + 8, 12).readUInt32LE(8);
    else if (type === 'data') {
      if (!byteRate) break;
      // 边录边写的文件长度可能是 0 或全 1：按文件剩下的长度算
      if (len === 0 || pos + 8 + len > r.size) len = r.size - pos - 8;
      return { ...NONE, durationMs: ms(len / byteRate) };
    }
    pos += 8 + len + (len & 1);
  }
  throw new Error('WAV 文件损坏（找不到音频数据）');
}

function probeOgg(r: Reader): MediaInfo {
  const page = r.must(0, 27);
  if (page.toString('latin1', 0, 4) !== 'OggS') throw new Error('不是有效的 Ogg 文件');
  const serial = page.readUInt32LE(14);
  const nseg = page[26]!;
  const lacing = r.must(27, nseg);
  const first = r.read(27 + nseg, Math.min(lacing[0] ?? 0, 64));
  let rate = 0;
  let skip = 0;
  if (first.toString('latin1', 1, 7) === 'vorbis' && first.length >= 16) rate = first.readUInt32LE(12);
  else if (first.toString('latin1', 0, 8) === 'OpusHead' && first.length >= 12) {
    rate = 48000;
    skip = first.readUInt16LE(10);
  } else if (first.toString('latin1', 1, 5) === 'FLAC' && first.length >= 30) rate = (first[27]! << 12) | (first[28]! << 4) | (first[29]! >> 4);
  if (!rate) return NONE;
  // 从文件末尾往前找这条流最后一页的位置（granule position = 到这一页为止的采样数）
  for (let end = r.size; end > 0; ) {
    const from = Math.max(0, end - BLOCK);
    const b = r.read(from, end - from + 27);
    for (let i = Math.min(b.length - 27, end - from - 1); i >= 0; i--) {
      if (b[i] !== 0x4f || b.toString('latin1', i, i + 4) !== 'OggS' || b.readUInt32LE(i + 14) !== serial) continue;
      const g = b.readBigInt64LE(i + 6);
      if (g >= 0n) return { ...NONE, durationMs: ms((Number(g) - skip) / rate) };
    }
    end = from;
  }
  return NONE;
}

const PROBES: Record<string, (r: Reader) => MediaInfo> = {
  webm: probeWebm,
  mp4: probeMp4,
  gif: probeGif,
  png: probePng,
  apng: probePng,
  webp: probeWebp,
  jpg: probeJpeg,
  jpeg: probeJpeg,
  mp3: probeMp3,
  wav: probeWav,
  ogg: probeOgg,
};

export function mediaInfo(file: string, ext: string): MediaInfo {
  const fn = PROBES[ext];
  if (!fn) throw new Error(`不支持的文件类型：${ext}`);
  const fd = fs.openSync(file, 'r');
  try {
    return fn(new Reader(fd));
  } catch (e) {
    // 读到一半发现长度不对之类的越界错误，统一成「文件损坏」
    if (e instanceof RangeError) throw new Error('文件损坏', { cause: e });
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}
