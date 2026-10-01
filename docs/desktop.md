# 电脑版（Windows）

星临电脑版把服务器版的全部功能装进一个 Windows 软件：双击安装，后台窗口、特效页、连接直播间都在主播自己的电脑上运行，不需要服务器。和服务器版是同一套代码，新功能写一次两边都有。

- 支持：Windows 10、Windows 11（64 位）
- 下载：[GitHub 发布页](https://github.com/chrismaxluo/starfall/releases)，只下载 `Starfall-…-setup.exe`
- 安装包没有数字签名，Windows 会提示「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」

## 和服务器版的区别

| | 服务器版 | 电脑版 |
|---|---|---|
| 后台登录密码 | 要 | 不要（只能在本机打开） |
| 谁能访问 | 任何能连上服务器的设备 | 只有本机；其他网站发来的请求一律拒绝 |
| 关闭窗口 | — | 缩到右下角托盘，特效照常播放 |
| 开机自动启动 | systemd | 托盘菜单或「设置 → 电脑版」里打开（默认关） |
| 更新 | 拉代码、构建、重启 | 有新版本时弹窗提示，点下载，重启安装 |
| 特效页地址 | `http://服务器地址:17520/overlay/…` | `http://127.0.0.1:17520/overlay/…`（端口被占时自动换下一个，并提示） |

托盘图标右键：打开星临、复制直播软件地址、开机自动启动、检查更新、打开数据文件夹、退出星临（正在直播时会先确认）。

## 文件放在哪

| 内容 | 位置 |
|---|---|
| 程序 | `%LOCALAPPDATA%\Programs\Starfall\Starfall.exe`（安装时可以改） |
| 数据（数据库、素材、备份） | `%APPDATA%\Starfall\data` |
| 日志 | `%APPDATA%\Starfall\logs`（`main.log` 窗口和托盘，`server.log` 本机服务） |

卸载不会删除数据；重装或升级后素材、规则、设置都还在。

从服务器版搬数据：服务器版后台「设置 → 数据 → 导出」，电脑版里「导入」。

## 命名规则

**安装包**：`Starfall-<版本号>-win-x64-setup.exe`

- 不用中文、不用空格，各部分用 `-` 连接（GitHub 发布页会改掉中文文件名，自动更新也按文件名找）
- `win` = Windows，`x64` = 64 位，`setup` = 安装程序

**版本号**：`主版本.功能版本.修复版本`

| 情况 | 怎么变 | 例子 |
|---|---|---|
| 大改版，旧数据或设置可能不兼容 | 第一位 +1 | `2.0.0` |
| 新功能 | 第二位 +1，最后一位归零 | `1.4.0` |
| 只修问题 | 第三位 +1 | `1.4.1` |
| 测试版 | 后面加 `-beta.序号` | `1.4.0-beta.1`、`1.4.0-beta.2` |

例子：`Starfall-1.4.0-beta.1-win-x64-setup.exe`、`Starfall-1.4.0-win-x64-setup.exe`。

**同一个版本，这几处必须一致**（打包时自动检查，不一致直接失败）：版本标签 `v1.4.0-beta.1`、根目录和各包 `package.json` 的 `version`（包括 `apps/desktop/package.json`）、安装包文件名。

**安装后显示的名字**：桌面图标、开始菜单、托盘、卸载列表都叫「星临」；主程序文件 `Starfall.exe`；数据文件夹 `Starfall`。

**发布页上的其他文件**：`latest.yml` / `beta.yml`（自动更新用来查新版本，名字固定）、`.blockmap`（更新时只下载变了的部分）。都不用管。

## 打包和发布（GitHub 自动完成，不占服务器）

`.github/workflows/desktop.yml`，在 GitHub 的 Windows 电脑上运行：

1. 推送版本标签：`git tag -a v1.4.0-beta.1 -m "…" && git push origin v1.4.0-beta.1`
2. GitHub 自动：装依赖 → 构建后台和特效页 → 打包本机服务 → 下载 ffprobe → electron-builder 打成安装包
3. 上传到发布页：标签带 `-`（测试版）标成「预发布」，不会变成首页的最新版本
4. 只想试打包：在 GitHub 的 Actions 页面手动运行「打包电脑版」，安装包在那次运行的页面下载（保留 14 天）

日常检查也在 GitHub 上跑（`.github/workflows/ci.yml`）：每次推送都做类型检查、代码规范、全部测试和构建，并在 Windows 上再跑一遍测试。

## 代码结构（apps/desktop）

| 文件 | 作用 |
|---|---|
| `src/main.ts` | 主进程：启动本机服务、窗口、托盘、开机自启、检查更新 |
| `src/server.ts` | 本机服务入口（独立进程运行，意外退出会自动重启） |
| `src/preload.ts` | 给后台页面开放的几个电脑版功能（设置页「电脑版」卡片） |
| `scripts/build.mjs` | 把三个入口各打成一个文件，准备好要放进安装包的文件 |
| `electron-builder.yml` | 安装包设置 |

本机服务通过环境变量切到电脑版：`STARFALL_DESKTOP=1`（只听 127.0.0.1、不用密码、只认本机地址和同源页面）、`STARFALL_DATA`、`STARFALL_PORT`、`STARFALL_ADMIN_DIST`、`STARFALL_OVERLAY_DIST`、`STARFALL_MIGRATIONS`、`STARFALL_FFPROBE`。

`apps/desktop` 不在 pnpm 工作区里：Electron、electron-builder 这些打包工具只在 GitHub 打包时安装，服务器上 `pnpm install` 不会下载它们。
