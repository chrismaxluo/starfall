# B 站直播协议笔记

> B 站没有公开这套协议的文档，本文档记录**实测结果**，是解析代码的依据。协议随时可能变化，发现变化时更新本文档和 `fixtures/` 样本。
>
> 状态：**P0 技术验证进行中**。✅ 已实测　⏳ 待实测

## 1. 测试环境

| 项目 | 内容 |
|---|---|
| 服务器 | Azure 东京机房（海外 IP） |
| 首次实测 | 2026-09-25，未登录，连接当时人气最高的直播间，持续 120 秒 |
| 第三次实测 | 2026-09-25，已登录，两个热门直播间各约 3 ~ 5 分钟，重点找礼物消息；期间一位主播下播 |
| 第二次实测 | 2026-09-25，**已登录**，主播本人的直播间（开播中）300 秒，收到 177 条消息；同时对照人气最高的直播间 180 秒 |
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

### 4.1 登录后 ✅

- 在**主播本人的直播间**：进场、弹幕的**昵称和 UID 都完整**，也能收到弹幕。
- 在**人气最高的那个直播间**：登录后昵称**仍然打码**、UID 仍缺失，但不再收到 `LOG_IN_NOTICE`。原因未明（可能是超大直播间的额外隐私保护）。**不影响星临**，星临只连接主播自己的直播间。
- 认证包的 `uid` 填登录账号的 UID，`getDanmuInfo` 请求带上登录 Cookie 即可；WebSocket 握手本身不需要带 Cookie。

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

### 5.2 `INTERACT_WORD_V2`（进场）✅

外层是 JSON：`{"cmd":"INTERACT_WORD_V2","data":{"dmscore":…,"pb":"<base64>"}}`，`pb` 解码后是 protobuf：

| 字段号 | 含义 | 备注 |
|---|---|---|
| 1 | UID | 未登录时缺失 |
| 2 | 昵称 | 未登录时打码 |
| 5 | 消息类型：1 进场，2 关注，3 分享…… | 只处理 1 |
| 6 | 房间号 | |
| 7 / 8 | 时间（秒 / 毫秒） | |
| 9 | 粉丝牌（旧结构） | 见下表 |
| 15 | 触发时间（纳秒） | |
| 22 | 用户信息（新结构） | 见下表，**优先使用** |

**22 用户信息**

| 字段号 | 含义 |
|---|---|
| 22.1 | UID |
| 22.2.1 / 22.2.2 | 昵称 / 头像地址（头像未登录也不打码） |
| 22.3 | **粉丝牌**：.1 名称，.2 等级，.9 是否点亮（1 点亮，缺省为熄灭），.10 所属主播 UID，.11 大航海等级 ✅，.12 ⏳ 待确认，.15 ~ .19 新版颜色（背景、渐变、描边、文字、等级格，形如 `#919298CC`） |
| 22.4.1 | **荣耀等级**（B 站字段名 wealth，界面上叫荣耀等级；0 级时整项缺省）✅ |
| 22.6.1 | **大航海等级** ✅（P1 用 543 条真实进场验证：舰长进场时 22.6.1、22.3.11、9.9 均为 3） |

**9 粉丝牌（旧结构）**：.1 所属主播 UID，.2 等级，.3 名称，.4 ~ .7 旧版颜色（整数），.8 是否点亮，.9 大航海等级 ✅，.12 所属直播间，.13 ⏳ 待确认。

⚠️ **判断"本直播间的粉丝牌"**：比较 22.3.10（或 9.1）与主播 UID 是否相同。

⚠️ **熄灭的粉丝牌是灰色**：本次样本是 1 级牌子，颜色为 `#919298`（灰），而之前从榜单接口拿到的 1–10 级颜色是 `#5762A7`。推测**灰色表示粉丝牌已熄灭**（长时间未互动）。星临直接使用 B 站下发的颜色，所以不需要自己判断。

### 5.3 `ENTRY_EFFECT` ✅ 结构 / ⏳ 大航海样本

JSON 格式，主要字段：`uid`（未登录为 0）、`target_id`（主播 UID）、`face`（头像）、`privilege_type`（大航海等级，0 为无）、`copy_writing`（文案，昵称打码为 `<%S***%>`）、`web_basemap_url`（背景图）、`web_effective_time`（持续秒数）、`wealthy_info.level`（荣耀等级）、`identities`。

