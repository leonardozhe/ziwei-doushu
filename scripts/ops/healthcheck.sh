#!/usr/bin/env bash
# 紫微斗数项目 —— 整体健康检查
#
#   ./healthcheck.sh [选项]
#
# 检查项：
#   1. Postgres 容器 ziwei-postgres 是否 running
#   2. 数据库能否连接
#   3. /api/health 是否返回 ok
#   4. 关键表行数（命盘 674976 / 解读 8774688）
#   5. 数据集覆盖年份数（1950-2026，77 年）
#   6. 磁盘剩余空间
#
# 任何一项不达标 → 退出码非 0。
#
# 选项：
#   --url <url>         站点根地址（默认 http://127.0.0.1:3020）
#   --conn <url>        数据库连接串（默认 $ZIWEI_DATABASE_URL）
#   --min-free-gb <n>   磁盘最小剩余 GB（默认 20）
#   --expect-charts <n>  期望命盘数（默认 674976）
#   --expect-readings <n> 期望解读段数（默认 8774688）
#   --expect-years <n> 期望覆盖年份数（默认 77）
#   --expect-min-year <y> 期望起始年份（默认 1950）
#   --expect-max-year <y> 期望结束年份（默认 2026）
#   --container <name>  容器名（默认 ziwei-postgres）
#   --skip-api          跳过 /api/health 检查
#   --skip-container    跳过容器检查
#   --json              额外输出 JSON 汇总
#   -h, --help          显示帮助
#
# 退出码：0 全部通过 / 8 有检查项不达标 / 2 参数错误 / 3 缺依赖 / 4 连不上库
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/common.sh
source "$SCRIPT_DIR/common.sh"

# 日志统一走 stderr，stdout 只保留表格（--json 时表格也走 stderr，stdout 留给纯 JSON）
ziwei_log()  { printf '[%s] %s\n' "$(ziwei_ts)" "$*" >&2; }
ziwei_step() { printf '\n[%s] === %s ===\n' "$(ziwei_ts)" "$*" >&2; }
ziwei_warn() { printf '[%s] WARN  %s\n' "$(ziwei_ts)" "$*" >&2; }
ziwei_err()  { printf '[%s] ERROR %s\n' "$(ziwei_ts)" "$*" >&2; }

