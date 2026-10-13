// 选歌：观众发「点歌 晴天 周杰伦」，从搜索结果里挑一首。网易云和本地歌库共用。
// - 放不了的（会员歌没登录会员、没有版权）、太长的、不让点的跳过；
// - 观众写了好几个词（歌名 + 歌手）时，要每个词都对得上（在歌名、别名或歌手里）；
//   有的歌手根本不在网易云上（例如周杰伦），这时不随便放一首别人翻唱的，提示没有这个版本；
// - 只写了歌名时，优先选原版：伴奏、翻唱、Live、DJ、加速版这些往后排（观众自己写了的除外）；
// - 最相关的那首（一般是原版）放不了（会员歌）时，只换同一位歌手的其他版本，不拿别人的翻唱顶替；
// - 翻唱常在歌名里写「(原唱 周杰伦)」，这部分不算对上了歌手；给自己挂一长串别名的（冒名的）不认别名。

export interface Candidate {
  name: string;
  alias?: readonly string[];
  artists: readonly string[];
  artistAlias?: readonly string[];
  durationMs: number;
  playable: boolean;
}

export interface PickOptions {
  /** 最长多少毫秒 */
  maxMs: number;
  /** 歌名或歌手里有这些字的不收 */
  blockWords: readonly string[];
}

export type PickResult<T> = { ok: true; song: T } | { ok: false; reason: 'not_found' | 'unplayable' | 'too_long' | 'blocked' | 'no_version' | 'no_index'; text: string };

/** 英文不分大小写、全角半角当成一样，去掉空格和常见符号 */
export function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'"’`·・.,，。!！?？~～()（）[\]【】「」《》<>-]+/g, '');
}

/** 观众写的几个词（空格、横杠、斜杠、顿号隔开） */
export function words(query: string): string[] {
  return [...new Set(query.normalize('NFKC').split(/[\s\-—–_/、,，|]+/).map(norm).filter(Boolean))];
}

/** 不是原版的标记：观众没写时往后排 */
const VERSION_WORDS = ['原唱', '伴奏', '纯音乐', '翻唱', '翻自', 'cover', 'live', 'dj', 'remix', '女声版', '男声版', '片段', '铃声', '加速', '降速', '倍速', '0.8x', '1.2x', '1.5x', '抖音', '深情版', '钢琴版', '吉他版', '八音盒', 'musicbox', 'instrumental', 'karaoke', 'inst', '演奏', '慢放', '变调', '合唱版'];

function isVersion(c: Candidate, query: string): boolean {
  const q = norm(query);
  const text = norm([c.name, ...(c.alias ?? [])].join(' '));
  return VERSION_WORDS.some((w) => text.includes(w) && !q.includes(w));
}

/** 歌名里括号中写的「原唱 xx」「翻自 xx」「cover xx」：说的是别人，不算这首歌的歌手 */
const CREDIT_RE = /[(（[【][^)）\]】]*(原唱|翻自|翻唱|原曲|cover|cv)[^)）\]】]*[)）\]】]/gi;
export const plainName = (name: string) => name.replace(CREDIT_RE, ' ').trim();
/** 歌手的别名超过这么多个就不认（正常歌手一两个，冒名的会挂一长串当红歌手的名字） */
const ALIAS_MAX = 3;

/** 冒名的歌手：中文名前后多加了符号（「周杰伦.」），去掉符号后就是观众写的名字。这种不算 */
const fake = (artist: string) => /[\u4e00-\u9fff]/.test(artist) && /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/u.test(artist);
/** 歌手（和别名） */
const artistText = (c: Candidate) => norm([...c.artists.filter((a) => !fake(a)), ...((c.artistAlias?.length ?? 0) <= ALIAS_MAX ? (c.artistAlias ?? []) : [])].join('|'));
const hay = (c: Candidate) => `${norm([plainName(c.name), ...(c.alias ?? [])].join('|'))}|${artistText(c)}`;
/** 两首歌有没有同一位歌手 */
const sameArtist = (a: Candidate, b: Candidate) => a.artists.some((x) => b.artists.some((y) => norm(x) === norm(y)));
/** 不到 1 分钟的多半是片段、铃声 */
const SHORT_MS = 60_000;

export function blockedBy(c: Pick<Candidate, 'name' | 'artists'>, blockWords: readonly string[]): string | null {
  const text = norm([c.name, ...c.artists].join('|'));
  return blockWords.find((w) => norm(w) && text.includes(norm(w))) ?? null;
}

/** 伴奏、纯音乐、铃声：观众自己没写时不收（点歌的人想听的是歌） */
const NO_VOCAL = ['伴奏', '纯音乐', '铃声', 'instrumental', 'inst', 'karaoke', 'offvocal', '消音'];
const noVocal = (c: Candidate, query: string) => {
  const q = norm(query);
  const text = norm([c.name, ...(c.alias ?? [])].join(' '));
  return NO_VOCAL.some((w) => text.includes(w) && !q.includes(w));
};

