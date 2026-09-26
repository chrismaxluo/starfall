# 部署指南

本文介绍如何在 Linux 服务器上部署、运行和维护星临。日常使用请参阅[使用手册](user-guide.md)。

## 1. 环境准备

| 项目 | 要求 |
|---|---|
| 操作系统 | Linux，已在 Debian 12 上验证 |
| Node.js | 24 或更高 |
| pnpm | 通过 Node.js 自带的 Corepack 启用，版本由 `package.json` 指定 |
| ffmpeg | 推荐安装。上传视频时用来检测透明通道和时长；没有安装时也能用，但不会提醒「素材没有透明背景」 |
| 内存 | 512 MB 以上（服务运行时约占 100 ~ 200 MB） |
| 网络 | 能访问 B 站；开放一个端口（默认 17520）给直播软件和浏览器 |

以 Debian 为例：

```bash
# Node.js 24（NodeSource 官方源）
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git ffmpeg

corepack enable
```

## 2. 安装

```bash
git clone https://github.com/chrismaxluo/starfall.git /opt/starfall
cd /opt/starfall
pnpm install
pnpm build          # 构建管理后台和特效页
```

先手动启动一次，确认能正常运行：

```bash
pnpm --filter @starfall/server start
```

首次启动会：

- 创建数据目录 `data/`（数据库、加密密钥、素材文件、备份都在这里）；
- 生成管理后台的**初始密码**，显示在日志中，同时写入 `data/initial-password.txt`。

在浏览器中打开 `http://<服务器地址>:17520/` 能看到登录页即可，按 `Ctrl + C` 停止，然后配置为系统服务。

## 3. 作为系统服务运行

仓库提供了 systemd 服务文件 `deploy/starfall.service`，默认安装目录为 `/opt/starfall`，端口 17520，并限制内存上限 450 MB。安装目录不同时，请先修改文件中的 `WorkingDirectory` 与 `STARFALL_DATA`。

```bash
cp deploy/starfall.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now starfall
```

常用命令：

```bash
systemctl status starfall        # 运行状态
systemctl restart starfall       # 重启
journalctl -u starfall -f        # 实时查看日志
journalctl -u starfall --since "1 hour ago"
```

服务崩溃后会在 3 秒内自动重启；服务器重启后会自动启动。

## 4. 开放端口

直播软件（浏览器源）和管理后台都通过这个端口访问星临，需要在服务器防火墙和云服务商的安全组中放行 TCP 17520。

- **Azure**：虚拟机 → 网络 → 添加入站端口规则，端口 17520，协议 TCP。
- **阿里云 / 腾讯云**：在实例的安全组中添加入方向规则。
- 服务器启用了 `ufw` 时：`ufw allow 17520/tcp`。

## 5. 配置

所有配置通过环境变量设置，在 systemd 服务文件的 `Environment=` 中修改后执行 `systemctl daemon-reload && systemctl restart starfall`。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `STARFALL_PORT` | `17520` | 服务端口 |
| `STARFALL_HOST` | `0.0.0.0` | 监听地址。放在反向代理后面时可以改为 `127.0.0.1` |
| `STARFALL_DATA` | `<安装目录>/data` | 数据目录 |
| `STARFALL_TZ` | `Asia/Shanghai` | 主播所在时区，用于「今天」的统计与专属用户有效期 |

## 6. 配置 HTTPS（可选）

通过公网访问管理后台时，建议在前面放一个反向代理并启用 HTTPS。需要注意转发 WebSocket（路径 `/ws/`）。

**Caddy**（自动申请证书）：

```
starfall.example.com {
    reverse_proxy 127.0.0.1:17520
}
```

**Nginx**：

```nginx
server {
    listen 443 ssl http2;
    server_name starfall.example.com;
    ssl_certificate     /etc/ssl/starfall/fullchain.pem;
    ssl_certificate_key /etc/ssl/starfall/privkey.pem;
    client_max_body_size 0;                 # 不限制大小：单个素材最大 100 MB，导入带素材的配置包会更大

    location / {
        proxy_pass http://127.0.0.1:17520;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;           # 特效页、后台的实时连接是长连接
    }
}
```

