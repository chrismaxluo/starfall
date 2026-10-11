// 页面路由：用地址里的 # 区分页面（#overview、#rules…），刷新后停留在当前页
import { ref } from 'vue';

export const PAGES = ['overview', 'quickplay', 'music', 'rules', 'assets', 'logs', 'giftlist', 'obs', 'about', 'settings'] as const;
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
addEventListener('beforeunload', (e) => {
  if (hasUnsaved()) e.preventDefault();
});

export function go(page: Page, sub = ''): void {
  location.hash = sub ? `${page}/${sub}` : page;
}
