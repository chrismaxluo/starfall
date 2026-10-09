#!/usr/bin/env bash
# 星临服务器版：一条命令安装、更新、回退。
#
# 安装（Debian / Ubuntu，用 root 运行）：
#   curl -fsSL https://raw.githubusercontent.com/chrismaxluo/starfall/main/deploy/starfall.sh | bash -s install
# 国内服务器连不上 GitHub 时，在网址前面加上加速站：
#   curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/chrismaxluo/starfall/main/deploy/starfall.sh | bash -s install
# 装好后用 starfall 命令管理：
#   starfall update      更新到最新正式版
#   starfall rollback    退回更新前的版本
#   starfall status      运行状态和版本
#   starfall help        全部命令
#
# 说明见 docs/deployment.md。整个脚本放在函数里，最后一行才执行：
# 用 curl | bash 运行时，bash 要先读完整个文件才开始执行，不会被中途读走的输入打乱。

starfall_main() {
  set -Eeuo pipefail

  local REPO_URL=${STARFALL_REPO:-https://github.com/chrismaxluo/starfall.git}
  # 服务名决定配置文件和服务文件的名字；一台机器装两份（例如测试）时用不同的名字
  local SERVICE=${STARFALL_SERVICE:-starfall}
  local CONF=/etc/starfall/$SERVICE.conf
  local STATE=/etc/starfall/$SERVICE.last-update
  local UNIT=/etc/systemd/system/$SERVICE.service
  local DROPIN=/etc/systemd/system/$SERVICE.service.d/10-starfall.conf
  local KEEP_BACKUPS=3

  # 安装时可以用参数改，之后保存在配置文件里
  local DIR=/opt/starfall PORT=17520 DOMAIN='' TZ_NAME=Asia/Shanghai REGISTRY='' MIRROR=''
  # GitHub 公共加速站：直连 GitHub 连不上或太慢时依次试（自己填的 MIRROR 排在最前面）。
  # 都是别人免费提供的，随时可能停用；桌面版 apps/desktop/src/sources.ts 里有同样的一份，改的时候两边一起改
  local GH_MIRRORS=(https://gh-proxy.com/ https://ghfast.top/ https://gh.llkk.cc/ https://ghproxy.net/)
  # 太慢的标准（和桌面版一样）：连续 15 秒平均每秒不到 200KB
  local SLOW_BPS=204800 SLOW_SEC=15
  # 这次的代码是从哪个加速站拉的（空为直连）；--no-verify 时不和 GitHub 核对
  local FETCHED_VIA='' NO_VERIFY=0 AUTO_REGISTRY=''

  # ---------- 输出 ----------
  if [[ -t 1 ]]; then
    local C_STEP=$'\e[1;36m' C_OK=$'\e[32m' C_WARN=$'\e[33m' C_ERR=$'\e[1;31m' C_DIM=$'\e[2m' C_END=$'\e[0m'
  else
    local C_STEP='' C_OK='' C_WARN='' C_ERR='' C_DIM='' C_END=''
  fi
  step() { printf '\n%s==> %s%s\n' "$C_STEP" "$*" "$C_END"; }
  ok() { printf '%s✓ %s%s\n' "$C_OK" "$*" "$C_END"; }
  warn() { printf '%s! %s%s\n' "$C_WARN" "$*" "$C_END" >&2; }
  die() {
    printf '%s✗ %s%s\n' "$C_ERR" "$*" "$C_END" >&2
    exit 1
  }
  dim() { printf '%s%s%s\n' "$C_DIM" "$*" "$C_END"; }

  # ---------- 通用 ----------
  need_root() { [[ $EUID -eq 0 ]] || die "请用 root 运行（前面加 sudo）"; }

  load_conf() {
    [[ -f $CONF ]] || die "没有找到 $CONF：这台机器上还没有用本脚本安装过星临。安装：starfall install"
    # shellcheck disable=SC1090
    source "$CONF"
  }

  save_conf() {
    mkdir -p "$(dirname "$CONF")"
    cat >"$CONF" <<EOF
# 星临服务器版的安装信息（starfall 命令读取）。改了以后运行：starfall apply
DIR=$(printf '%q' "$DIR")
PORT=$(printf '%q' "$PORT")
DOMAIN=$(printf '%q' "$DOMAIN")
TZ_NAME=$(printf '%q' "$TZ_NAME")
REGISTRY=$(printf '%q' "$REGISTRY")
MIRROR=$(printf '%q' "$MIRROR")
EOF
  }

  git_in() { git -C "$DIR" "$@"; }

  # 现在的版本：正好在某个标签上就显示标签，否则显示提交编号
  current_label() { git_in describe --tags --exact-match 2>/dev/null || git_in rev-parse --short HEAD; }

  # 最新正式版（不带 - 的 v 开头标签）
  latest_release() { git_in tag -l 'v*' --sort=-v:refname | grep -v -- '-' | head -n1; }

  resolve_target() {
    local want=$1
    case $want in
      '' | latest)
        want=$(latest_release)
        [[ -n $want ]] || die "没有找到正式版本"
        ;;
      dev | main) want=origin/$want ;;
    esac
    git_in rev-parse --verify -q "$want^{commit}" >/dev/null || die "没有这个版本：$want（可以用 starfall versions 查看）"
    printf '%s' "$want"
  }

  # 加速站地址：必须是 http(s) 网址，末尾补上 /
  normalize_mirror() {
    local m=$1
    [[ -z $m ]] && return 0
    [[ $m =~ ^https?://[^[:space:]?#]+$ ]] || die "加速站地址不对：$m（例如 https://ghfast.top/）"
    [[ $m == */ ]] || m=$m/
    printf '%s' "$m"
  }

  # 拉代码：先直连 GitHub；连不上或太慢时依次换加速站（最后一个不限速，慢也拉完）。
  # 用了加速站时记在 FETCHED_VIA，装之前要和 GitHub 核对版本（verify_target）。quiet：不打印换地址的提示
  fetch_code() {
    local quiet=${1:-} src n=0
    local -a srcs=('')
    if [[ $REPO_URL == https://github.com/* ]]; then
      [[ -n $MIRROR ]] && srcs+=("$MIRROR")
      for src in "${GH_MIRRORS[@]}"; do [[ $src != "$MIRROR" ]] && srcs+=("$src"); done
    fi
    for src in "${srcs[@]}"; do
      n=$((n + 1))
      local -a limit=(-c "http.lowSpeedLimit=$SLOW_BPS" -c "http.lowSpeedTime=$SLOW_SEC")
      ((n == ${#srcs[@]})) && limit=()
      if git_in "${limit[@]}" fetch -q --tags --force "$src$REPO_URL" '+refs/heads/*:refs/remotes/origin/*'; then
        FETCHED_VIA=$src
        [[ -n $src && -z $quiet ]] && warn "GitHub 直连连不上或太慢，这次代码从加速站 $src 下载"
        return 0
      fi
      [[ -z $quiet ]] && warn "从${src:-GitHub 直连}下载代码失败或太慢，换下一个"
    done
    return 1
  }

  # 从加速站拉的代码：要装的版本必须和 GitHub 上的一致（先用 git 问，再问 GitHub 的接口），核对不了就不装
  verify_target() {
    local target=$1 ref have want repo
    [[ -z $FETCHED_VIA || $NO_VERIFY == 1 ]] && return 0
    if [[ $target == origin/* ]]; then
      ref=refs/heads/${target#origin/}
    elif git_in show-ref --verify -q "refs/tags/$target"; then
      ref=refs/tags/$target
    elif [[ $target =~ ^[0-9a-f]{40}$ ]]; then
      return 0 # 完整的提交编号本身就能核对内容
    else
      die "从加速站下载代码时，只能装版本号（例如 v1.5.0）、dev、main 或完整的提交编号"
    fi
    have=$(git_in rev-parse "$ref")
    want=$(timeout 30 git ls-remote "$REPO_URL" "$ref" 2>/dev/null | awk -v r="$ref" '$2 == r { print $1 }') || true
    if [[ -z $want ]]; then
      repo=${REPO_URL#https://github.com/}
      want=$(curl -fsS -m 15 "https://api.github.com/repos/${repo%.git}/git/ref/${ref#refs/}" 2>/dev/null | grep -o '"sha": *"[0-9a-f]\{40\}"' | grep -o '[0-9a-f]\{40\}' | head -n1) || true
    fi
    [[ -n $want ]] || die "连不上 GitHub 核对版本，为了安全没有继续。确认信任加速站 $FETCHED_VIA 的话，加 --no-verify 再运行"
    [[ $want == "$have" ]] || die "加速站 $FETCHED_VIA 下载的 $target 和 GitHub 上的不一致，为了安全没有继续。可以稍后再试，或用 --mirror 换一个加速站"
    ok "已和 GitHub 核对：$target 一致"
  }

  # 没指定依赖镜像时，先测一下 npm 官方源：15 秒内平均每秒不到 200KB 或连不上，这次改用国内镜像 npmmirror
  # （依赖文件都带校验值，换镜像不影响安全）
  pick_registry() {
    [[ -n $REGISTRY || -n $AUTO_REGISTRY ]] && return 0
    local speed
    speed=$(curl -sS -o /dev/null -m "$SLOW_SEC" -w '%{speed_download}' https://registry.npmjs.org/typescript/-/typescript-5.4.5.tgz 2>/dev/null) || true
    speed=${speed%%.*}
    if ((${speed:-0} < SLOW_BPS)); then
      AUTO_REGISTRY=https://registry.npmmirror.com
      warn "npm 官方源连不上或太慢，这次改用国内镜像 $AUTO_REGISTRY"
    else
      AUTO_REGISTRY=-
    fi
  }

  pnpm_run() {
    (
      cd "$DIR"
      export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
      local reg=$REGISTRY
      [[ -z $reg && $AUTO_REGISTRY != - ]] && reg=$AUTO_REGISTRY
      if [[ -n $reg ]]; then export npm_config_registry=$reg COREPACK_NPM_REGISTRY=$reg; fi
      pnpm "$@" </dev/null
    )
  }

  install_deps() {
    pick_registry
    step "安装依赖（pnpm install）"
    pnpm_run install --frozen-lockfile || return 1
  }

  build_pages() {
    step "构建管理后台和特效页（小内存服务器上要一两分钟）"
    pnpm_run build || return 1
  }

  # 服务文件用仓库里的那份（换成实际目录）；端口、时区等写在单独的补充文件里，更新时不会丢
  write_unit() {
    [[ -f $DIR/deploy/starfall.service ]] || die "找不到 $DIR/deploy/starfall.service"
    sed "s#/opt/starfall#$DIR#g" "$DIR/deploy/starfall.service" >"$UNIT"
    mkdir -p "$(dirname "$DROPIN")"
    {
      echo "# 由 starfall 命令生成，请改 $CONF 后运行 starfall apply；自己的设置请另建一个文件（例如 20-my.conf）"
      echo "[Service]"
      echo "Environment=STARFALL_PORT=$PORT"
      echo "Environment=STARFALL_DATA=$DIR/data"
      echo "Environment=STARFALL_TZ=$TZ_NAME"
      if [[ -n $DOMAIN ]]; then
        # 只通过 Caddy 的 HTTPS 访问：服务只听本机，信任本机的代理
        echo "Environment=STARFALL_HOST=127.0.0.1"
        echo "Environment=STARFALL_TRUST_PROXY=127.0.0.1"
      fi
    } >"$DROPIN"
    systemctl daemon-reload
  }

  # 等服务能响应（最多 60 秒）
  wait_healthy() {
    local _
    for _ in $(seq 1 60); do
      if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
      sleep 1
    done
    return 1
  }

  # 正在直播时更新会让特效中断：查 B 站公开接口（不用登录）
  is_live() {
    local db=$DIR/data/starfall.db room
    [[ -f $db ]] || return 1
    room=$(cd "$DIR/apps/server" && node -e '
      const D = require("better-sqlite3");
      const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
      const r = db.prepare("select room_id from room limit 1").get();
      process.stdout.write(r ? String(r.room_id) : "");' "$db" 2>/dev/null) || return 1
    [[ -n $room ]] || return 1
    curl -fsS -m 5 "https://api.live.bilibili.com/room/v1/Room/room_init?id=$room" 2>/dev/null | grep -q '"live_status":1'
  }

  check_live() {
    local force=$1 what=${2:-更新}
    if [[ $force != 1 ]] && is_live; then
      die "直播间正在直播。现在${what}会让直播画面上的特效中断几秒。下播后再运行，或者加 --force 坚持继续"
    fi
  }

  # 数据库热备份（服务不用停）。只留最近几份，避免占满硬盘
  backup_db() {
    local tag=$1 db=$DIR/data/starfall.db out
    [[ -f $db ]] || return 0
    mkdir -p "$DIR/data/backups"
    out=$DIR/data/backups/update-$(date +%Y%m%d-%H%M%S)-$tag.db
    (cd "$DIR/apps/server" && node -e '
      const D = require("better-sqlite3");
      const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
      db.backup(process.argv[2]).then(() => db.close(), (e) => { console.error(e.message); process.exit(1); });' "$db" "$out") || return 1
    chown starfall:starfall "$out" 2>/dev/null || true
    chmod 600 "$out"
    # 退回要用的那一份（上一次更新前的备份）一直留着，不算在里面
    local keep='' f n=0
    # shellcheck disable=SC1090
    [[ -f $STATE ]] && keep=$(source "$STATE" && printf '%s' "${BACKUP:-}")
    # shellcheck disable=SC2012
    while IFS= read -r f; do
      if [[ $f == "$keep" ]]; then continue; fi
      n=$((n + 1))
      if ((n > KEEP_BACKUPS)); then rm -f -- "$f"; fi
    done < <(ls -1t "$DIR"/data/backups/update-*.db 2>/dev/null)
    printf '%s' "$out"
  }

  # 管理命令装到 /usr/local/bin/starfall：用仓库里最新的脚本（旧版本里可能还没有这个文件）
  install_cli() {
    local src
    for src in "$DIR/deploy/starfall.sh" origin/main origin/dev; do
      if [[ $src == /* ]]; then
        [[ -f $src ]] && install -m 755 "$src" /usr/local/bin/starfall && return 0
      elif git_in cat-file -e "$src:deploy/starfall.sh" 2>/dev/null; then
        git_in show "$src:deploy/starfall.sh" >/usr/local/bin/starfall && chmod 755 /usr/local/bin/starfall && return 0
      fi
    done
    warn "没有装上 starfall 命令（仓库里找不到 deploy/starfall.sh）"
  }

  # 两个版本之间数据库结构有没有变化
  schema_changed() { [[ -n $(git_in diff --name-only "$1" "$2" -- apps/server/drizzle) ]]; }

  # ---------- install ----------
  cmd_install() {
    local version=''
    while [[ $# -gt 0 ]]; do
      case $1 in
        --version) version=$2; shift 2 ;;
        --dir) DIR=$2; shift 2 ;;
        --port) PORT=$2; shift 2 ;;
        --domain) DOMAIN=$2; shift 2 ;;
        --tz) TZ_NAME=$2; shift 2 ;;
        --registry) REGISTRY=$2; shift 2 ;;
        --mirror) MIRROR=$(normalize_mirror "$2"); shift 2 ;;
        --no-verify) NO_VERIFY=1; shift ;;
        *) die "不认识的参数：$1（starfall help 查看用法）" ;;
      esac
    done
    need_root
    if ! [[ $PORT =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then die "端口不对：$PORT"; fi
    [[ -f $CONF ]] && die "这台机器已经装过星临（$CONF）。更新请用：starfall update"
    if [[ -e $DIR && -n $(ls -A "$DIR" 2>/dev/null) ]]; then die "$DIR 已经存在且不是空的。换一个目录（--dir）或先把它移走"; fi
    command -v apt-get >/dev/null || die "目前只支持 Debian / Ubuntu（需要 apt）"
    command -v systemctl >/dev/null || die "需要 systemd"

    step "安装系统软件（git、curl、ffmpeg）"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq </dev/null
    # make、python3：v1.4.0 及更早的版本安装依赖时会跑一次 node-gyp（只检查、不编译），没有它们会失败；退回旧版本时也用得上
    apt-get install -y -qq git curl ca-certificates ffmpeg make python3 </dev/null >/dev/null
    ok "完成"

    local major=0
    command -v node >/dev/null && major=$(node -p 'process.versions.node.split(".")[0]')
    if [[ $major != 24 ]]; then
      step "安装 Node.js 24（NodeSource 官方源）"
      local setup
      setup=$(mktemp)
      curl -fsSL https://deb.nodesource.com/setup_24.x -o "$setup"
      bash "$setup" </dev/null >/dev/null
      rm -f "$setup"
      apt-get install -y -qq nodejs </dev/null >/dev/null
    fi
    ok "Node.js $(node -v)"
    corepack enable

    # 内存小于 2 GB 又没有交换空间时，构建页面可能因为内存不够失败
    local mem_mb swap_mb
    mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
    swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
    if ((mem_mb < 2000 && swap_mb == 0)) && [[ ! -e /swapfile ]]; then
      step "内存只有 ${mem_mb} MB，添加 2 GB 交换空间 /swapfile"
      fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
      ok "完成"
    fi

    step "下载星临到 $DIR"
    mkdir -p "$DIR"
    git -c init.defaultBranch=main init -q "$DIR"
    git_in remote add origin "$REPO_URL"
    fetch_code || die "下载代码失败：GitHub 直连和几个加速站都不行。可以稍后重试，或用 --mirror 指定一个能用的加速站（先删掉 $DIR）"
    local target
    target=$(resolve_target "$version")
    verify_target "$target"
    git_in -c advice.detachedHead=false checkout -q --detach "$target"
    ok "版本 $(current_label)"

    install_deps || die "安装依赖失败（原因见上面的输出）。如果是网络慢、下载超时，可以加 --registry https://registry.npmmirror.com 重试（先删掉 $DIR）"
    build_pages || die "构建失败（多半是内存不够），先删掉 $DIR 再重试"

    step "创建服务账号和系统服务"
    id starfall >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin starfall
    mkdir -p "$DIR/data"
    chown -R starfall:starfall "$DIR/data"
    chmod 700 "$DIR/data"
    save_conf
    write_unit
    systemctl enable -q --now "$SERVICE"
    wait_healthy || die "服务没有启动成功，查看日志：journalctl -u $SERVICE -n 50"
    ok "服务已启动"

    if [[ -n $DOMAIN ]]; then setup_caddy; fi
    open_firewall
    install_cli

    local pw=''
    # 文件里是一句话「星临管理后台初始密码：xxx」，只取密码
    [[ -f $DIR/data/initial-password.txt ]] && pw=$(sed -n 's/.*初始密码：//p' "$DIR/data/initial-password.txt" | head -n1)
    step "安装完成"
    if [[ -n $DOMAIN ]]; then
      echo "管理后台：https://$DOMAIN/"
    else
      echo "管理后台：http://<服务器的公网 IP>:$PORT/"
      # IPv6 地址要加方括号才是能打开的网址
      dim "  本机地址：$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -n3 | sed -e 's#.*:.*#[&]#' -e "s#.*#http://&:$PORT/#" | paste -sd' ')"
      dim "  云服务器的公网 IP 在服务商的控制台里查看"
    fi
    [[ -n $pw ]] && echo "初始密码：$pw（登录后在「设置 → 管理后台」里修改）"
    if [[ -z $DOMAIN ]]; then
      warn "现在用的是 http，密码和直播间登录信息不加密传输。有域名后建议开启 HTTPS：见 docs/deployment.md"
      warn "记得在云服务商的安全组 / 防火墙里放行 TCP $PORT 端口"
    fi
    echo
    echo "以后更新：starfall update　　退回：starfall rollback　　状态：starfall status"
  }

  open_firewall() {
    if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
      if [[ -n $DOMAIN ]]; then ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null; else ufw allow "$PORT/tcp" >/dev/null; fi
      ok "已在 ufw 防火墙放行端口"
    fi
  }

  # 有域名：装 Caddy，自动申请 HTTPS 证书
  setup_caddy() {
    step "配置 HTTPS（Caddy 自动申请证书）：$DOMAIN"
    if ! command -v caddy >/dev/null; then
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg </dev/null >/dev/null
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq </dev/null
      apt-get install -y -qq caddy </dev/null >/dev/null
    fi
    mkdir -p /etc/caddy/conf.d
    grep -q '^import conf.d/\*' /etc/caddy/Caddyfile 2>/dev/null || printf '\nimport conf.d/*\n' >>/etc/caddy/Caddyfile
    cat >"/etc/caddy/conf.d/$SERVICE.caddy" <<EOF
# 星临（starfall 命令生成）
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
    ok "完成。域名要先解析到这台服务器，并放行 80、443 端口，证书才能申请成功"
  }

  # ---------- update ----------
  cmd_update() {
    local version='' force=0 mirror_arg=-
    while [[ $# -gt 0 ]]; do
      case $1 in
        --version) version=$2; shift 2 ;;
        --force) force=1; shift ;;
        --mirror) mirror_arg=$2; shift 2 ;;
        --no-verify) NO_VERIFY=1; shift ;;
        -*) die "不认识的参数：$1" ;;
        *) version=$1; shift ;;
      esac
    done
    need_root
    load_conf
    # 指定的加速站记进配置文件，以后更新也先试它（--mirror '' 清空）
    if [[ $mirror_arg != - ]]; then
      MIRROR=$(normalize_mirror "$mirror_arg")
      save_conf
    fi
    [[ -z $(git_in status --porcelain --untracked-files=no) ]] || die "$DIR 里有改动过的文件，先处理掉（git -C $DIR status 查看）"

    step "检查新版本"
    fetch_code || die "下载代码失败：GitHub 直连和几个加速站都不行。可以稍后重试，或用 --mirror 指定一个能用的加速站"
    local target from from_label to_label
    target=$(resolve_target "$version")
    from=$(git_in rev-parse HEAD)
    from_label=$(current_label)
    if [[ $(git_in rev-parse "$target^{commit}") == "$from" ]]; then
      ok "已经是最新版本：$from_label"
      install_cli
      return 0
    fi
    to_label=$target
    [[ $to_label == origin/* ]] && to_label="${target#origin/}（$(git_in rev-parse --short "$target")）"
    echo "$from_label → $to_label"
    verify_target "$target"
    check_live "$force"

    step "备份数据库"
    local backup
    backup=$(backup_db "$from_label") || die "备份失败，没有更新"
    ok "${backup:-还没有数据库，跳过}"
    printf 'FROM=%q\nFROM_LABEL=%q\nBACKUP=%q\nTIME=%q\n' "$from" "$from_label" "$backup" "$(date '+%F %T')" >"$STATE"

    git_in -c advice.detachedHead=false checkout -q --detach "$target"
    if ! install_deps; then
      warn "安装依赖失败，退回 $from_label"
      git_in checkout -q --detach "$from"
      install_deps || true
      die "更新失败，仍是 $from_label（服务没有重启）"
    fi

    # 先重启服务再构建页面：直播软件里的特效页先连上新的服务，构建完成后再在空闲时自动刷新成新页面。
    # 反过来的话，特效页可能正好在服务重启的那几秒刷新，停在打不开的页面上
    step "重启服务"
    write_unit
    systemctl restart "$SERVICE"
    if ! wait_healthy; then
      warn "新版本没有启动成功，自动退回"
      cmd_rollback --force --auto
      die "更新失败，已退回 $from_label。日志：journalctl -u $SERVICE -n 100"
    fi
    ok "服务已启动"

    if ! build_pages; then
      warn "构建页面失败，自动退回"
      cmd_rollback --force --auto
      die "更新失败，已退回 $from_label"
    fi
    install_cli
    step "已更新到 $(current_label)"
    echo "直播软件里的特效页会在空闲时自动刷新；管理后台顶部出现提示时点「刷新」。"
    echo "有问题可以退回：starfall rollback"
  }

  # ---------- rollback ----------
  cmd_rollback() {
    local force=0 auto=0
    while [[ $# -gt 0 ]]; do
      case $1 in
        --force) force=1; shift ;;
        --auto) auto=1; shift ;;
        *) die "不认识的参数：$1" ;;
      esac
    done
    need_root
    load_conf
    [[ -f $STATE ]] || die "没有可以退回的记录（还没用 starfall update 更新过）"
    local FROM FROM_LABEL BACKUP TIME
    # shellcheck disable=SC1090
    source "$STATE"
    local cur
    cur=$(git_in rev-parse HEAD)
    if [[ $cur == "$FROM" ]]; then
      ok "现在已经是 $FROM_LABEL"
      return 0
    fi
    [[ $auto == 1 ]] || check_live "$force" 退回
    step "退回到 $FROM_LABEL（$TIME 更新前的版本）"

    local restore_db=0
    if schema_changed "$FROM" "$cur"; then
      if [[ -n $BACKUP && -f $BACKUP ]]; then
        restore_db=1
        warn "两个版本的数据库结构不同，要恢复更新前的备份：$TIME 之后的事件记录和设置改动会丢失"
      else
        warn "数据库结构不同，但找不到更新前的备份，只退回程序"
      fi
    fi

    git_in -c advice.detachedHead=false checkout -q --detach "$FROM"
    install_deps || die "安装依赖失败"
    write_unit
    if [[ $restore_db == 1 ]]; then
      systemctl stop "$SERVICE"
      local db=$DIR/data/starfall.db
      mv -f "$db" "$db.before-rollback"
      rm -f "$db-wal" "$db-shm"
      cp "$BACKUP" "$db"
      chown starfall:starfall "$db"
      chmod 600 "$db"
      dim "  更新后的数据库留在 $db.before-rollback"
    fi
    systemctl restart "$SERVICE"
    wait_healthy || die "退回后服务没有启动成功，查看日志：journalctl -u $SERVICE -n 100"
    build_pages || die "构建页面失败"
    rm -f "$STATE"
    # 不动 starfall 命令：旧版本里的脚本更旧（或者没有），换上去会把新修的问题带回来
    ok "已退回 $(current_label)"
  }

  # 以前按部署指南手动装的：记下安装信息，之后也能用 starfall update / rollback
  cmd_adopt() {
    need_root
    [[ -f $CONF ]] && die "已经记录过了（$CONF）"
    systemctl cat "$SERVICE" >/dev/null 2>&1 || die "没有找到系统服务 $SERVICE"
    local unit
    unit=$(systemctl cat "$SERVICE")
    DIR=$(sed -n 's/^WorkingDirectory=//p' <<<"$unit" | tail -n1)
    [[ -d $DIR/.git ]] || die "服务的目录 $DIR 不是星临的代码目录"
    local v
    v=$(sed -n 's/^Environment=STARFALL_PORT=//p' <<<"$unit" | tail -n1) && [[ -n $v ]] && PORT=$v
    v=$(sed -n 's/^Environment=STARFALL_TZ=//p' <<<"$unit" | tail -n1) && [[ -n $v ]] && TZ_NAME=$v
    save_conf
    install_cli
    ok "已记录：目录 $DIR，端口 $PORT，时区 $TZ_NAME（$CONF）"
    dim "  下次 starfall update 时，服务文件会换成仓库里的版本，端口等设置写在 $DROPIN"
  }

  # ---------- 其他命令 ----------
  cmd_status() {
    load_conf
    echo "版本：$(current_label)"
    echo "目录：$DIR　端口：$PORT${DOMAIN:+　域名：https://$DOMAIN/}"
    if systemctl is-active -q "$SERVICE"; then ok "服务运行中"; else warn "服务没有运行（systemctl status $SERVICE）"; fi
    if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok "能正常响应"; else warn "没有响应"; fi
    if is_live; then echo "直播间：正在直播"; else echo "直播间：没有在直播（或查不到）"; fi
    fetch_code quiet 2>/dev/null || true
    local latest
    latest=$(latest_release)
    if [[ -n $latest && $(git_in rev-parse "$latest^{commit}") != $(git_in rev-parse HEAD) ]] && git_in merge-base --is-ancestor HEAD "$latest" 2>/dev/null; then
      echo "有新版本：$latest（starfall update）"
    fi
    if [[ -f $STATE ]]; then
      local FROM_LABEL TIME FROM BACKUP
      # shellcheck disable=SC1090
      source "$STATE"
      dim "可以退回到：$FROM_LABEL（$TIME 更新前）"
    fi
  }

  cmd_versions() {
    load_conf
    fetch_code quiet 2>/dev/null || true
    echo "正式版（最新的在前）："
    git_in tag -l 'v*' --sort=-v:refname | grep -v -- '-' | head -n 10 | sed 's/^/  /'
    echo "现在：$(current_label)"
  }

  cmd_apply() {
    need_root
    load_conf
    write_unit
    systemctl restart "$SERVICE"
    wait_healthy || die "服务没有启动成功：journalctl -u $SERVICE -n 50"
    ok "已按 $CONF 重启"
    # 后来才填的域名：这时再配 HTTPS
    if [[ -n $DOMAIN ]]; then
      setup_caddy
      open_firewall
    fi
  }

  cmd_backup() {
    need_root
    load_conf
    local out
    out=$(backup_db manual) || die "备份失败"
    ok "${out:-还没有数据库}"
    dim "  只是数据库。完整备份（含素材和密钥）见 docs/deployment.md「完整备份」"
  }

  cmd_password() {
    need_root
    load_conf
    (cd "$DIR" && pnpm reset-password </dev/null)
  }

  cmd_help() {
    cat <<EOF
星临服务器版管理命令

  starfall install [参数]   安装（只用一次）
      --version v1.4.0          装指定版本（默认最新正式版）
      --dir /opt/starfall       安装目录
      --port 17520              端口
      --domain 域名              用 Caddy 自动配置 HTTPS（域名要先解析到这台服务器）
      --tz Asia/Shanghai        主播所在时区
      --registry 地址            下载依赖用的镜像，例如 https://registry.npmmirror.com（不填时官方源太慢会自动用它）
      --mirror 地址              GitHub 直连不行时先试这个加速站，例如 https://ghfast.top/（不填时用内置的几个）
      --no-verify               从加速站下载代码后，连不上 GitHub 核对版本也继续（不建议）
  starfall adopt            以前按部署指南手动装的，改用本命令管理
  starfall update [版本]     更新到最新正式版，或指定版本；正在直播时会拒绝，加 --force 坚持
      --mirror 地址              同上，并记下来，以后更新也先试它（--mirror '' 清空）
      --no-verify               同上
  starfall rollback         退回上一次更新前的版本
  starfall status           运行状态、版本、有没有新版本
  starfall versions         可以安装的版本
  starfall backup           立即备份数据库
  starfall password         忘记后台密码时重新生成
  starfall apply            改了 $CONF 以后应用
  starfall logs             实时查看日志（Ctrl + C 退出）
EOF
  }

  local cmd=${1:-help}
  [[ $# -gt 0 ]] && shift
  case $cmd in
    install) cmd_install "$@" ;;
    adopt) cmd_adopt ;;
    update | upgrade) cmd_update "$@" ;;
    rollback) cmd_rollback "$@" ;;
    status) cmd_status ;;
    versions) cmd_versions ;;
    apply) cmd_apply ;;
    backup) cmd_backup ;;
    password) cmd_password ;;
    logs) load_conf && exec journalctl -u "$SERVICE" -f ;;
    help | -h | --help) cmd_help ;;
    *) die "不认识的命令：$cmd（starfall help 查看全部命令）" ;;
  esac
}

starfall_main "$@"