/** 为什么这首不能收（null 为能收） */
function rejectReason(c: Candidate, o: PickOptions, query: string): 'unplayable' | 'too_long' | 'blocked' | null {
  if (noVocal(c, query)) return 'blocked';
  if (!c.playable) return 'unplayable';
  if (c.durationMs > o.maxMs) return 'too_long';
  if (blockedBy(c, o.blockWords)) return 'blocked';
  return null;
}

const REASON_TEXT = {
  unplayable: (name: string) => `《${name}》需要会员或者暂时放不了`,
  too_long: (name: string, o: PickOptions) => `《${name}》太长了（超过 ${Math.round(o.maxMs / 60_000)} 分钟）`,
  blocked: (name: string) => `《${name}》不能点`,
};

/**
 * 按搜索结果的顺序挑一首。results 是搜索结果（已经按相关度排好）；没有能放的时候说明原因。
 * nth：观众点名要第几个版本（「点歌 晴天 2」），在能放的版本里按好坏排好后取第 nth 个
 */
export function pick<T extends Candidate>(query: string, results: readonly T[], o: PickOptions, nth = 1): PickResult<T> {
  const r = rank(query, results, o);
  if (!r.ok) return r;
  const song = r.list[nth - 1];
  if (!song) return { ok: false, reason: 'no_index', text: `「${query}」只找到 ${r.list.length} 个能放的版本` };
  return { ok: true, song };
}

/** 观众写的歌名后面跟着「 2」「#2」：点第几个版本（1 – 9）。歌名本身至少要剩下一个字 */
export function splitNth(query: string): { query: string; nth: number } {
  const m = query.match(/^(.+?)\s*[#＃]\s*([1-9])$/) ?? query.match(/^(.+?)\s+([1-9])$/);
  return m && m[1]!.trim() ? { query: m[1]!.trim(), nth: Number(m[2]) } : { query, nth: 1 };
}

/** 能放的版本，按好坏排好（第一个就是默认会选的）；一个都没有时说明原因 */
export function rank<T extends Candidate>(query: string, results: readonly T[], o: PickOptions): { ok: true; list: T[] } | Extract<PickResult<T>, { ok: false }> {
  const ws = words(query);
  if (!results.length || !ws.length) return { ok: false, reason: 'not_found', text: `没有找到「${query}」` };
  // 第二个词起，是歌手名的（结果里有歌手叫这个，或者翻唱写着「原唱 xx」）必须对上歌手，光出现在歌名里不算
  const credits = results.flatMap((c) => [...c.name.matchAll(CREDIT_RE)].map((m) => norm(m[0])));
  const artistish = new Set(ws.slice(1).filter((w) => results.some((c) => artistText(c).includes(w)) || credits.some((t) => t.includes(w))));
  const hits = (c: Candidate, w: string) => (artistish.has(w) ? artistText(c) : hay(c)).includes(w);
  const scored = results.map((c, i) => {
    const covered = ws.every((w) => hits(c, w));
    const reject = rejectReason(c, o, query);
    // 每个词都对得上的优先；原版优先；不是片段的优先；歌名正好是观众写的第一个词的优先；其余按搜索顺序
    const score = (covered ? 1000 : 0) - (isVersion(c, query) ? 100 : 0) - (c.durationMs > 0 && c.durationMs < SHORT_MS ? 200 : 0) + (norm(plainName(c.name)) === ws[0] ? 20 : 0) - i;
    return { c, covered, reject, score };
  });
  // 最相关的那首放不了（会员歌）：只换同一位歌手的版本
  const top = scored.find((s) => s.covered);
  let ok = scored.filter((s) => !s.reject);
  if (top?.reject === 'unplayable') {
    ok = ok.filter((s) => s.covered && sameArtist(s.c, top.c));
    if (!ok.length) return { ok: false, reason: 'unplayable', text: REASON_TEXT.unplayable(top.c.name) };
  }
  const sorted = [...ok].sort((a, b) => b.score - a.score);
  if (sorted[0]?.covered) return { ok: true, list: sorted.filter((x) => x.covered).map((x) => x.c) };
  // 只写了一个词、结果里没有一首原样包含它（拼音、简繁、错别字）：相信网易云的排序。
  // 有包含它的、只是都放不了时，不拿别的歌顶替
  if (sorted.length && ws.length === 1 && !scored.some((x) => x.covered)) return { ok: true, list: sorted.map((x) => x.c) };
  // 好几个词，没有一首全对得上：哪些词在所有结果里都找不到（多半是不在这里的歌手）
  if (ws.length > 1) {
    const missing = ws.filter((w) => !results.some((c) => hits(c, w)));
    if (missing.length && missing.length < ws.length) {
      const raw = query.normalize('NFKC').split(/[\s\-—–_/、,，|]+/).filter((x) => missing.includes(norm(x)));
      return { ok: false, reason: 'no_version', text: `没有找到「${raw.join(' ') || missing.join(' ')}」的版本` };
    }
  }
  // 对得上的都不能收：说第一首对得上的为什么不能收
  const first = scored.find((s) => s.covered) ?? scored[0]!;
  if (first.reject) return { ok: false, reason: first.reject, text: REASON_TEXT[first.reject](first.c.name, o) };
  return { ok: false, reason: 'not_found', text: `没有找到「${query}」` };
}