本次样本 `privilege_type` 为 0，是财富等级触发的进场特效，**不只是大航海才会有 `ENTRY_EFFECT`**。

**与 `INTERACT_WORD_V2` 的先后** ✅（61 条 `ENTRY_EFFECT` 统计）：`ENTRY_EFFECT` **总是先到**，同一个人的 `INTERACT_WORD_V2` 晚 0 ~ 1.5 秒（中位 1.3 秒）；13 条 `ENTRY_EFFECT` 没有对应的 `INTERACT_WORD_V2`。因为 `ENTRY_EFFECT` 没有粉丝牌信息，处理方式是：`ENTRY_EFFECT` 先等 1.6 秒，等到 `INTERACT_WORD_V2` 就合并，等不到再单独处理（`core/merge.ts`）。

### 5.4 `DANMU_MSG`（弹幕）✅

**仍是旧版 JSON 数组格式**（不是 protobuf），但数组里新增了结构化的用户信息：

| 位置 | 含义 |
|---|---|
| `info[1]` | 弹幕内容 |
| `info[2][0]` / `info[2][1]` | UID / 昵称 |
| `info[2][2]` | **是否房管**（1 是） |
| `info[3]` | 粉丝牌：`[等级, 名称, 主播昵称, 直播间号, 颜色, …]`，没戴为空数组 |
| `info[7]` | **大航海等级**：0 无，1 总督，2 提督，3 舰长 |
| `info[0][15].user` | 新版结构化用户信息：`uid`、`base`（昵称头像）、`medal`、`guard`、`guard_leader`、`wealth`、`anon`（⏳ 可能是神秘人）、`title`、`uhead_frame` 等，**优先使用** |
| `info[0][15].extra` | JSON 字符串，弹幕的附加信息 |
| `info[16][0]` | **荣耀等级** ✅（`info[0][15].user.wealth` 实测是空的，用这一项） |

本次样本来自一位**提督 + 房管、39 级粉丝牌**的观众：`info[7]` = 2，`info[2][2]` = 1，`info[3][0]` = 39，三处都对上了。

⚠️ 这个直播间里有账号会自动发"欢迎 xxx 来到直播间"之类的弹幕（疑似欢迎机器人）。**弹幕规则需要能排除这类账号**，可以直接加入黑名单。

### 5.5 `SEND_GIFT_V2`（送礼）✅

**旧版 `SEND_GIFT` 已不再出现**，改为 `SEND_GIFT_V2`，外层 JSON `{"cmd":"SEND_GIFT_V2","data":{"dmscore":…,"pb":"<base64>"}}`，`pb` 为 protobuf：

| 字段号 | 含义 |
|---|---|
| 1 / 2 / 3 | 送礼人 UID / 昵称 / 头像 |
| 8 | 粉丝牌（旧结构）：.1 所属主播 UID，.5 等级，.6 名称，.7 ~ .10 颜色 |
| 10.1 | **礼物 ID** |
| 10.2 | 礼物名称 |
| 10.3 | **数量** |
| 10.5 | 单价（金瓜子） |
| 10.7 | **本次总价值**（金瓜子）：实测 10 × 100 = 1000 ✅ |
| 10.8 | 币种：`gold` 付费，`silver` 免费 |
| 10.10 | 时间（秒） |
| 10.11 | **连击序号**（第几连击） |
| 10.12 | **连击批次号**，形如 `batch:gift:combo_id:<送礼人>:<主播>:<礼物ID>:<时间>`，用于合并连击 |
| 10.14 | **连击累计价值**（金瓜子） |
| 10.18 | 动作文案（"投喂"） |
| 10.29 / 10.33 | 收礼人（主播）昵称和 UID / 用户信息 |
| 10.35 | **礼物图标**（2026-09-27 实测 22 条全都有）：.1 静态 png（= 礼物配置接口的 `img_basic`）、.2 webp 动图、.5 gif。播放礼物特效优先用 .1，没有时再查礼物面板 |
| 15 | 送礼人用户信息（新结构），与 `INTERACT_WORD_V2` 的 22 相同：.1 UID，.2 昵称头像，.3 粉丝牌和新版颜色 |

