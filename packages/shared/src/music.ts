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
  style: 'glass' | 'vinyl' | 'minimal';
  side: 'left' | 'right';
  size: 'normal' | 'large';
  /** 显示后面几首（0 不显示列表） */
  showQueue: number;
  lyrics: boolean;
  lyricsTrans: boolean;
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
}

/** 点歌结果的提示（画面角落闪一下，后台也显示） */
export interface MusicNotice {
  id: string;
  ok: boolean;
  /** 观众昵称（后台点的是「主播」） */
  who: string;
  text: string;
  ts: number;
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
  const lines = readLrc(lrc).filter((l) => !CREDIT_RE.test(l.text));
  if (trans) {
    const tr = new Map(readLrc(trans).map((l) => [l.t, l.text]));
    for (const l of lines) {
      const x = tr.get(l.t);
      if (x && x !== l.text) l.tr = x;
    }
  }
  return lines;
}

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
