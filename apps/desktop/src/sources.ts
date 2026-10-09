// 下载新版本的来源：先直连 GitHub；连不上、下到一半断了、或者太慢时，依次换公共加速站。
// 加速站只用来传安装包：有没有新版本、安装包的校验值都直接从 GitHub 读，下载完核对不上就不装。
// 这里不碰 Electron，方便单独测试（main.ts 用）

/** 内置的公共加速站（地址前面加上它就行，例如 https://gh-proxy.com/https://github.com/...）。
 *  都是别人免费提供的，随时可能停用，所以放好几个；服务器版的 deploy/starfall.sh 里有同样的一份，改的时候两边一起改 */
export const MIRRORS = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://gh.llkk.cc/', 'https://ghproxy.net/'];

/** 太慢的标准：下载 15 秒后，最近 15 秒平均每秒不到 200KB（这样下完 130MB 要十几分钟） */
export const SLOW_WINDOW_MS = 15_000;
export const SLOW_BPS = 200 * 1024;

/** 依次要试的来源：null 为 GitHub 直连，排第一；自己填的备用地址排在内置加速站前面，重复的去掉 */
export function downloadSources(custom?: string | null): Array<string | null> {
  const list: Array<string | null> = [null];
  for (const m of [custom ?? null, ...MIRRORS]) if (m && !list.includes(m)) list.push(m);
  return list;
}

/**
 * 整理用户填的备用地址：去掉空格，必须是 http(s) 网址，末尾补上 /。
 * 空的返回 null（不用）；格式不对返回 undefined
 */
export function normalizeMirror(input: string): string | null | undefined {
  const v = input.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return undefined;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.search || u.hash || u.username || u.password) return undefined;
  return v.endsWith('/') ? v : `${v}/`;
}

/** 通过加速站下载：把加速站地址放在 GitHub 地址前面 */
export function viaMirror(url: string, mirror: string | null): string {
  return mirror ? mirror + url : url;
}

/** 给人看的来源名字 */
export function sourceName(mirror: string | null): string {
  if (!mirror) return 'GitHub 直连';
  try {
    return `备用地址 ${new URL(mirror).host}`;
  } catch {
    return '备用地址';
  }
}

/**
 * 测速：记下每次进度回调时已下载的字节数。下载满 SLOW_WINDOW_MS 后，最近这段时间的平均速度低于 SLOW_BPS 就算太慢
 * （一开始就慢、下到一半卡住都算；完全没有进度回调时也按 0 算）
 */
export class SpeedWatch {
  private samples: Array<{ t: number; bytes: number }>;
  constructor(start: number) {
    this.samples = [{ t: start, bytes: 0 }];
  }
  progress(bytes: number, now: number): void {
    this.samples.push({ t: now, bytes });
    // 只留最近一段，够算平均就行
    while (this.samples.length > 2 && this.samples[1]!.t <= now - SLOW_WINDOW_MS) this.samples.shift();
  }
  tooSlow(now: number): boolean {
    let from = this.samples[0]!;
    // 刚开始下载，还不满一段时间
    if (now - from.t < SLOW_WINDOW_MS) return false;
    // 从窗口起点之前最后一次记录算起
    for (const s of this.samples) if (s.t <= now - SLOW_WINDOW_MS) from = s;
    const last = this.samples[this.samples.length - 1]!;
    return ((last.bytes - from.bytes) * 1000) / (now - from.t) < SLOW_BPS;
  }
}