另有 `COMBO_SEND`（JSON）：连击汇总，字段 `gift_id`、`gift_name`、`combo_num`、`combo_total_coin`、`batch_combo_id`、`coin_type`、`sender_uinfo` 等。**合并连击时以 `SEND_GIFT_V2` 的批次号为准**，`COMBO_SEND` 作为补充。

### 5.6 礼物配置接口 ✅

| 接口 | 内容 |
|---|---|
| `GET /xlive/web-room/v1/giftPanel/roomGiftList?platform=pc&room_id=<长号>` | **本直播间的礼物面板**（2026-09-27 实测合并后 101 个），每种礼物一个版本 |
| `GET /xlive/web-room/v1/giftPanel/giftConfig?platform=pc` | 全站礼物（实测 905 ~ 913 个），同名礼物有多个版本。项目里只用来给面板里查不到的礼物找图，一天读一次 |
| `GET /xlive/web-room/v1/giftPanel/tabRoomGiftList?tab_id=<页号>&room_id=…&ruid=…` | 面板某一页的礼物（网页切换分页时用）。内容和下面的 `tab_list` 一样，项目里不用 |

`roomGiftList` 的 `data` 里（2026-09-27，本直播间，匿名访问）：

| 字段 | 内容 |
|---|---|
| `gift_config.base_config.list` | 本直播间可送的礼物（96 个），带图 |
| `gift_config.room_config` | 本直播间特有的礼物（6 个：发红包、舰长一号、提督一号、总督一号、人气票等），带图，和上面有重复 |
| `gift_data.room_gift_list.gold_list` | 面板「礼物」页**实际显示的礼物和顺序**（61 个，只有 `gift_id`）。和网页上面板的顺序一致 |
| `gift_data.tab_list` | 其余几页：`tab_id`、`tab_name`、`position`、`list`（只有 `gift_id`）。实测「粉丝团」（tab_id 9，11 个）、「航海」（tab_id 2，9 个） |

两份 `config` 按 ID 合并去重后 101 个：面板三页一共 81 个，另外 20 个不在面板上显示（包裹、活动、特效版本等）。三页里的礼物在 `config` 里都能找到图。「包裹」「权益中心」两页是个人的，要登录，项目里不用。

字段：`id`、`name`、`price`（金瓜子）、`coin_type`（gold / silver）、`img_basic`、`gif`、`webp` 等。

- ✅ **1 元 = 1000 金瓜子**：小花花 100、告白花束 19900、小电视飞船 1245000，与售价一致。
- ✅ **免费礼物**：`coin_type` 为 `silver`，例如辣条、小心心。
- ⚠️ **同名礼物有多个 ID、价格不同**：例如"小电视飞船"有 1245 元和 2999 元两个版本。**指定礼物必须按礼物 ID 匹配**，界面上应从本直播间的礼物面板中选择。

### 5.6.1 上舰 ✅（1 个样本）

一次上舰，B 站会**同时推送三条**消息（P0 抓包里有一次开通舰长）：

| 消息 | 关键字段 | 说明 |
|---|---|---|
| `USER_TOAST_MSG_V2` | `sender_uinfo.uid / base.name / base.face`、`guard_info.guard_level`、`guard_info.op_type`、`pay_info.num / unit / price / payflow_id`、`toast_msg` | 信息最完整，**优先使用** |
| `USER_TOAST_MSG` | `uid`、`username`、`guard_level`、`num`、`unit`、`op_type`、`payflow_id`、`toast_msg` | 与 V2 的 `payflow_id` 相同 |
| `GUARD_BUY` | `uid`、`username`、`guard_level`、`num`、`price`、`gift_id` | **没有**开通 / 续费信息，也没有流水号 |

- **开通还是续费**：按 `toast_msg` 文案判断（"……开通了舰长" / "……续费了舰长"）。样本里 `op_type = 2`，文案却是"开通了舰长"（用户是第 121 天的老舰长，可能是过期后重新开通），和网上常见的"2 = 续费"不一致，所以**不依赖 `op_type`**；事件记录保留原始消息，以后多收集样本再确认。
- **月数**：`num`，`unit` 为"月"；为"年"时按 12 个月计算。
- **去重**：两条 toast 按 `payflow_id` 去重；`GUARD_BUY` 先等 3 秒，同一人同等级的 toast 到了就丢弃（见 `packages/core/src/combo.ts`）。
- 样本已脱敏为 `fixtures/bili/user_toast_msg_v2.cap-open.json` 等。