usage() {
  sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

APP_URL="http://127.0.0.1:3020"
CONN="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
MIN_FREE_GB=20
EXPECT_CHARTS=674976
EXPECT_READINGS=8774688
EXPECT_YEARS=77
EXPECT_MIN_YEAR=1950
EXPECT_MAX_YEAR=2026
CONTAINER='ziwei-postgres'
SKIP_API=0
SKIP_CONTAINER=0
WANT_JSON=0

while (( $# > 0 )); do
  case "$1" in
    --url)              [[ $# -ge 2 ]] || ziwei_die "--url 需要参数" "$ZIWEI_EX_USAGE"; APP_URL="$2"; shift 2 ;;
    --conn)             [[ $# -ge 2 ]] || ziwei_die "--conn 需要参数" "$ZIWEI_EX_USAGE"; CONN="$2"; shift 2 ;;
    --min-free-gb)      [[ $# -ge 2 ]] || ziwei_die "--min-free-gb 需要参数" "$ZIWEI_EX_USAGE"; MIN_FREE_GB="$2"; shift 2 ;;
    --expect-charts)    [[ $# -ge 2 ]] || ziwei_die "--expect-charts 需要参数" "$ZIWEI_EX_USAGE"; EXPECT_CHARTS="$2"; shift 2 ;;
    --expect-readings)  [[ $# -ge 2 ]] || ziwei_die "--expect-readings 需要参数" "$ZIWEI_EX_USAGE"; EXPECT_READINGS="$2"; shift 2 ;;
    --expect-years)     [[ $# -ge 2 ]] || ziwei_die "--expect-years 需要参数" "$ZIWEI_EX_USAGE"; EXPECT_YEARS="$2"; shift 2 ;;
    --expect-min-year)  [[ $# -ge 2 ]] || ziwei_die "--expect-min-year 需要参数" "$ZIWEI_EX_USAGE"; EXPECT_MIN_YEAR="$2"; shift 2 ;;
    --expect-max-year)  [[ $# -ge 2 ]] || ziwei_die "--expect-max-year 需要参数" "$ZIWEI_EX_USAGE"; EXPECT_MAX_YEAR="$2"; shift 2 ;;
    --container)        [[ $# -ge 2 ]] || ziwei_die "--container 需要参数" "$ZIWEI_EX_USAGE"; CONTAINER="$2"; shift 2 ;;
    --skip-api)         SKIP_API=1; shift ;;
    --skip-container)   SKIP_CONTAINER=1; shift ;;
    --json)             WANT_JSON=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *)                  usage >&2; ziwei_die "未知参数：$1" "$ZIWEI_EX_USAGE" ;;
  esac
done

ziwei_require_cmd psql curl

LABEL_W=26
VALUE_W=26
FAILED=0
declare -a ROWS_NAME=()
declare -a ROWS_VALUE=()
declare -a ROWS_STATUS=()
declare -a ROWS_DETAIL=()

add_row() {
  local name="$1" value="$2" status="$3" detail="${4:-}"
  ROWS_NAME+=("$name")
  ROWS_VALUE+=("$value")
  ROWS_STATUS+=("$status")
  ROWS_DETAIL+=("$detail")
  case "$status" in
    OK|跳过|警告) ;;
    *) FAILED=$(( FAILED + 1 )) ;;
  esac
}

print_table() {
  local i name value status detail line sink=1
  # --json 时表格让位给 JSON，输出到 stderr
  (( WANT_JSON == 1 )) && sink=2
  printf '%s  %s  %s\n' "$(ziwei_rpad '检查项' "$LABEL_W")" "$(ziwei_rpad '实际值' "$VALUE_W")" "状态" >&"$sink"
  printf '%s  %s  %s\n' "$(ziwei_rpad '--------------------------' "$LABEL_W")" "$(ziwei_rpad '--------------------------' "$VALUE_W")" '----' >&"$sink"
  for i in "${!ROWS_NAME[@]}"; do
    name="${ROWS_NAME[$i]}"; value="${ROWS_VALUE[$i]}"; status="${ROWS_STATUS[$i]}"; detail="${ROWS_DETAIL[$i]}"
    line="$(ziwei_rpad "$name" "$LABEL_W")  $(ziwei_rpad "$value" "$VALUE_W")  $status"
    [[ -n "$detail" ]] && line="$line  $detail"
    printf '%s\n' "$line" >&"$sink"
  done
}

ziwei_step "紫微斗数项目健康检查"
ziwei_log "站点：$APP_URL"
ziwei_log "数据库：$CONN"

# ── 1. 容器 ──────────────────────────────────────────────
if (( SKIP_CONTAINER == 1 )); then
  add_row "Postgres 容器" "-" "跳过"
elif ! command -v docker >/dev/null 2>&1; then
  add_row "Postgres 容器" "docker 不可用" "警告" "跳过容器检查"
else
  c_state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo 'not-found')"
  c_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo 'none')"
  if [[ "$c_state" == "running" ]]; then
    add_row "Postgres 容器" "$CONTAINER ($c_state)" "OK" "health=$c_health"
  else
    add_row "Postgres 容器" "$CONTAINER ($c_state)" "失败"
  fi
fi

# ── 2. 数据库连接 ───────────────────────────────────────
ziwei_load_conn "$CONN"
DB="$ZIWEI_PGDATABASE"
if ziwei_pg_alive "$DB"; then
  add_row "数据库连接" "$PGHOST:$PGPORT/$DB" "OK"
  DB_OK=1
else
  add_row "数据库连接" "$PGHOST:$PGPORT/$DB" "失败" "无法 SELECT 1"
  DB_OK=0
fi

# ── 3. /api/health ───────────────────────────────────────
if (( SKIP_API == 1 )); then
  add_row "API /api/health" "-" "跳过"
else
  api_body="$(curl -s -m 15 -w '\n%{http_code}' "$APP_URL/api/health" 2>/dev/null || true)"
  api_code="$(printf '%s' "$api_body" | tail -n1)"
  api_json="$(printf '%s' "$api_body" | sed '$d')"
  api_status="$(printf '%s' "$api_json" | jq -r '.status // "unknown"' 2>/dev/null || echo 'unknown')"
  if [[ "$api_code" == "200" && "$api_status" == "ok" ]]; then
    add_row "API /api/health" "HTTP $api_code, status=$api_status" "OK"
  else
    add_row "API /api/health" "HTTP ${api_code:-none}, status=$api_status" "失败"
  fi
fi

# ── 4/5. 表行数与年份覆盖 ────────────────────────────────
if (( DB_OK == 1 )); then
  charts="$(ziwei_pg_scalar "$DB" 'SELECT count(*) FROM ziwei_charts' | tr -d '[:space:]')"
  readings="$(ziwei_pg_scalar "$DB" 'SELECT count(*) FROM ziwei_readings' | tr -d '[:space:]')"
  sections="$(ziwei_pg_scalar "$DB" 'SELECT count(*) FROM ziwei_sections' 2>/dev/null | tr -d '[:space:]' || echo '')"
  yrs="$(ziwei_pg_scalar "$DB" 'SELECT count(DISTINCT birth_year) FROM ziwei_charts' | tr -d '[:space:]')"
  yr_from="$(ziwei_pg_scalar "$DB" 'SELECT min(birth_year) FROM ziwei_charts' | tr -d '[:space:]')"
  yr_to="$(ziwei_pg_scalar "$DB" 'SELECT max(birth_year) FROM ziwei_charts' | tr -d '[:space:]')"

  if [[ "$charts" == "$EXPECT_CHARTS" ]]; then
    add_row "命盘数 ziwei_charts" "$charts" "OK" "期望 $EXPECT_CHARTS"
  else
    add_row "命盘数 ziwei_charts" "$charts" "失败" "期望 $EXPECT_CHARTS"
  fi

  if [[ "$readings" == "$EXPECT_READINGS" ]]; then
    add_row "解读段数 ziwei_readings" "$readings" "OK" "期望 $EXPECT_READINGS"
  else
    add_row "解读段数 ziwei_readings" "$readings" "失败" "期望 $EXPECT_READINGS"
  fi

  if [[ -n "$sections" ]]; then
    add_row "小节数 ziwei_sections" "$sections" "OK" "参考值"
  fi

  if [[ "$yrs" == "$EXPECT_YEARS" && "$yr_from" == "$EXPECT_MIN_YEAR" && "$yr_to" == "$EXPECT_MAX_YEAR" ]]; then
    add_row "覆盖年份" "$yr_from-$yr_to（$yrs 年）" "OK" "期望 $EXPECT_MIN_YEAR-$EXPECT_MAX_YEAR（$EXPECT_YEARS 年）"
  else
    add_row "覆盖年份" "$yr_from-$yr_to（$yrs 年）" "失败" "期望 $EXPECT_MIN_YEAR-$EXPECT_MAX_YEAR（$EXPECT_YEARS 年）"
  fi

  db_size="$(ziwei_pg_scalar "$DB" 'SELECT pg_size_pretty(pg_database_size(current_database()))' | tr -d '[:space:]')"
  add_row "数据库大小" "$db_size" "OK" "参考值"
else
  add_row "命盘数 ziwei_charts" "-" "失败" "数据库不可达"
  add_row "解读段数 ziwei_readings" "-" "失败" "数据库不可达"
  add_row "覆盖年份" "-" "失败" "数据库不可达"
fi

# ── 6. 磁盘 ──────────────────────────────────────────────
BACKUP_DIR="${ZIWEI_BACKUP_DIR:-/home/ci/dev/ziwei-global/backups}"
disk_path="$BACKUP_DIR"
[[ -d "$disk_path" ]] || disk_path="$(df -P . | awk 'NR==2{print $6}')"
free_kb="$(df -Pk "$disk_path" | awk 'NR==2{print $4}')"
free_gb=$(( free_kb / 1024 / 1024 ))
used_pct="$(df -Pk "$disk_path" | awk 'NR==2{print $5}' | tr -d '%')"
if (( free_gb >= MIN_FREE_GB )); then
  add_row "磁盘剩余空间" "${free_gb} GB（已用 ${used_pct}%）" "OK" "$disk_path ｜ 阈值 ${MIN_FREE_GB} GB"
else
  add_row "磁盘剩余空间" "${free_gb} GB（已用 ${used_pct}%）" "失败" "$disk_path ｜ 阈值 ${MIN_FREE_GB} GB"
fi

# ── 汇总 ─────────────────────────────────────────────────
printf '\n'
print_table
printf '\n'


TOTAL_CHECKS="${#ROWS_NAME[@]}"
if (( FAILED == 0 )); then
  ziwei_log "健康检查通过（$TOTAL_CHECKS 项全部达标）"
  RC=0
else
  ziwei_err "健康检查未通过：$FAILED 项不达标"
  RC="$ZIWEI_EX_HEALTH"
fi

# JSON 放在最后输出，方便直接 jq 解析（前面的日志走 stderr 之外的 stdout，
# 需要纯 JSON 时用 2>/dev/null 过滤日志行即可）
if (( WANT_JSON == 1 )); then
  jq -n \
    --arg status "$( (( FAILED == 0 )) && echo ok || echo failed )" \
    --argjson failed "$FAILED" \
    --argjson checks "$(for i in "${!ROWS_NAME[@]}"; do
        jq -n --arg n "${ROWS_NAME[$i]}" --arg v "${ROWS_VALUE[$i]}" \
              --arg s "${ROWS_STATUS[$i]}" --arg d "${ROWS_DETAIL[$i]}" \
              '{name: $n, value: $v, status: $s, detail: $d}'
      done | jq -s .)" \
    '{status: $status, failed: $failed, checks: $checks}'
fi

exit "$RC"
