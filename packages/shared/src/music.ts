// 弹幕点歌：服务端、点歌窗口（特效页程序的 &music=1）、管理后台共用的类型。
// 这里不引入 Zod（点歌窗口也用），设置的校验在 music-rules.ts。
import type { GuardLevel } from './events.ts';

/** 歌从哪里来：网易云音乐、本地歌库 */
export type MusicSource = 'netease' | 'local';

export interface MusicSong {
  source: MusicSource;
  /** 网易云的歌曲编号，或本地歌库的编号（都存成字符串） */
  id: string;
  name: string;
  /** 歌手（多位用 / 隔开） */
  artists: string;
  album?: string;
  /** 封面地址（网易云的图片地址，或本地歌库的封面文件） */
  cover?: string;
  durationMs: number;
}

/** 点歌的人 */
export interface MusicRequester {
  uid: number;
  name: string;
  face?: string;
  guard: GuardLevel;
}

/** 列表里的一首歌 */
export interface MusicItem {
  /** 点歌记录的编号 */
  id: number;
  song: MusicSong;
  by: MusicRequester;
  /** 点歌时间（毫秒时间戳） */
  at: number;
}

/** 一句歌词：t 是开始时间（毫秒），tr 是翻译 */
export interface LyricLine {
  t: number;
  text: string;
  tr?: string;
}

/** 点歌窗口的样子（后台「点歌 · 画面」里设置） */
export interface MusicDisplay {
  /** 常规：card 玻璃卡片、vinyl 黑胶唱片、capsule 细长胶囊；风格：glass 流光、journal 手帐（日系）、minimal 灵动岛 */
  style: 'card' | 'vinyl' | 'capsule' | 'glass' | 'journal' | 'minimal';
  side: 'left' | 'right';
  size: 'normal' | 'large';
  /** 显示后面几首（0 不显示列表） */
  showQueue: number;
  lyrics: boolean;
  /** 歌词显示哪种语言：both 双语、original 只显示原文、translation 只显示翻译（没有翻译的歌显示原文） */
  lyricsLang?: 'both' | 'original' | 'translation';
  /** 旧版本的点歌窗口用（还没刷新的页面）：显示不显示翻译 */
  lyricsTrans: boolean;
  /** 精简模式：auto 卡顿时自动打开、on 一直开、off 不开 */
  liteMode?: 'auto' | 'on' | 'off';
}

/** 为什么没在放：manual 后台暂停、offline 没开播（下播自动暂停）、no_player 没有加点歌窗口、disabled 点歌关着 */
export type MusicHold = 'manual' | 'offline' | 'no_player' | 'disabled' | null;

/** 正在放的歌 */
export interface MusicNow {
  item: MusicItem;
  /** 播放到哪里（毫秒），收到这条消息时的位置；没暂停时按本机时间往后走 */
  posMs: number;
  paused: boolean;
  lyric: LyricLine[] | null;
  /** 播放地址：只发给出声音的那个点歌窗口 */
  url?: string;
  /** 换了播放地址（例如地址过期后重新获取）时加一：播放器据此重新加载 */
  load: number;
}

/** 点歌窗口收到的全部状态（有变化就整份发） */
export interface MusicState {
  enabled: boolean;
  hold: MusicHold;
  now: MusicNow | null;
  /** 后面的歌（按顺序，最多 MUSIC_QUEUE_SEND 首） */
  queue: MusicItem[];
  /** 列表里一共几首（不算正在放的） */
  total: number;
  display: MusicDisplay;
  /** 点歌指令（空闲时提示观众「发送 点歌 歌名」） */
  cmd: string;
  /** 音量 0 – 100 */
  volume: number;
  /** 音量均衡（点歌窗口边放边测，把每首歌拉到差不多响） */
  normalize: boolean;
}

/** 点歌结果的提示（画面角落闪一下，后台也显示） */
export interface MusicNotice {
  id: string;
  ok: boolean;
  /** 观众昵称（后台点的是「主播」） */
  who: string;
  text: string;
  ts: number;
  /** 只在后台显示，不上直播画面（「点得太快了」这类、同一个人连着失败的） */
  quiet?: boolean;
}