### 5.6.2 大航海图标（船锚）✅

B 站的大航海图标是一个船锚，蓝色舰长、紫色提督、红金色总督。版权归哔哩哔哩所有：只在运行时引用 B 站的地址，不放进项目。

| 等级 | 60 × 60（消息里的 `medal.guard_icon`） | 30 × 30（直播间网页脚本里的 `guardResource`） |
|---|---|---|
| 总督 `guard_1` | ⏳ 还没收到过样本 | `https://i0.hdslb.com/bfs/live/0d2b29717af2e7b1bbdc21a4fba8619636f82517.png` |
| 提督 `guard_2` | `https://i0.hdslb.com/bfs/live/62ac06fd72b05fe22be26426b9e1a8e1fc2c6b89.png` | `https://i0.hdslb.com/bfs/live/405bffdfd78bb562e0394dd828f8bf69ea01f400.png` |
| 舰长 `guard_3` | `https://i0.hdslb.com/bfs/live/48360c8f3b7de8031e86ff1ef4a2dfc0ec2a61c2.png` | `https://i0.hdslb.com/bfs/live/00749d246e2b49b2328cb981de02142fb6aeceba.png` |

**200 × 200 官方高清版（三个等级都有，后台界面在用）**：直播间「大航海」页的静态资源。文件名里带构建哈希，B 站改版后可能换地址，用的地方要准备加载失败时的替代图标。

| 等级 | 200 × 200 |
|---|---|
| 总督 | `https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/governor-DpDXKEdA.png` |
| 提督 | `https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/supervisor-u43ElIjU.png` |
| 舰长 | `https://s1.hdslb.com/bfs/static/blive/live-pay-mono/relation/relation/assets/captain-Bjw5Byb5.png`（200 × 203） |

- 60 × 60 的来源：弹幕 `DANMU_MSG` 的 `info[0][15].user.medal.guard_icon`、进场 `ENTRY_EFFECT` 的 `data.uinfo.medal.guard_icon`，和同一对象里的 `guard_level` 对应（2026-09-26 统计：舰长 417 次、提督 250 次，没有总督）。
- 30 × 30 的来源：直播间网页脚本 `bilibili.*.js` 里 `guardResource`：`{ guard_1, guard_2, guard_3 }`。
- 60 × 60 的总督版本仍没收到过样本（总督很少；两次共听 8 个热门直播间约 5 分钟没遇到）。有了上面的 200 × 200 版就不再需要。
- 不登录时「最近弹幕」接口（`dM/gethistory`）已经返回空列表，不能用。

### 5.6.3 大航海头像框 ✅

B 站给舰长、提督、总督的头像套一圈头像框（和船锚图标是一套配色）：200 × 200 透明 PNG，中间是直径约 144 像素的圆洞，圆心在图片中心（上方被徽章、下方被飘带压住一部分）。所以头像框要画成头像的 1.4 倍、居中套在外面。版权归哔哩哔哩所有：只在运行时引用。

| 等级 | 样子 | 地址 |
|---|---|---|
| 总督 | 红银，带翅膀的盾牌 | `https://i0.hdslb.com/bfs/live/39164ebfdd39db3d284b1221765e7e57f5a49958.png` |
| 提督 | 紫银，盾牌 | `https://i0.hdslb.com/bfs/live/09937c3beb0608e267a50ac3c7125c3f2d709098.png` |
| 舰长 | 蓝银，船锚 | `https://i0.hdslb.com/bfs/live/80f732943cc3367029df65e267960d56736a82ee.png` |

- 只有醒目留言带头像框：`SUPER_CHAT_MESSAGE`（以及 `av/v1/SuperChat/getMessageList` 接口）的 `user_info.face_frame`，和同一对象里的 `guard_level` 对应。2026-09-30 扫热门前 1000 个直播间当时挂着的醒目留言：舰长 4 次、提督 2 次，都是上表的地址；没有总督。
- 总督的地址来自直播间大航海榜的网页（第 1 名总督头像外的 `background-image`）。
- 弹幕、进场的 `uinfo.uhead_frame` 全是 `null`（2026-09-30 统计 400 条，其中提督 202 条）；大航海榜接口 `guardTab/topListNew`、用户卡片接口 `card/user` 里也没有。所以要按 `guard_level` 自己套框。
- 网上旧资料里有更早的舰长框（`78e8a800…`）、提督框（`9b3cfee1…`），说明 B 站换过设计：用的地方要准备加载失败时只显示头像。
- B 站图片支持 `@120w_120h.webp` 这样的后缀取缩略图（后台用）。

