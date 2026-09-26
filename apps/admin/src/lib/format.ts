// 显示用的格式化
export const pad2 = (n: number) => String(n).padStart(2, '0');

export function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function dateTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clock(ts)}`;
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

/** 今天（本地时区）YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

/** 某个时刻：今天 19:02、昨天 19:02、9月25日 19:02 */
export function when(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86_400_000);
  const diff = day(now) - day(ts);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 直播时长：2:14:37 */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}
