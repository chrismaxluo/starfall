"""把 docs/requirements.md 渲染成 design/preview/docs/requirements.html。

用法：python3 -m venv .venv && .venv/bin/pip install markdown && .venv/bin/python design/tools/md2html.py
"""
import markdown, re, pathlib, html

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / 'docs/requirements.md').read_text(encoding='utf-8')
md = markdown.Markdown(extensions=['tables', 'toc', 'sane_lists'], extension_configs={'toc': {'toc_depth': '2-3'}})
body = md.convert(src)
body = re.sub(r'<table>', '<div class="tw"><table>', body); body = body.replace('</table>', '</table></div>')
body = body.replace('【待验证】', '<span class="pend">待验证</span>').replace('【待校准：默认比例】', '<span class="pend">待校准</span>').replace('【待获取】', '<span class="pend">待获取</span>').replace('【待验证：房管、神秘人】', '<span class="pend">待验证：房管、神秘人</span>').replace('【待验证：具体字段与新版格式】', '<span class="pend">待验证：具体字段与新版格式</span>')
toc = md.toc
page = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>星临 · 需求文档 v1.0</title>
<link rel="stylesheet" href="../assets/fonts.css">
<script>(function(){{var t=null;try{{t=localStorage.getItem('sf-theme')}}catch(e){{}}if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}})();</script>
<style>
:root{{--bg:#F5F5F7;--card:#FFFFFF;--line:rgba(15,17,30,.09);--t1:#0E1016;--t2:#454A59;--t3:#686D7D;--accent:#5451D6;--soft:rgba(84,81,214,.08);--head:#FAFAFB;color-scheme:light}}
[data-theme="dark"]{{--bg:#09090B;--card:#141419;--line:rgba(255,255,255,.08);--t1:#EDEDF1;--t2:#A6A8B4;--t3:#80838F;--accent:#8D8BFF;--soft:rgba(141,139,255,.12);--head:#18181E;color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--t1);font-family:"Geist","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased}}
.wrap{{display:grid;grid-template-columns:260px minmax(0,1fr);gap:40px;max-width:1240px;margin:0 auto;padding:40px 24px 80px}}
nav.toc{{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font-size:13px}}
nav.toc .brand{{font-weight:600;font-size:15px;letter-spacing:.04em;margin-bottom:4px}}
nav.toc .sub{{color:var(--t3);font-size:12px;margin-bottom:16px}}
nav.toc ul{{list-style:none;margin:0;padding:0}}
nav.toc ul ul{{padding-left:12px;display:none}}
nav.toc li a{{display:block;padding:4px 10px;border-radius:7px;color:var(--t2);text-decoration:none}}
nav.toc li a:hover{{background:var(--soft);color:var(--t1)}}
nav.toc .links{{margin-top:18px;display:flex;flex-direction:column;gap:6px}}
nav.toc .links a{{color:var(--accent);text-decoration:none;font-size:13px}}
main{{min-width:0}}
main h1{{font-size:30px;letter-spacing:-.02em;margin:0 0 20px}}
main h2{{font-size:21px;margin:48px 0 14px;padding-top:8px;letter-spacing:-.01em}}
main h3{{font-size:16px;margin:28px 0 10px}}
main h4{{font-size:14.5px;margin:22px 0 8px;color:var(--t2)}}
main hr{{border:0;border-top:1px solid var(--line);margin:32px 0}}
.tw{{overflow-x:auto;margin:12px 0 18px;border:1px solid var(--line);border-radius:12px;background:var(--card)}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;line-height:1.6}}
th{{text-align:left;font-weight:500;color:var(--t3);background:var(--head);font-size:12.5px}}
th,td{{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}}
tr:last-child td{{border-bottom:0}}
td:first-child{{white-space:nowrap;color:var(--t2)}}
code{{font-family:"Geist Mono",ui-monospace,monospace;font-size:12.5px;background:var(--soft);padding:1px 6px;border-radius:5px}}
blockquote{{margin:12px 0;padding:10px 16px;border-radius:10px;background:var(--soft);color:var(--t2)}}
blockquote p{{margin:0}}
.pend{{display:inline-block;font-size:11.5px;line-height:18px;padding:0 7px;border-radius:5px;background:rgba(214,131,36,.14);color:#B8661B;margin-left:4px;white-space:nowrap}}
[data-theme="dark"] .pend{{color:#F0B45A}}
a{{color:var(--accent)}}
.theme{{position:fixed;right:18px;top:16px;height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--t2);font:inherit;font-size:13px;cursor:pointer}}
@media (max-width:900px){{.wrap{{grid-template-columns:1fr;padding:24px 16px 60px}} nav.toc{{position:static;max-height:none}} nav.toc ul ul{{display:none}}}}
@media print{{nav.toc,.theme{{display:none}} .wrap{{display:block}}}}
</style></head><body>
<button class="theme" onclick="var r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark';try{{localStorage.setItem('sf-theme',r.dataset.theme)}}catch(e){{}}">切换亮 / 暗</button>
<div class="wrap">
<nav class="toc" aria-label="目录"><div class="brand">✦ 星临 Starfall</div><div class="sub">需求文档 v1.0 · 待确认</div>{toc}
<div class="links"><a href="../">← 设计预览</a><a href="requirements.md" download>下载 Markdown 原文</a></div></nav>
<main>{body}</main></div></body></html>'''
out = ROOT / 'design/preview/docs/requirements.html'; out.write_text(page, encoding='utf-8')
(ROOT / 'design/preview/docs/requirements.md').write_text(src, encoding='utf-8')
print('ok', len(page))
