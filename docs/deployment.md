# 部署指南（服务器版）

本文介绍如何把星临装在自己的云服务器上。装好以后，管理后台和特效页都由服务器提供，电脑关机也不影响，手机也能随时打开后台。日常使用请参阅[使用手册](user-guide.md)。

> 不想租服务器的话，可以直接用**电脑版**：双击安装，在自己电脑上运行，功能和服务器版一样。

第一次租服务器，按第 1 ~ 5 节一步步做就行，大约 20 分钟。

## 1. 准备一台服务器

| 项目 | 建议 |
|---|---|
| 配置 | 1 核 CPU、1 GB 内存、20 GB 硬盘就够用（服务运行时只占 100 ~ 200 MB 内存） |
| 系统 | **Debian 12**（推荐）或 Ubuntu 22.04 / 24.04，64 位。普通的 x86（Intel / AMD）和 ARM（arm64）服务器都可以 |
| 地区 | 中国香港、日本、新加坡等**境外地区**最省事：下载软件快，用域名开 HTTPS 也不用备案。境内服务器也能用，但下载会慢，用域名还要先备案（见第 9 节） |
| 网络 | 按流量计费时，特效素材是从服务器传到直播软件的，素材多、视频大的话留意流量 |

在云服务商（阿里云、腾讯云、Azure、Vultr 等）买好后，记下三样东西：

1. **公网 IP**：例如 `203.0.113.10`，在服务器的控制台里能看到；
2. **登录用户名**：一般是 `root`（Ubuntu 有时是 `ubuntu`）；
3. **密码或密钥**：购买时设置的。

## 2. 放行端口

直播软件和浏览器要通过一个端口访问星临，默认是 **17520**。在云服务商的控制台里找到这台服务器的**安全组 / 防火墙**，添加一条入方向规则：

| 协议 | 端口 | 来源 |
|---|---|---|
| TCP | 17520 | 所有（0.0.0.0/0） |

- **阿里云 / 腾讯云**：实例 → 安全组 → 入方向 → 添加规则。
- **Azure**：虚拟机 → 网络 → 添加入站端口规则。
- 打算用域名开 HTTPS（第 6 节）的话，再放行 **80** 和 **443**，17520 就不用放行了。

## 3. 连上服务器

- **Windows**：打开「终端」或「PowerShell」，输入下面的命令（把 IP 换成你的），按提示输入密码（输入时不显示，正常）：

  ```bash
  ssh root@203.0.113.10
  ```

- 也可以用云服务商控制台里的「远程连接」「网页终端」，效果一样。

看到类似 `root@xxx:~#` 的提示，就是连上了。

> 不是 root 用户登录的（提示符以 `$` 结尾），先运行 `sudo -i` 切换到 root，再继续。

## 4. 一条命令安装

复制下面这一行，粘贴到服务器里，按回车：

```bash
curl -fsSL https://raw.githubusercontent.com/chrismaxluo/starfall/main/deploy/starfall.sh | bash -s install
```

它会自动完成：安装 Node.js 等软件 → 下载最新正式版 → 构建 → 设置成系统服务（开机自动启动、出错自动重启）。内存小于 2 GB 的服务器会自动加 2 GB 交换空间，避免构建时内存不够。全程大约 5 ~ 10 分钟，最后会显示：

```
==> 安装完成
管理后台：http://<服务器的公网 IP>:17520/
初始密码：xxxxxxxx（登录后在「设置 → 管理后台」里修改）
```

**常用参数**（加在 `install` 后面）：

| 参数 | 作用 |
|---|---|
| `--domain live.example.com` | 同时配置 HTTPS（见第 6 节） |
| `--port 17520` | 换一个端口 |
| `--registry https://registry.npmmirror.com` | 境内服务器下载依赖太慢时，换国内镜像 |
| `--version v1.4.0` | 装指定版本（默认最新正式版） |