/** 点歌窗口最多收几首后面的歌 */
export const MUSIC_QUEUE_SEND = 10;
/** 点歌窗口浏览器源的建议宽度、高度 */
export const MUSIC_WIDTH = 640;
export const MUSIC_HEIGHT = 560;

/**
 * 解析 LRC 歌词：[分:秒.毫秒]文字，一行可以有多个时间。trans 是翻译歌词（同样的格式），按时间配到原文上。
 * 去掉开头的「作词 : xx」「作曲 : xx」这类说明行和空行；没有时间的行不要
 */
export function parseLrc(lrc: string, trans?: string): LyricLine[] {
  // 同一个时间写了几行：双语歌词写在一起（外文原文一行、中文翻译一行，日文歌还可能夹一行罗马音）时，第一行当原文，中文那行当翻译；
  // 对唱这类同一时间的几句（都是同一种文字）连成一句显示，不当成翻译（只显示原文时也看得到）
  const lines: LyricLine[] = [];
  /** 这个时间的第一行 */
  let first = '';
  for (const l of readLrc(lrc).filter((x) => !CREDIT_RE.test(x.text))) {
    const prev = lines[lines.length - 1];
    if (!prev || prev.t !== l.t) {
      lines.push({ t: l.t, text: l.text });
      first = l.text;
    } else if (l.text === first) continue;
    else if (isTranslation(first, l.text)) prev.tr = l.text;
    // 日文、韩文歌夹着的罗马音不要
    else if (!(KANA_HANGUL_RE.test(first) && !HAN_RE.test(l.text) && !KANA_HANGUL_RE.test(l.text))) prev.text = `${prev.text} ${l.text}`;
  }
  if (trans) {
    // 翻译按时间配到原文上：差半秒以内都算同一句（网易云的翻译时间偶尔和原文差几毫秒）。
    // 每句翻译只配给离它最近的一句原文（快歌里两句原文挨得很近时，不会两句都显示同一句翻译）
    const tr = readLrc(trans);
    const pick = new Map<number, { text: string; d: number }>();
    let i = 0;
    for (const x of tr) {
      while (i + 1 < lines.length && lines[i + 1]!.t <= x.t) i++;
      let best = -1;
      for (const k of [i, i + 1]) {
        const l = lines[k];
        if (l && Math.abs(l.t - x.t) <= TRANS_SLACK_MS && (best < 0 || Math.abs(l.t - x.t) < Math.abs(lines[best]!.t - x.t))) best = k;
      }
      if (best < 0) continue;
      const d = Math.abs(lines[best]!.t - x.t);
      const had = pick.get(best);
      if (!had || d < had.d) pick.set(best, { text: x.text, d });
    }
    for (const [k, x] of pick) if (x.text !== lines[k]!.text) lines[k]!.tr = x.text;
  }
  return lines;
}

const HAN_RE = /[\u4e00-\u9fff]/;
const KANA_HANGUL_RE = /[\u3040-\u30ff\uac00-\ud7af]/;
/** 同一时间的另一行像不像翻译：这一行是中文，原文是外文（日文假名、韩文，或者没有汉字的拉丁字母等） */
function isTranslation(orig: string, line: string): boolean {
  return HAN_RE.test(line) && !KANA_HANGUL_RE.test(line) && (KANA_HANGUL_RE.test(orig) || !HAN_RE.test(orig));
}
/** 翻译和原文的时间差这么多以内算同一句 */
const TRANS_SLACK_MS = 500;

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** 说明行：作词、作曲、编曲、制作人……（网易云的歌词开头常有） */
const CREDIT_RE = /^\s*(作词|作曲|编曲|制作人|制作|监制|混音|母带|和声|吉他|贝斯|鼓|键盘|弦乐|录音|出品|发行|OP|SP|Lyrics?|Composer|Arranger|Producer)\s*[:：]/i;

function readLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times: number[] = [];
    let last = 0;
    for (const m of raw.matchAll(TIME_RE)) {
      if (m.index !== last) break;
      const ms = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + ms);
      last = m.index + m[0].length;
    }
    const text = raw.slice(last).trim();
    if (!times.length || !text) continue;
    for (const t of times) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 现在唱到第几句（还没到第一句时为 -1） */
export function lyricIndex(lines: readonly LyricLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
