// 更新以后第一次打开后台：顶部说一句「星临已更新到 v…」，点一下看这次改了什么；看过就不再出现。
// 记在这个浏览器（电脑版是窗口）里；第一次装的不提示
import { ref } from 'vue';
import { CHANGELOG } from './changelog.ts';

const KEY = 'starfall.seenVersion';

/** 这个后台的版本：打包进来的更新记录里最上面那个版本（开发中的「未发布」不算） */
export const CURRENT: string | null = /^v(\d[^\s（(]*)/.exec(CHANGELOG.find((s) => s.title !== '未发布')?.title ?? '')?.[1] ?? null;

/** 版本号比大小：1.10.0 > 1.9.0；正式版 > 同号的测试版 */
export function compareVersions(a: string, b: string): number {
  const [ma = '', pa = ''] = a.split('-', 2);
  const [mb = '', pb = ''] = b.split('-', 2);
  const x = ma.split('.').map(Number);
  const y = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.localeCompare(pb, 'en', { numeric: true });
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function write(v: string): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 存不了（隐私模式）：下次再提示也没关系 */
  }
}

/** 要提示的版本；null：不提示 */
export const whatsNew = ref<string | null>(null);

/** 数据读到以后调用。oldUser：已经用过（完成或跳过了新手引导）；新装的不提示，只记下版本 */
export function checkWhatsNew(oldUser: boolean): void {
  if (!CURRENT) return;
  const seen = read();
  if (seen !== null ? compareVersions(seen, CURRENT) >= 0 : !oldUser) {
    if (seen !== CURRENT) write(CURRENT);
    return;
  }
  whatsNew.value = CURRENT;
}

/** 看过了（点了「看看改了什么」「知道了」，或者自己打开了「关于」） */
export function seenWhatsNew(): void {
  if (CURRENT) write(CURRENT);
  whatsNew.value = null;
}