例如：`curl -fsSL …/starfall.sh | bash -s install --domain live.example.com`

安装失败时，屏幕上会写明原因。按提示处理后，删掉安装目录再重新运行：`rm -rf /opt/starfall`。

## 5. 打开后台，开始使用

用浏览器打开 `http://<公网 IP>:17520/`，输入初始密码。首次登录会打开**新手引导**：扫码登录 B 站 → 填直播间 → 加到直播软件 → 发一个测试特效。详细说明见[使用手册](user-guide.md)。

打不开时，先检查第 2 节的端口有没有放行。

## 6. 开启 HTTPS（建议）

用 `http://` 访问时，后台密码和 B 站登录信息在网络上不加密。有域名的话，建议开启 HTTPS：

1. 在域名服务商那里添加一条 **A 记录**，把域名（例如 `live.example.com`）指向服务器的公网 IP；
2. 在安全组里放行 **80** 和 **443** 端口；
3. 在服务器上运行（安装时已经带了 `--domain` 的，这一步已经做过了）：

   ```bash
   sed -i 's/^DOMAIN=.*/DOMAIN=live.example.com/' /etc/starfall/starfall.conf
   starfall apply
   ```

脚本会安装 Caddy，自动申请和续期证书。之后用 `https://live.example.com/` 打开后台，直播软件里的浏览器源地址也要换成新的（在「直播软件输出」页重新复制）。开启后，星临只接受经过 HTTPS 的访问，17520 端口可以从安全组里删掉。

已经有自己的 Nginx 等反向代理的，见第 10.3 节。

## 7. 日常管理

装好以后，服务器上多了一个 `starfall` 命令：

| 命令 | 作用 |
|---|---|
| `starfall status` | 运行状态、现在的版本、有没有新版本 |
| `starfall update` | 更新到最新正式版 |
| `starfall rollback` | 退回上一次更新前的版本 |
| `starfall versions` | 可以安装的版本 |
| `starfall logs` | 实时查看日志（`Ctrl + C` 退出） |
| `starfall backup` | 立即备份数据库 |
| `starfall password` | 忘记后台密码时，生成一个新密码 |
| `starfall help` | 全部命令和参数 |

### 7.1 更新

```bash
starfall update
```

- **直播中会拒绝更新**（重启时特效会中断几秒）。下播后再运行；确实要更新时加 `--force`。
- 更新前自动备份数据库，保存在 `data/backups/update-*.db`，只保留最近 3 份。
- 先重启服务、再构建页面：直播软件里的特效页会先连上新的服务，然后在空闲时自动刷新成新页面，不用手动刷新浏览器源。管理后台顶部出现提示时点「刷新」。
- 新版本启动失败或构建失败时，**自动退回**原来的版本。
- 数据库结构有变化时，服务启动时会自动升级，不需要手动操作。
- 想装测试中的版本：`starfall update dev`（不稳定，不建议直播用）。

### 7.2 退回

更新后发现问题，可以退回到更新前的版本：

```bash
starfall rollback
```

两个版本的数据库结构相同时，只退回程序，数据不受影响。结构不同时，会恢复更新前的数据库备份：**更新之后产生的事件记录和设置改动会丢失**（更新后的数据库留在 `data/starfall.db.before-rollback`）。

### 7.3 以前手动装的

按旧版部署指南手动安装的（系统服务名是 `starfall`），先运行一次下面的命令，之后就能用 `starfall update` 等命令：

```bash
curl -fsSL https://raw.githubusercontent.com/chrismaxluo/starfall/main/deploy/starfall.sh | bash -s adopt
```

## 8. 备份与恢复

### 自动备份

默认每天凌晨 4 点后自动备份一次，保存在 `data/backups/`，保留最近 7 份：

| 文件 | 内容 |
|---|---|
| `starfall-<日期>-<时间>.db` | 完整的数据库（规则、素材设置、事件记录、加密后的登录信息） |
| `starfall-<日期>-<时间>.json` | 配置（规则、素材设置、输出、设置），不含登录信息和密钥 |

