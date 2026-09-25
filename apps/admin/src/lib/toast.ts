import { reactive } from 'vue';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
  out: boolean;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

export function toast(text: string, kind: Toast['kind'] = 'ok', ms = kind === 'err' ? 5000 : 2600): void {
  const t: Toast = { id: ++seq, text, kind, out: false };
  toasts.push(t);
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => {
    const x = toasts.find((y) => y.id === t.id);
    if (x) x.out = true;
    setTimeout(() => {
      const i = toasts.findIndex((y) => y.id === t.id);
      if (i >= 0) toasts.splice(i, 1);
    }, 260);
  }, ms);
}

/** 执行一个操作，出错时弹出错误提示；返回是否成功 */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okText) toast(okText);
    return r;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
    return undefined;
  }
}
