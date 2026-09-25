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

## 声明

星临是**非官方**的第三方工具，与哔哩哔哩（bilibili）没有任何关联。它通过 B 站网页端公开的直播消息接口读取直播间事件，接口随时可能变化；使用时请遵守 B 站的用户协议，**建议使用小号登录**，由此产生的账号风险由使用者自行承担。

B 站的官方图标、礼物图片等素材版权归哔哩哔哩所有，本项目不内置这些素材，仅在运行时从 B 站加载。

## 开源协议

[GPL-3.0](LICENSE) © 2026 dhsboost

你可以自由使用、修改和再发布本项目；基于本项目修改后发布的作品，也必须以 GPL-3.0 开源。

设计预览中使用的字体：[Geist](https://github.com/vercel/geist-font)、[Noto Sans SC](https://github.com/notofonts/noto-cjk)（均为 SIL Open Font License 1.1）。