可以在「设置 → 数据」中关闭自动备份、立即备份，或「恢复到这份」。

### 完整备份

自动备份不包含上传的素材文件和加密密钥。迁移服务器或做完整备份时，停止服务后打包整个数据目录：

```bash
systemctl stop starfall
tar czf starfall-data-$(date +%Y%m%d).tar.gz -C /opt/starfall data
systemctl start starfall
```

### 从备份文件恢复数据库

```bash
systemctl stop starfall
cd /opt/starfall/data
mv starfall.db starfall.db.bak
rm -f starfall.db-wal starfall.db-shm
cp backups/starfall-20260926-0400.db starfall.db
chown starfall:starfall starfall.db
systemctl start starfall
```

### 搬到另一台服务器或电脑版

- **带登录信息整体搬**：在新服务器上安装好，停止服务，把上面打包的整个数据目录解压到 `/opt/starfall/data`（再运行 `chown -R starfall:starfall /opt/starfall/data`），然后启动。加密密钥 `secret.key` 必须一起带过去，否则要重新扫码。
- **只搬配置**：在旧的后台「设置 → 数据」导出配置（可以包含素材文件），在新的后台导入。导入前会先显示有哪些变化，确认后才生效。服务器版和电脑版之间也可以这样互相搬。

## 9. 境内服务器

- **下载慢**：安装时加 `--registry https://registry.npmmirror.com`。GitHub 实在连不上时，可以先在别处下载代码，用第 10.1 节的方法手动安装。
- **域名要备案**：境内服务器用域名开放 80、443 端口需要先完成 ICP 备案，没备案时只能用 `http://IP:端口` 访问。
- **B 站连接**：境内外服务器都能正常连接 B 站直播间，无需特别设置。

## 10. 进阶

### 10.1 手动安装

不用一条命令安装时，可以按下面的步骤手动来。需要：Node.js 24、git，推荐装 ffmpeg（用来检测视频的透明通道和时长）。

```bash
# Node.js 24（NodeSource 官方源）
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git ffmpeg
corepack enable

git clone https://github.com/chrismaxluo/starfall.git /opt/starfall
cd /opt/starfall
git checkout v1.4.0     # 换成最新正式版
pnpm install
pnpm build              # 构建管理后台和特效页
```