启用 HTTPS 后，直播软件里的浏览器源地址也改用 `https://` 开头的新地址（在「直播软件输出」页重新复制）。

## 7. 更新

```bash
cd /opt/starfall
git pull
pnpm install
pnpm build
systemctl restart starfall
```

- 数据库结构有变化时，服务启动时会自动升级，不需要手动操作。建议更新前先备份（见下一节）。
- 只修改了管理后台页面时，`pnpm build` 之后刷新浏览器即可，**不需要重启服务**。
- 重启期间特效会中断几秒，特效页会自动重新连接。**直播中尽量不要更新。**

## 8. 备份与恢复

### 自动备份

默认每天凌晨 4 点后自动备份一次，保存在 `data/backups/`，保留最近 7 份：

| 文件 | 内容 |
|---|---|
| `starfall-<日期>-<时间>.db` | 完整的数据库（规则、素材设置、事件记录、加密后的登录信息） |
| `starfall-<日期>-<时间>.json` | 配置（规则、素材设置、输出、设置），不含登录信息和密钥 |

可以在「设置 → 数据」中关闭自动备份，或下载配置文件。

### 完整备份

自动备份不包含上传的素材文件和加密密钥。迁移服务器或做完整备份时，停止服务后打包整个数据目录：

```bash
systemctl stop starfall
tar czf starfall-data-$(date +%Y%m%d).tar.gz -C /opt/starfall data
systemctl start starfall
```

### 从自动备份恢复

```bash
systemctl stop starfall
cd /opt/starfall/data
mv starfall.db starfall.db.bak
rm -f starfall.db-wal starfall.db-shm
cp backups/starfall-20260926-0400.db starfall.db
systemctl start starfall
```

### 迁移到另一台服务器

- **带登录信息整体迁移**：把上面打包的整个数据目录解压到新服务器的数据目录。加密密钥 `secret.key` 必须一起带过去，否则无法解密 B 站登录信息，需要重新扫码。
- **只迁移配置**：在旧服务器「设置」中导出配置（可以包含素材文件），在新服务器导入。导入前会先显示有哪些变化，确认后才生效。

## 9. 管理后台密码

- 修改密码：登录后在「设置」中修改。
- 忘记密码：在服务器上运行下面的命令，会生成新的随机密码并显示出来（也写入 `data/initial-password.txt`），原来的登录全部失效，服务不需要重启。

```bash
cd /opt/starfall && pnpm reset-password
```

## 10. 常见问题

**直播画面上看不到特效**
1. 在「直播软件输出」页查看特效页是否在线。不在线时，检查浏览器源地址是否完整、端口是否放行。
2. 确认是否正在直播：未开播时默认不播放（可以在「设置」中改为照常播放，用于排练）。
3. 在「事件记录」中查看这个事件命中了哪条规则、为什么没有播放。
4. 检查是否处于暂停状态（顶部会显示「所有特效已暂停」）。

**特效有画面但没有声音**
OBS 需要在浏览器源中勾选「通过 OBS 控制音频」。可以把浏览器源临时换成声音测试页 `http://<服务器地址>:17520/overlay/?loop=1` 检查：它每 8 秒播放一次测试音和舰长特效，并显示音频状态。

**一直显示未连接直播间**
默认只在开播时连接。确认 B 站账号已登录（「设置」中显示登录状态和剩余有效期）、直播间号正确；然后用 `journalctl -u starfall -f` 查看日志。

**端口被占用**
修改 `STARFALL_PORT` 后重启服务，同时放行新端口，并在直播软件里换成新地址。

**内存占用高**
服务文件中已限制 Node.js 堆内存（256 MB）和进程内存上限（450 MB），超出时 systemd 会自动重启服务。长期偏高时，可以在「设置」中缩短事件记录的保留天数。
