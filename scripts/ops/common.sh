#!/usr/bin/env bash
# 紫微斗数项目 —— 运维脚本公共库
#
# 只被 scripts/ops/ 下的脚本 source，不要单独执行。
# 提供：带时间戳的日志、连接串解析、终端对齐宽度计算、退出码常量。
#
# shellcheck shell=bash

# ── 退出码 ───────────────────────────────────────────────
ZIWEI_EX_OK=0        # 成功
ZIWEI_EX_USAGE=2     # 参数用法错误
ZIWEI_EX_DEPEND=3    # 缺少依赖命令
ZIWEI_EX_CONNECT=4   # 数据库连接失败
ZIWEI_EX_BACKUP=5    # 备份失败
ZIWEI_EX_VERIFY=6    # 校验失败
ZIWEI_EX_RESTORE=7   # 恢复失败
ZIWEI_EX_HEALTH=8    # 健康检查不达标

# ── 日志 ─────────────────────────────────────────────────
ziwei_ts() { date '+%Y-%m-%d %H:%M:%S'; }

ziwei_log() { printf '[%s] %s\n' "$(ziwei_ts)" "$*"; }
ziwei_step() { printf '\n[%s] === %s ===\n' "$(ziwei_ts)" "$*"; }
ziwei_warn() { printf '[%s] WARN  %s\n' "$(ziwei_ts)" "$*" >&2; }
ziwei_err() { printf '[%s] ERROR %s\n' "$(ziwei_ts)" "$*" >&2; }
ziwei_die() {
  local msg="${1:-未说明的错误}"
  local code="${2:-$ZIWEI_EX_OK}"
  ziwei_err "$msg"
  exit "$code"
}

# ── 依赖检查 ─────────────────────────────────────────────
ziwei_require_cmd() {
  local missing=0
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      ziwei_err "缺少依赖命令：$cmd"
      missing=1
    fi
  done
  (( missing == 0 )) || exit "$ZIWEI_EX_DEPEND"
}

# ── 连接串解析 ───────────────────────────────────────────
# 支持 postgresql://user:pass@host:port/db 与 postgres:// 两种写法；
# 未给 URL 时回落到 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 环境变量。
ziwei_url_decode() {
  local s="${1:-}"
  s="${s//+/ }"
  s="${s//%20/ }"
  s="${s//%2F//}"
  s="${s//%3A/:}"
  s="${s//%40/@}"
  s="${s//%3F/?}"
  s="${s//%26/\&}"
  s="${s//%3D/=}"
  s="${s//%25/%}"
  printf '%s' "$s"
}

