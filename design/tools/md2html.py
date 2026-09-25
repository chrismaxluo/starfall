"""把 docs/ 下的文档渲染成网页，输出到 design/preview/docs/，方便在服务器上直接阅读。

用法：python3 -m venv .venv && .venv/bin/pip install markdown && .venv/bin/python design/tools/md2html.py
"""
import pathlib
import re

import markdown

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "design" / "preview" / "docs"
DOCS = [("requirements", "需求文档"), ("architecture", "方案设计"), ("development", "开发约定")]
PENDING = re.compile(r"【(待[^】]*)】")

CSS = """
:root{--bg:#F5F5F7;--card:#FFFFFF;--line:rgba(15,17,30,.09);--t1:#0E1016;--t2:#454A59;--t3:#686D7D;--accent:#5451D6;--soft:rgba(84,81,214,.08);--head:#FAFAFB;color-scheme:light}
[data-theme="dark"]{--bg:#09090B;--card:#141419;--line:rgba(255,255,255,.08);--t1:#EDEDF1;--t2:#A6A8B4;--t3:#80838F;--accent:#8D8BFF;--soft:rgba(141,139,255,.12);--head:#18181E;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t1);font-family:"Geist","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased}
.wrap{display:grid;grid-template-columns:260px minmax(0,1fr);gap:40px;max-width:1240px;margin:0 auto;padding:40px 24px 80px}
nav.toc{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font-size:13px}
nav.toc .brand{font-weight:600;font-size:15px;letter-spacing:.04em;margin-bottom:10px}
nav.toc .docs{display:flex;flex-direction:column;gap:2px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
nav.toc .docs a{padding:5px 10px;border-radius:7px;color:var(--t2);text-decoration:none}
nav.toc .docs a.on{background:var(--soft);color:var(--accent);font-weight:500}
nav.toc ul{list-style:none;margin:0;padding:0}
nav.toc ul ul{padding-left:12px;display:none}
nav.toc li a{display:block;padding:4px 10px;border-radius:7px;color:var(--t2);text-decoration:none}
nav.toc li a:hover{background:var(--soft);color:var(--t1)}
nav.toc .back{display:block;margin-top:18px;color:var(--accent);text-decoration:none;font-size:13px}
main{min-width:0}
main h1{font-size:30px;letter-spacing:-.02em;margin:0 0 20px}
main h2{font-size:21px;margin:48px 0 14px;padding-top:8px;letter-spacing:-.01em}
main h3{font-size:16px;margin:28px 0 10px}
main h4{font-size:14.5px;margin:22px 0 8px;color:var(--t2)}
main hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.tw{overflow-x:auto;margin:12px 0 18px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.6}
th{text-align:left;font-weight:500;color:var(--t3);background:var(--head);font-size:12.5px}
th,td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap;color:var(--t2)}
code{font-family:"Geist Mono",ui-monospace,monospace;font-size:12.5px;background:var(--soft);padding:1px 6px;border-radius:5px}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;overflow-x:auto;line-height:1.55}
pre code{background:none;padding:0;font-size:12.5px}
pre.mermaid{background:var(--card);text-align:center}
blockquote{margin:12px 0;padding:10px 16px;border-radius:10px;background:var(--soft);color:var(--t2)}
blockquote p{margin:0}
.pend{display:inline-block;font-size:11.5px;line-height:18px;padding:0 7px;border-radius:5px;background:rgba(214,131,36,.14);color:#B8661B;margin-left:4px;white-space:nowrap}
[data-theme="dark"] .pend{color:#F0B45A}
a{color:var(--accent)}
.theme{position:fixed;right:18px;top:16px;height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--t2);font:inherit;font-size:13px;cursor:pointer}
@media (max-width:900px){.wrap{grid-template-columns:1fr;padding:24px 16px 60px} nav.toc{position:static;max-height:none}}
@media print{nav.toc,.theme{display:none} .wrap{display:block}}
"""

THEME_BOOT = ("<script>(function(){var t=null;try{t=localStorage.getItem('sf-theme')}catch(e){}"
              "if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';"
              "document.documentElement.dataset.theme=t})();</script>")
THEME_BTN = ("<button class=\"theme\" onclick=\"var r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark';"
             "try{localStorage.setItem('sf-theme',r.dataset.theme)}catch(e){}\">切换亮 / 暗</button>")
# 流程图：浏览器端渲染（需要能访问 jsdelivr；访问不了时显示为代码）
MERMAID = ("<script type=\"module\">import m from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';"
           "m.initialize({startOnLoad:true,theme:document.documentElement.dataset.theme==='dark'?'dark':'neutral'});</script>")


def render(slug, label):
    src = (ROOT / "docs" / f"{slug}.md").read_text(encoding="utf-8")
    md = markdown.Markdown(extensions=["tables", "toc", "sane_lists", "fenced_code"], extension_configs={"toc": {"toc_depth": "2-3"}})
    body = md.convert(src)
    body = body.replace("<table>", '<div class="tw"><table>').replace("</table>", "</table></div>")
    body = PENDING.sub(lambda m: f'<span class="pend">{m.group(1)}</span>', body)
    body = re.sub(r'<pre><code class="language-mermaid">(.*?)</code></pre>', r'<pre class="mermaid">\1</pre>', body, flags=re.S)
    # 文档之间的链接改为网页版
    body = re.sub(r'href="([a-z-]+)\.md"', lambda m: f'href="{m.group(1)}.html"' if any(m.group(1) == d for d, _ in DOCS) else m.group(0), body)
    on = ' class="on"'
    docs_nav = "".join(f'<a href="{d}.html"{on if d == slug else ""}>{n}</a>' for d, n in DOCS)
    page = (f'<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>星临 · {label}</title><link rel="stylesheet" href="../assets/fonts.css">{THEME_BOOT}<style>{CSS}</style></head><body>'
            f'{THEME_BTN}<div class="wrap"><nav class="toc" aria-label="目录"><div class="brand">✦ 星临 Starfall</div>'
            f'<div class="docs">{docs_nav}</div>{md.toc}<a class="back" href="../">← 设计预览</a></nav>'
            f'<main>{body}</main></div>{MERMAID}</body></html>')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{slug}.html").write_text(page, encoding="utf-8")
    print("ok", slug)


if __name__ == "__main__":
    for d, n in DOCS:
        render(d, n)
