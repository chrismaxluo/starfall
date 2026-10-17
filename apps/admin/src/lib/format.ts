// 显示用的格式化
export const pad2 = (n: number) => String(n).padStart(2, '0');

// 时间按主播所在时区显示（服务端的设置），和"今天"的统计、专属用户有效期一致；没拿到时用浏览器的时区
let fmt: Intl.DateTimeFormat | null = null;
let fmtZone: string | undefined;
export function setTimeZone(tz: string | undefined): void {
  if (tz === fmtZone && fmt) return;
  fmtZone = tz;
  try {
    fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    fmt = new Intl.DateTimeFormat('sv-SE', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
/** 2026-09-26 04:00:12 */
function parts(ts: number): string {
  if (!fmt) setTimeZone(undefined);
  return fmt!.format(ts);
}

export function clock(ts: number): string {
  return parts(ts).slice(11, 19);
}

export function dateTime(ts: number): string {
  return `${parts(ts).slice(5, 10)} ${clock(ts)}`;
}

/** 日期时间输入框的值：YYYY-MM-DDTHH:mm（按主播时区） */
export const inputDateTime = (ts: number): string => parts(ts).slice(0, 16).replace(' ', 'T');

/** 日期时间输入框的值换成时间戳（按主播时区）；格式不对时为 NaN */
export function parseInputDateTime(v: string): number {
  const asUtc = Date.parse(`${v}:00Z`);
  if (!Number.isFinite(asUtc)) return Number.NaN;
  // 先当成 UTC，再减去这个时区那一刻的偏移（算两次，夏令时切换前后也对）
  let t = asUtc;
  for (let i = 0; i < 2; i++) t = asUtc - (Date.parse(`${parts(t).replace(' ', 'T')}Z`) - t);
  return t;
}

export function duration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`;
}

export function fileSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function seconds(ms: number | null): string {
  return ms ? `${(ms / 1000).toFixed(1)}s` : '静态';
}

/** 今天（主播所在时区）YYYY-MM-DD */
export function today(): string {
  return parts(Date.now()).slice(0, 10);
}

export function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** 大数字：1.3万、367.1万 */
export function bigNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 10_000) return n.toLocaleString('zh-CN');
  const w = n / 10_000;
  return `${w >= 1000 ? Math.round(w) : Math.round(w * 10) / 10}万`;
}

/** 某个时刻：今天 19:02、昨天 19:02、9月25日 19:02（和别处一样按主播所在时区） */
export function when(ts: number, now = Date.now()): string {
  const p = parts(ts);
  const hm = p.slice(11, 16);
  if (p.slice(0, 10) === parts(now).slice(0, 10)) return `今天 ${hm}`;
  if (p.slice(0, 10) === parts(now - 86_400_000).slice(0, 10)) return `昨天 ${hm}`;
  return `${Number(p.slice(5, 7))}月${Number(p.slice(8, 10))}日 ${hm}`;
}

/** 直播时长：2:14:37 */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

/** 某一天：12月3日（按主播所在时区） */
export function monthDay(ts: number): string {
  const p = parts(ts);
  return `${Number(p.slice(5, 7))}月${Number(p.slice(8, 10))}日`;
}

/** 多久以前：刚刚、5 分钟前、3 小时前，再早就写哪天 */
export function ago(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小时前`;
  return when(ts, now);
}
