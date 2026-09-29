"""下载设计预览用到的 Google 字体到 design/preview/assets/，国内访问时不依赖 Google。

用法：python3 design/tools/fetch_fonts.py
"""
import hashlib
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "design" / "preview" / "assets"
URL = ("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700"
       "&family=Geist+Mono:wght@500;600&family=Noto+Sans+SC:wght@400;500;600;700"
       # 漫画登场的拟声字、台词（站酷庆科黄油体，SIL OFL 1.1）
       "&family=ZCOOL+QingKe+HuangYou"
       # 通灵登场的卷轴毛笔字（马善政毛笔楷书，SIL OFL 1.1）
       "&family=Ma+Shan+Zheng&display=swap")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    (OUT / "fonts").mkdir(parents=True, exist_ok=True)
    css = get(URL).decode()

    def repl(m):
        name = hashlib.md5(m.group(1).encode()).hexdigest()[:16] + ".woff2"
        path = OUT / "fonts" / name
        if not path.exists():
            path.write_bytes(get(m.group(1)))
        return f"url(fonts/{name})"

    css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", repl, css)
    (OUT / "fonts.css").write_text(css)
    print("fonts:", len(list((OUT / "fonts").glob("*.woff2"))))


if __name__ == "__main__":
    main()