### 5.6.1.1 上舰的价格 ✅

- `USER_TOAST_MSG_V2.pay_info.price`、`USER_TOAST_MSG.price`：**实际支付**的价格（金瓜子），有折扣时是折扣价。2026-09-30 同一场里舰长有 138000、168000、198000 三种。
- `GUARD_BUY.price`：原价（同一次购买，toast 是 168000，GUARD_BUY 是 198000）。只有 GUARD_BUY 到了时才用它。
- 样本都是买 1 个月；买多个月时 price 是总价还是单价还没有样本（⏳），暂时按大小判断：超过这个等级一个月的最高价就当总价，否则乘月数。

### 5.6.1.2 醒目留言 SUPER_CHAT_MESSAGE ✅（结构）

和 `av/v1/SuperChat/getMessageList` 接口里的一条一样：`id`（编号，同一条可能推两次）、`uid`、`price`（**元**）、`message`、`start_time`（秒）、`time`（显示多少秒）、`user_info`（uname、face、guard_level、manager、face_frame）、`medal_info`、`uinfo`（新结构，带 wealth）。`SUPER_CHAT_MESSAGE_JPN` 是带日文翻译的同一条，不用。

### 5.6.4 荣耀等级勋章 ✅

荣耀等级（B 站字段名 wealth）在进场（`INTERACT_WORD_V2` 的 22.4.1）、高级进场（`ENTRY_EFFECT.wealthy_info.level`）、弹幕（`info[16][0]`）里都有；2026-09-30 抓到的 5 条送礼消息里没有。

每一级一张勋章图（图标 + 数字 + 底色画在一起，36 × 16，原图 108 × 48）：直播间网页用的公开接口，不用登录。

```
GET https://api.live.bilibili.com/xlive/general-interface/v1/content/get?key=wealth
→ data.content 是一段 JSON 文本：
  wealth_level_medal: [{ id: 等级 1 ~ 80, url, w: 36, h: 16, animated: 0 / 1 }]   （80 级是动图 webp）
  danmu_bubble_bg: 弹幕气泡背景（165 个）、player_icon（50 个）、wealth_level_url（荣耀等级说明页）
```

- 直播间网页按等级在 `wealth_level_medal` 里找 `id`，地址后面加 `@80q_54w_24h.webp` 取缩略图（和用户给的 68 级样本一致）。
- 服务端每天读一次存下来；版权归哔哩哔哩所有，只在运行时引用。
- 荣耀等级特权页（`activity-plat/static/20230526/…`）另有每 10 级一个的大图标（42 × 43），星临暂时没用。

### 5.6.5 高能榜、大航海榜 ✅

总览右侧面板用的两个名单接口（2026-09-30 用直播中的 21752762 实测）：

```
高能榜（在线观众）：GET https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?ruid=主播UID&roomId=房间号&page=1&pageSize=50
→ data.onlineNum（在线人数，和 ONLINE_RANK_COUNT 一样）、data.OnlineRankItem[]：userRank、uid、name、face、score（贡献值）、guard_level、wealth_level（荣耀等级）、is_mystery、medalInfo、uinfo（和进场消息的新结构一样）
   score 的单位是电池（实测一位观众：我们按礼物算 2850 电池，B 站 2860；他这场发了 225 条弹幕。盲盒按开出的礼物算，不按盲盒原价）。
   名单只有这场贡献值大于 0 的人（接口自己的说明：「投喂、点赞、发弹幕均可上榜」）：实测 398 人在线时 31 人上榜，12 人在线时 4 人上榜；登录不登录拿到的一样，所以不用登录读。

大航海榜（舰队名单）：GET https://api.live.bilibili.com/xlive/app-room/v2/guardTab/topListNew?roomid=房间号&page=1&ruid=主播UID&page_size=30&typ=5
→ data.info.num（大航海总人数）、info.page（总页数）；第 1 页有 top3（前 3 名）+ list，之后每页只有 list。page_size 最大 30（填更大会变成 10）。
   每人 uinfo：uid、base（昵称头像）、medal、guard.level、wealth。公开接口，不用登录；603 人的舰队读 21 页约 5 秒。
```

