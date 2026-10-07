// 页面路由：用地址里的 # 区分页面（#overview、#rules…），刷新后停留在当前页
import { ref } from 'vue';

export const PAGES = ['overview', 'quickplay', 'rules', 'assets', 'logs', 'giftlist', 'obs', 'about', 'settings'] as const;
export type Page = (typeof PAGES)[number];

function parse(): { page: Page; sub: string } {
  const [p, sub = ''] = location.hash.slice(1).split('/');
  return { page: (PAGES as readonly string[]).includes(p ?? '') ? (p as Page) : 'overview', sub };
}

export const route = ref(parse());
addEventListener('hashchange', () => (route.value = parse()));

export function go(page: Page, sub = ''): void {
  location.hash = sub ? `${page}/${sub}` : page;
}
