# 星临 Starfall

B 站直播间互动特效工具：观众**进场**、发**弹幕**、送**礼物**、**上舰**时，按规则在直播画面上播放素材、欢迎语和音效。支持 B站直播姬和 OBS，默认竖屏 1080×1920。

> 当前阶段：需求已整理，等待确认后进入方案设计与技术验证。

## 文档

- [需求文档](docs/requirements.md)（网页版：`design/preview/docs/requirements.html`）

## 目录

```
docs/               需求与设计文档
design/preview/     界面设计预览（纯静态网页，非正式代码）
design/tools/       预览相关的小工具
```

## 设计预览

```bash
python3 design/tools/fetch_fonts.py                               # 首次：下载字体
python3 -m http.server 8080 --directory design/preview            # 打开 http://localhost:8080/
```

修改需求文档后重新生成网页版：

```bash
python3 -m venv .venv && .venv/bin/pip install markdown
.venv/bin/python design/tools/md2html.py
```