弹幕服务器也会推 `ONLINE_RANK_V3`（高能榜前几名，protobuf）、`ONLINE_RANK_COUNT`（在线人数），但名单不全，所以面板用上面的接口。

### 5.7 开播 / 下播

- ✅ `PREPARING`（下播）：`{"cmd":"PREPARING","roomid":"<房间号>","send_time":<毫秒>,…}`，注意 `roomid` 是字符串。
- ⏳ `LIVE`（开播）：待抓取。

### 5.8 其他本次出现的消息

| 消息 | 说明 |
|---|---|
| `UNIVERSAL_EVENT_GIFT` / `UNIVERSAL_EVENT_GIFT_V2` | ✅ **不是送礼**：是多人连麦的状态（布局、成员列表），与需求无关 |
| `DM_INTERACTION` | 弹幕互动聚合（例如多人发送相同内容） |
| `PK_INFO`、`PK_WIDGET` | 主播正在 PK |
| `ROOM_REAL_TIME_MESSAGE_UPDATE` | 粉丝数等实时数据 |

## 7. 竖屏安全区（手机端遮挡）✅

2026-09-25 用手机网页版（`live.bilibili.com/h5/<房间号>`，模拟 iPhone 14，可视区域 390 × 664）打开主播的竖屏直播间测量。手机网页版不播放视频，只显示封面并引导去 App，但界面布局是真实的：

| 区域 | 位置（px） | 占高度 |
|---|---|---|
| 顶部主播信息栏 | 16 ~ 53 | 约 8%（真机另有状态栏） |
| 弹幕区 | 390 ~ 602 | 从 59% 开始 |
| 底部输入框 | 602 ~ 664 | 最后约 9% |

**左右裁切**：封面图按"铺满"方式显示（宽度超出屏幕）。以 iPhone 全面屏（390 × 844）计算，1080 × 1920 的画面铺满屏幕时，**左右各被裁掉约 9%**。

**默认值**：顶部 12%，底部 40%，左右边距 9%。App 的布局可能与网页版略有差异，允许在后台调整。

## 6. 待实测

| # | 内容 | 状态 |
|---|---|---|
| 1 | 登录后昵称、UID 是否完整 | ✅ 主播自己的直播间完整 |
| 2 | 进场消息中粉丝牌、大航海、房管 | ✅ 粉丝牌、大航海已确认；房管字段没有，改用**房管名单接口**（公开，`/xlive/web-room/v1/roomAdmin/get_by_room`，分页 100） |
| 3 | 弹幕 `DANMU_MSG` 的格式 | ✅ |
| 4 | 礼物格式；免费 / 付费；单价单位 | ✅ `SEND_GIFT_V2`（protobuf）、`COMBO_SEND`；1 元 = 1000 金瓜子 |
| 5 | 上舰 `GUARD_BUY` / `USER_TOAST_MSG`；开通与续费的区分 | ✅ 三条消息同时推送；开通 / 续费按文案判断（见 5.6.1），续费样本待补充 |
| 6 | 开播 / 下播 `LIVE` / `PREPARING` | ✅ 下播；⏳ 开播 |
| 7 | 大航海进场时 `INTERACT_WORD_V2` 与 `ENTRY_EFFECT` 的先后和间隔 | ✅ `ENTRY_EFFECT` 先到，间隔 0 ~ 1.5 秒 |
| 8 | 扫码登录 | ✅ 接口可用：`passport.bilibili.com/x/passport-login/web/qrcode/generate` 与 `…/poll`；返回 `SESSDATA`、`bili_jct`、`DedeUserID` 等 Cookie 和 `refresh_token`；**SESSDATA 有效期约 6 个月** |
| 9 | Cookie 续期 | ⏳ |
| 10 | 礼物配置接口（名称、单价、图标） | ✅ |
| 11 | 神秘人的表现（`anon` 字段？） | ⏳ |
| 12 | 熄灭粉丝牌的颜色、22.3.12 的含义 | ⏳ |
| 13 | `UNIVERSAL_EVENT_GIFT` 的含义 | ✅ 连麦状态，与需求无关 |
