// 选歌：观众发「点歌 晴天 周杰伦」，从搜索结果里挑一首。网易云和本地歌库共用。
// - 放不了的（会员歌没登录会员、没有版权）、太长的、不让点的跳过；
// - 观众写了好几个词（歌名 + 歌手）时，要每个词都对得上（在歌名、别名或歌手里）；
//   有的歌手根本不在网易云上（例如周杰伦），这时不随便放一首别人翻唱的，提示没有这个版本；
// - 只写了歌名时，优先选原版：伴奏、翻唱、Live、DJ、加速版这些往后排（观众自己写了的除外）。

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

export type PickResult<T> = { ok: true; song: T } | { ok: false; reason: 'not_found' | 'unplayable' | 'too_long' | 'blocked' | 'no_version'; text: string };

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
const VERSION_WORDS = ['伴奏', '纯音乐', '翻唱', '翻自', 'cover', 'live', 'dj', 'remix', '女声版', '男声版', '片段', '铃声', '加速', '降速', '倍速', '0.8x', '1.2x', '1.5x', '抖音', '深情版', '钢琴版', '吉他版', '八音盒', 'musicbox', 'instrumental', 'karaoke', 'inst', '演奏', '慢放', '变调', '合唱版'];

function isVersion(c: Candidate, query: string): boolean {
  const q = norm(query);
  const text = norm([c.name, ...(c.alias ?? [])].join(' '));
  return VERSION_WORDS.some((w) => text.includes(w) && !q.includes(w));
}

const hay = (c: Candidate) => norm([c.name, ...(c.alias ?? []), ...c.artists, ...(c.artistAlias ?? [])].join('|'));

export function blockedBy(c: Pick<Candidate, 'name' | 'artists'>, blockWords: readonly string[]): string | null {
  const text = norm([c.name, ...c.artists].join('|'));
  return blockWords.find((w) => norm(w) && text.includes(norm(w))) ?? null;
}

/** 为什么这首不能收（null 为能收） */
function rejectReason(c: Candidate, o: PickOptions): 'unplayable' | 'too_long' | 'blocked' | null {
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
 */
export function pick<T extends Candidate>(query: string, results: readonly T[], o: PickOptions): PickResult<T> {
  const ws = words(query);
  if (!results.length || !ws.length) return { ok: false, reason: 'not_found', text: `没有找到「${query}」` };
  const scored = results.map((c, i) => {
    const h = hay(c);
    const covered = ws.every((w) => h.includes(w));
    const reject = rejectReason(c, o);
    // 每个词都对得上的优先；原版优先；歌名正好是观众写的第一个词的优先；其余按搜索顺序
    const score = (covered ? 1000 : 0) - (isVersion(c, query) ? 100 : 0) + (norm(c.name) === ws[0] ? 20 : 0) - i;
    return { c, covered, reject, score };
  });
  const ok = scored.filter((s) => !s.reject);
  const best = [...ok].sort((a, b) => b.score - a.score)[0];
  if (best?.covered) return { ok: true, song: best.c };
  // 只写了一个词、结果里没有一首原样包含它（拼音、简繁、错别字）：相信网易云的排序。
  // 有包含它的、只是都放不了时，不拿别的歌顶替
  if (best && ws.length === 1 && !scored.some((s) => s.covered)) return { ok: true, song: best.c };
  // 好几个词，没有一首全对得上：哪些词在所有结果里都找不到（多半是不在这里的歌手）
  if (ws.length > 1) {
    const all = scored.map((s) => hay(s.c));
    const missing = ws.filter((w) => !all.some((h) => h.includes(w)));
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