# 用法：ziwei_load_conn [url]
# 结果写入全局变量：ZIWEI_PGHOST / ZIWEI_PGPORT / ZIWEI_PGUSER / ZIWEI_PGPASSWORD / ZIWEI_PGDATABASE
ziwei_load_conn() {
  local url="${1:-}"
  local rest hostport userinfo dbname=''

  if [[ -z "$url" ]]; then
    ZIWEI_PGHOST="${PGHOST:-127.0.0.1}"
    ZIWEI_PGPORT="${PGPORT:-5432}"
    ZIWEI_PGUSER="${PGUSER:-ziwei}"
    ZIWEI_PGPASSWORD="${PGPASSWORD:-}"
    ZIWEI_PGDATABASE="${PGDATABASE:-ziwei}"
  else
    rest="${url#*://}"
    if [[ "$rest" == */* ]]; then
      hostport="${rest%%/*}"
      dbname="${rest#*/}"
    else
      hostport="$rest"
    fi
    dbname="${dbname%%\?*}"
    dbname="${dbname%%#*}"
    [[ -n "$dbname" ]] || dbname=''

    userinfo=''
    if [[ "$hostport" == *@* ]]; then
      userinfo="${hostport%%@*}"
      hostport="${hostport#*@}"
    fi
    if [[ "$userinfo" == *:* ]]; then
      ZIWEI_PGUSER="${userinfo%%:*}"
      ZIWEI_PGPASSWORD="$(ziwei_url_decode "${userinfo#*:}")"
    else
      ZIWEI_PGUSER="$userinfo"
      ZIWEI_PGPASSWORD=''
    fi

    if [[ "$hostport" == \[*\]* ]]; then
      ZIWEI_PGHOST="${hostport%%\]*}"
      ZIWEI_PGHOST="${ZIWEI_PGHOST#\[}"
      ZIWEI_PGPORT="${hostport#*\]}"
      ZIWEI_PGPORT="${ZIWEI_PGPORT#:}"
    elif [[ "$hostport" == *:* ]]; then
      ZIWEI_PGHOST="${hostport%%:*}"
      ZIWEI_PGPORT="${hostport##*:}"
    else
      ZIWEI_PGHOST="$hostport"
      ZIWEI_PGPORT='5432'
    fi
    [[ -n "$dbname" ]] && ZIWEI_PGDATABASE="$dbname" || ZIWEI_PGDATABASE="${PGDATABASE:-ziwei}"
  fi

  [[ -n "${ZIWEI_PGHOST:-}" ]] || ZIWEI_PGHOST='127.0.0.1'
  [[ -n "${ZIWEI_PGPORT:-}" ]] || ZIWEI_PGPORT='5432'
  [[ -n "${ZIWEI_PGUSER:-}" ]] || ZIWEI_PGUSER='ziwei'
  [[ -n "${ZIWEI_PGDATABASE:-}" ]] || ZIWEI_PGDATABASE='ziwei'

  export PGHOST="$ZIWEI_PGHOST"
  export PGPORT="$ZIWEI_PGPORT"
  export PGUSER="$ZIWEI_PGUSER"
  export PGPASSWORD="$ZIWEI_PGPASSWORD"
  unset PGDATABASE || true
}

# psql 单行值查询
# 用法：ziwei_pg_scalar <db> <sql>
ziwei_pg_scalar() {
  local db="$1" sql="$2"
  psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$db" -c "$sql"
}

# 检查数据库是否可连（能 SELECT 1）
ziwei_pg_alive() {
  local db="$1"
  [[ "$(ziwei_pg_scalar "$db" 'SELECT 1' 2>/dev/null)" == '1' ]]
}

# 数据库是否存在
ziwei_pg_db_exists() {
  local db="$1"
  [[ "$(ziwei_pg_scalar postgres "SELECT 1 FROM pg_database WHERE datname = '$db'" 2>/dev/null)" == '1' ]]
}

# sha256（Linux 用 sha256sum，macOS 用 shasum）
ziwei_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    ziwei_die "找不到 sha256sum 或 shasum，无法计算校验和" "$ZIWEI_EX_DEPEND"
  fi
}

# ── 终端对齐 ─────────────────────────────────────────────
# 优先使用 UTF-8 locale，保证 ${#s} 按字符而不是字节计数
ziwei_set_locale() {
  local loc
  for loc in "${LC_ALL:-}" en_US.UTF-8 C.UTF-8 zh_CN.UTF-8 UTF-8; do
    [[ -n "$loc" ]] || continue
    if locale -a 2>/dev/null | grep -qix "$loc" 2>/dev/null; then
      export LC_ALL="$loc"
      return 0
    fi
  done
  return 0
}
ziwei_set_locale

# 计算字符串的显示宽度（CJK/全角算 2 列）
# bash >= 4 的 printf %d 能给出 Unicode 码点；bash 3.2 只给首字节（负数），按 >=0x80 视作 2 列
ziwei_dwidth() {
  local s="${1:-}" i c cp w=0
  local modern=0
  (( ${BASH_VERSINFO[0]:-3} >= 4 )) && modern=1
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    printf -v cp '%d' "'$c" 2>/dev/null || cp=63
    if (( modern == 0 )); then
      (( cp < 0 )) && cp=$(( cp + 256 ))
      if (( cp >= 0x80 )); then
        w=$(( w + 2 ))
        continue
      fi
      w=$(( w + 1 ))
      continue
    fi
    if (( cp >= 0x1100 )); then
      if (( (cp >= 0x1100 && cp <= 0x115F) || cp == 0x2329 || cp == 0x232A \
            || (cp >= 0x2E80 && cp <= 0xA4CF && cp != 0x303F) \
            || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) \
            || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) \
            || (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x20000 )); then
        w=$(( w + 2 ))
        continue
      fi
    fi
    w=$(( w + 1 ))
  done
  printf '%s' "$w"
}

# 右对齐填充到指定显示宽度
ziwei_rpad() {
  local s="${1:-}" width="$2" cur pad
  cur="$(ziwei_dwidth "$s")"
  if (( cur >= width )); then
    printf '%s' "$s"
    return
  fi
  pad=$(( width - cur ))
  printf '%s%*s' "$s" "$pad" ''
}