服务以专用的低权限账号 `starfall` 运行，只能写数据目录：

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin starfall
mkdir -p /opt/starfall/data && chown -R starfall:starfall /opt/starfall/data
cp deploy/starfall.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now starfall
```

服务文件 `deploy/starfall.service` 默认安装目录为 `/opt/starfall`、端口 17520，并限制内存上限 450 MB；目录不同时要改其中的路径。首次启动会生成管理后台的初始密码，写在 `data/initial-password.txt`。

手动安装的更新方法（先重启再构建，原因见第 7.1 节）：

```bash
cd /opt/starfall
git fetch --tags && git checkout v1.5.0
pnpm install
systemctl restart starfall
pnpm build
```

也可以运行一次 `starfall adopt`（第 7.3 节），之后用 `starfall update`。

### 10.2 配置项

用 `starfall` 命令安装的，端口、时区、域名记在 `/etc/starfall/starfall.conf`，改完运行 `starfall apply`。其他设置写在服务的补充文件里，例如新建 `/etc/systemd/system/starfall.service.d/20-my.conf`：

```ini
[Service]
Environment=STARFALL_TRUST_PROXY=10.0.0.5
```

然后运行 `systemctl daemon-reload && systemctl restart starfall`。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `STARFALL_PORT` | `17520` | 服务端口 |
| `STARFALL_HOST` | `0.0.0.0` | 监听地址。只通过本机的反向代理访问时改为 `127.0.0.1` |
| `STARFALL_DATA` | `<安装目录>/data` | 数据目录 |
| `STARFALL_TZ` | `Asia/Shanghai` | 主播所在时区，用于「今天」的统计与专属用户有效期 |
| `STARFALL_ADMIN_DIST` / `STARFALL_OVERLAY_DIST` | `<安装目录>/apps/admin/dist`、`<安装目录>/apps/overlay/dist` | 构建好的管理后台、特效页所在目录（一般不用改） |
| `STARFALL_TRUST_PROXY` | 不设置 | 放在 HTTPS 反向代理后面时填代理的地址（同一台机器上填 `127.0.0.1`），用于识别访问者的真实地址（登录限流按人计算）和 HTTPS（Cookie 加上 secure） |

### 10.3 自己的反向代理

已经在用 Nginx 等反向代理时，不用第 6 节的 Caddy，自己转发到 `127.0.0.1:17520` 即可。注意要转发 WebSocket（路径 `/ws/`）：

```nginx
server {
    listen 443 ssl http2;
    server_name live.example.com;
    ssl_certificate     /etc/ssl/starfall/fullchain.pem;
    ssl_certificate_key /etc/ssl/starfall/privkey.pem;
    client_max_body_size 0;                 # 不限制大小：单个素材最大 100 MB，导入带素材的配置包会更大

    location / {
        proxy_pass http://127.0.0.1:17520;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;           # 特效页、后台的实时连接是长连接
    }
}
```

配好后按第 10.2 节设置 `STARFALL_TRUST_PROXY=127.0.0.1`（代理在另一台机器上时填那台机器的地址），并建议把 `STARFALL_HOST` 改为 `127.0.0.1`、关闭 17520 端口的公网访问。

### 10.4 系统服务命令

```bash
systemctl status starfall        # 运行状态
systemctl restart starfall       # 重启
journalctl -u starfall -f        # 实时查看日志
journalctl -u starfall --since "1 hour ago"
```

服务崩溃后会在 3 秒内自动重启；服务器重启后会自动启动。

## 11. 常见问题

**浏览器打不开后台**
1. 检查安全组里有没有放行端口（第 2 节）；
2. 在服务器上运行 `starfall status`，看服务是否在运行、能否正常响应；
3. 服务器自己也开了防火墙（`ufw`）时：`ufw allow 17520/tcp`。

**直播画面上看不到特效**
1. 在「直播软件输出」页查看特效页是否在线。不在线时，检查浏览器源地址是否完整、端口是否放行。
2. 确认是否正在直播：未开播时默认不播放（可以在「设置」中改为照常播放，用于排练）。
3. 在「事件记录」中查看这个事件命中了哪条规则、为什么没有播放。
4. 检查是否处于暂停状态（顶部会显示「所有特效已暂停」）。

**特效有画面但没有声音**
OBS 需要在浏览器源中勾选「通过 OBS 控制音频」。可以把浏览器源临时换成声音测试页 `http://<服务器地址>:17520/overlay/?loop=1` 检查：它每 8 秒播放一次测试音和舰长特效，并显示音频状态。

**一直显示未连接直播间**
默认只在开播时连接。确认 B 站账号已登录（「设置」中显示登录状态和剩余有效期）、直播间号正确；然后用 `starfall logs` 查看日志。

**HTTPS 证书申请不下来**
确认域名已经解析到这台服务器（`ping 域名` 显示的是服务器 IP）、80 和 443 端口已放行，然后用 `journalctl -u caddy -n 50` 查看原因。境内服务器需要先备案。

**端口被占用**
改 `/etc/starfall/starfall.conf` 里的 `PORT`，运行 `starfall apply`，同时放行新端口，并在直播软件里换成新地址。

**内存占用高**
服务文件中已限制 Node.js 堆内存（256 MB）和进程内存上限（450 MB），超出时会自动重启服务。长期偏高时，可以在「设置」中缩短事件记录的保留天数。
