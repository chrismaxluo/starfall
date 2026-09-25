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
