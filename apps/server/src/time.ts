// 按主播时区算日子：某一天 0 点、这一周的周一、这个月的 1 号（日子都写成 YYYY-MM-DD）

/** 某个时区里某一天 0 点的时间戳 */
export function dayStart(day: string, timeZone: string): number {
  const utc = Date.parse(`${day}T00:00:00Z`);
  // 算出这个时区在那一刻相对 UTC 的偏移
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return utc - (asUtc - utc);
}

/** 往后（n 为负时往前）数 n 天 */
export function dayShift(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 这一天所在的那一周的周一 */
export function weekStartDay(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dayShift(day, -((dow + 6) % 7));
}

/** 这一天所在的那个月的 1 号 */
export const monthStartDay = (day: string): string => `${day.slice(0, 8)}01`;
