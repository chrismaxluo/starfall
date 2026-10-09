// 更新记录：构建后台时把仓库里的 CHANGELOG.md 打包进来（桌面版、服务器版都能看），按「## 版本」分段，转成简单的 HTML
import raw from '../../../../CHANGELOG.md?raw';

export interface ChangelogSection {
  /** 例如「v1.4.0（2026-10-03）」「未发布」 */
  title: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 行内：**粗体**、`代码`、[文字](链接) 只留文字 */
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

export function parseChangelog(md: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  let cur: { title: string; parts: string[] } | null = null;
  let inList = false;
  const closeList = () => {
    if (inList && cur) cur.parts.push('</ul>');
    inList = false;
  };
  for (const line of md.split(/\r?\n/)) {
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      closeList();
      if (cur) out.push({ title: cur.title, html: cur.parts.join('') });
      cur = { title: h2[1]!.trim(), parts: [] };
      continue;
    }
    if (!cur) continue;
    const h3 = /^### (.+)$/.exec(line);
    const li = /^\s*[-*] (.+)$/.exec(line);
    if (h3) {
      closeList();
      cur.parts.push(`<h4>${inline(h3[1]!)}</h4>`);
    } else if (li) {
      if (!inList) cur.parts.push('<ul>');
      inList = true;
      cur.parts.push(`<li>${inline(li[1]!)}</li>`);
    } else if (line.trim()) {
      closeList();
      cur.parts.push(`<p>${inline(line.trim())}</p>`);
    } else closeList();
  }
  closeList();
  if (cur) out.push({ title: cur.title, html: cur.parts.join('') });
  return out;
}

export const CHANGELOG = parseChangelog(raw);
