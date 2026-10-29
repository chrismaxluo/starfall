// 页面路由：用地址里的 # 区分页面（#overview、#rules…），刷新后停留在当前页
import { ref } from 'vue';

export const PAGES = ['overview', 'quickplay', 'music', 'rules', 'assets', 'logs', 'chat', 'giftlist', 'obs', 'about', 'settings'] as const;
export type Page = (typeof PAGES)[number];

function parse(): { page: Page; sub: string } {
  const [p, sub = ''] = location.hash.slice(1).split('/');
  return { page: (PAGES as readonly string[]).includes(p ?? '') ? (p as Page) : 'overview', sub };
}

export const route = ref(parse());

// 离开前检查：有没保存的改动时问一句（lib/draft.ts 注册），不离开就把地址改回去（replaceState 不会再触发 hashchange）
export const leaveGuards = new Set<() => boolean>();
const LEAVE_MSG = '有改动还没保存，离开后会丢掉。确定离开吗？';
export const hasUnsaved = () => [...leaveGuards].some((dirty) => dirty());
/** 返回 true 表示可以继续（没有没保存的改动，或者确认丢掉） */
export const confirmLeave = () => !hasUnsaved() || confirm(LEAVE_MSG);
let lastHash = location.hash;
addEventListener('hashchange', () => {
  if (location.hash !== lastHash && !confirmLeave()) return history.replaceState(null, '', lastHash || location.pathname + location.search);
  lastHash = location.hash;
  route.value = parse();
});
/** 只在刷新、关闭页面时检查的没保存修改（素材设置这类弹窗：换页面时由弹窗自己处理） */
export const unloadGuards = new Set<() => boolean>();
const unsavedOnUnload = () => hasUnsaved() || [...unloadGuards].some((dirty) => dirty());
addEventListener('beforeunload', (e) => {
  if (unsavedOnUnload()) e.preventDefault();
});
// 桌面版退出、安装更新前先问一下页面有没有没保存的修改（直接关窗时 Electron 不会弹提示，只会悄悄取消退出）
(window as unknown as { __starfallUnsaved?: () => boolean }).__starfallUnsaved = unsavedOnUnload;

export function go(page: Page, sub = ''): void {
  location.hash = sub ? `${page}/${sub}` : page;
}
