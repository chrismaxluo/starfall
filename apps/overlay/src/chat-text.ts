// 弹幕列表的文字处理（不碰 DOM，方便测试）

export type Seg = { text: string } | { img: string; alt: string };

/** 把弹幕文字按表情写法（如 [dog]）切开：有图片的换成图，没有的照原样显示 */
export function segments(text: string, emots: Record<string, string> | undefined): Seg[] {
  if (!emots || !Object.keys(emots).length) return text ? [{ text }] : [];
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[[^[\]]{1,40}\]/g)) {
    const url = emots[m[0]];
    if (!url) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ img: url, alt: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

