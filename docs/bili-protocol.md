# B 站直播协议笔记

> B 站没有公开这套协议的文档，本文档记录**实测结果**，是解析代码的依据。协议随时可能变化，发现变化时更新本文档和 `fixtures/` 样本。
>
> 状态：**P0 技术验证进行中**。✅ 已实测　⏳ 待实测

## 1. 测试环境

| 项目 | 内容 |
|---|---|
| 服务器 | Azure 东京机房（海外 IP） |
| 首次实测 | 2026-09-25，未登录，连接当时人气最高的直播间，持续 120 秒 |
| 抓包脚本 | `spike/capture.ts`：`node spike/capture.ts [房间号] [秒数]` |

## 2. 连接流程

| 步骤 | 接口 / 做法 | 状态 |
|---|---|---|
| 领取 buvid | `GET https://api.bilibili.com/x/frontend/finger/spi` → `data.b_3`（buvid3）、`data.b_4` | ✅ |
| WBI 签名密钥 | `GET https://api.bilibili.com/x/web-interface/nav` → `data.wbi_img`；未登录也会返回（`code` 为 -101，但带签名密钥） | ✅ |
| 房间号换算 | `GET https://api.live.bilibili.com/room/v1/Room/room_init?id=<短号或长号>` → `room_id`、`uid`（主播）、`live_status` | ✅ |
| 弹幕服务器信息 | `GET https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=<长号>&type=0&web_location=444.8`，**需要 WBI 签名** → `token`、`host_list`（本次 3 个服务器） | ✅ |
| 建立连接 | `wss://<host>:<wss_port>/sub` | ✅ |
| 认证 | 发送认证包：`{"uid":0,"roomid":<长号>,"protover":3,"buvid":"<buvid3>","platform":"web","type":2,"key":"<token>"}`；回复 `{"code":0}` 表示成功 | ✅（未登录） |
| 心跳 | 每 30 秒发送一次心跳包，服务器回复人气值 | ✅ |

**海外服务器可以正常连接和认证**，本次没有遇到风控。

## 3. 数据包格式

每个数据包由 16 字节包头 + 正文组成，一个 WebSocket 消息里可能有多个包：

| 偏移 | 长度 | 含义 |
|---|---|---|
| 0 | 4 | 包总长度 |
| 4 | 2 | 包头长度（16） |
| 6 | 2 | 协议版本：0 原始 JSON，1 心跳 / 认证，2 zlib 压缩，3 brotli 压缩 |
| 8 | 4 | 操作码：2 心跳，3 心跳回复，5 消息，7 认证，8 认证回复 |
| 12 | 4 | 序号（固定为 1） |

版本 2、3 的正文解压后，里面是若干个版本 0 的包。✅

## 4. 未登录时的限制 ✅

- 连接后会收到 `LOG_IN_NOTICE`：**"为保护用户隐私，未登录无法查看他人昵称"**。
- 观众**昵称被打码**（例如 `S***`），**UID 为 0**。
- **头像地址没有打码**。
- 人气最高的直播间 120 秒只收到 22 条消息，**没有收到任何弹幕和礼物**，推测未登录时消息被大量过滤。

**结论：必须登录（小号）才能满足需求**，这与需求文档 F-BL-01 一致。

## 5. 消息

### 5.1 本次收到的消息类型

| 消息 | 数量 | 用途 |
|---|---|---|
| `INTERACT_WORD_V2` | 2 | **进场**（新版 protobuf 格式） |
| `ENTRY_EFFECT` | 1 | 带进场特效的进场 |
| `ONLINE_RANK_COUNT`、`ONLINE_RANK_V3` | 5 | 高能榜人数 / 榜单 |
| `WATCHED_CHANGE` | 3 | 看过人数 |
| `LIKE_INFO_V3_CLICK` | 1 | 点赞 |
| `POPULAR_RANK_CHANGED`、`STOP_LIVE_ROOM_LIST` | 6 | 与需求无关 |
| `LOG_IN_NOTICE` | 1 | 未登录提示 |

### 5.2 `INTERACT_WORD_V2`（进场）✅ 结构 / ⏳ 登录后字段

外层是 JSON：`{"cmd":"INTERACT_WORD_V2","data":{"dmscore":…,"pb":"<base64>"}}`，`pb` 解码后是 protobuf：

| 字段号 | 含义 | 未登录时 |
|---|---|---|
| 1 | UID | 缺失（为 0） |
| 2 | 昵称 | 打码 |
| 5 | 消息类型：1 进场，2 关注，3 分享…… | 1 |
| 6 | 房间号 | ✅ |
| 7 | 时间（秒） | ✅ |
| 8 | 时间（毫秒） | ✅ |
| 15 | 触发时间（纳秒） | ✅ |
| 22 | 用户信息 | |
| 22.2.1 | 昵称 | 打码 |
| 22.2.2 | 头像地址 | ✅ |
| 22.4.1 | 财富等级 | ✅ |
| 其他 | 粉丝牌、大航海、房管 | ⏳ 本次未出现，登录后确认 |

### 5.3 `ENTRY_EFFECT` ✅ 结构 / ⏳ 大航海样本

JSON 格式，主要字段：`uid`（未登录为 0）、`target_id`（主播 UID）、`face`（头像）、`privilege_type`（大航海等级，0 为无）、`copy_writing`（文案，昵称打码为 `<%S***%>`）、`web_basemap_url`（背景图）、`web_effective_time`（持续秒数）、`wealthy_info.level`（财富等级）、`identities`。

本次样本 `privilege_type` 为 0，是财富等级触发的进场特效，**不只是大航海才会有 `ENTRY_EFFECT`**。去重时需要注意。

## 6. 待实测（需要小号登录）

| # | 内容 |
|---|---|
| 1 | 登录后昵称、UID 是否完整 |
| 2 | `INTERACT_WORD_V2` 中粉丝牌、大航海、房管的字段号 |
| 3 | 弹幕 `DANMU_MSG` 的格式（是否也有新版 protobuf） |
| 4 | 礼物 `SEND_GIFT`、`COMBO_SEND` 的格式；免费 / 付费区分；单价单位 |
| 5 | 上舰 `GUARD_BUY` / `USER_TOAST_MSG`；开通与续费的区分 |
| 6 | 开播 / 下播 `LIVE` / `PREPARING` |
| 7 | 大航海进场时 `INTERACT_WORD_V2` 与 `ENTRY_EFFECT` 的先后和间隔（去重窗口） |
| 8 | 扫码登录接口、Cookie 有效期与续期 |
| 9 | 礼物配置接口（名称、单价、图标） |
| 10 | 神秘人的表现 |
