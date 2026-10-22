#!/usr/bin/env bash
# 紫微斗数解读库 —— 备份脚本
#
#   ./backup-db.sh [选项]
#
# 产出（每次一个独立目录，便于整体拷贝/删除/校验）：
#   <dest>/ziwei-<stamp>-<label>/
#     ├── ziwei.dump        # pg_dump 自定义格式，可用 pg_restore 恢复（首选）
#     ├── schema.sql.gz     # 只有结构（表/索引/扩展/约束）
#     ├── data.sql.gz       # 只有数据（COPY 格式，可 gunzip -c | psql 灌回）
#     ├── manifest.json     # 机器可读清单：时间、库大小、各表行数、sha256
#     ├── manifest.txt      # 人读版清单
#     └── SHA256SUMS        # 各文件 sha256
#
# 选项：
#   --dir <path>          备份输出目录
#   --label <name>        备份名后缀（默认取主机名）
#   --verify              备份后恢复到临时库并比对行数（慢，但能证明备份可用）
#   --no-verify           不做恢复校验（默认行为）
#   --skip-data           不导出 data.sql
#   --skip-schema         不导出 schema.sql
#   --table <pattern>     只备份匹配的表（可重复，支持 glob，如 public.ziwei_*）
#   --exclude-table <p>   排除匹配的表（可重复）
#   --keep-days <n>       保留天数（默认 $ZIWEI_BACKUP_KEEP_DAYS，缺省 14）
#   --no-prune            不清理过期备份
#   --keep-verify-db      校验后保留临时库（调试用）
#   -h, --help            显示帮助
#
# 环境变量：
#   ZIWEI_DATABASE_URL           连接串，默认 postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei
#   ZIWEI_BACKUP_DIR             备份目录，默认 /home/ci/dev/ziwei-global/backups
#   ZIWEI_BACKUP_KEEP_DAYS       保留天数，默认 14
#   ZIWEI_BACKUP_EXCLUDE_TABLES  额外排除的表（空格分隔）
#   ZIWEI_BACKUP_GZIP_LEVEL      data/schema 压缩级别，默认 1
#
# 退出码：0 成功 / 2 参数错误 / 3 缺依赖 / 4 连不上库 / 5 备份失败 / 6 校验失败
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
  sed -n '2,42p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── 参数解析 ─────────────────────────────────────────────
DEST="${ZIWEI_BACKUP_DIR:-/home/ci/dev/ziwei-global/backups}"
LABEL=''
DO_VERIFY=0
DO_DATA=1
DO_SCHEMA=1
DO_PRUNE=1
KEEP_VERIFY_DB=0
KEEP_DAYS="${ZIWEI_BACKUP_KEEP_DAYS:-14}"
TABLES=()
EXCLUDE_TABLES=()
GZIP_LEVEL="${ZIWEI_BACKUP_GZIP_LEVEL:-1}"

while (( $# > 0 )); do
  case "$1" in
    --dir)
      [[ $# -ge 2 ]] || ziwei_die "--dir 需要参数" "$ZIWEI_EX_USAGE"
      DEST="$2"; shift 2 ;;
    --label)
      [[ $# -ge 2 ]] || ziwei_die "--label 需要参数" "$ZIWEI_EX_USAGE"
      LABEL="$2"; shift 2 ;;
    --verify)         DO_VERIFY=1; shift ;;
    --no-verify)      DO_VERIFY=0; shift ;;
    --skip-data)      DO_DATA=0; shift ;;
    --skip-schema)    DO_SCHEMA=0; shift ;;
    --table)
      [[ $# -ge 2 ]] || ziwei_die "--table 需要参数" "$ZIWEI_EX_USAGE"
      TABLES+=("$2"); shift 2 ;;
    --exclude-table)
      [[ $# -ge 2 ]] || ziwei_die "--exclude-table 需要参数" "$ZIWEI_EX_USAGE"
      EXCLUDE_TABLES+=("$2"); shift 2 ;;
    --keep-days)
      [[ $# -ge 2 ]] || ziwei_die "--keep-days 需要参数" "$ZIWEI_EX_USAGE"
      KEEP_DAYS="$2"; shift 2 ;;
    --no-prune)       DO_PRUNE=0; shift ;;
    --keep-verify-db) KEEP_VERIFY_DB=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                usage >&2; ziwei_die "未知参数：$1" "$ZIWEI_EX_USAGE" ;;
  esac
done

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || ziwei_die "--keep-days 必须是整数：$KEEP_DAYS" "$ZIWEI_EX_USAGE"
[[ "$GZIP_LEVEL" =~ ^[1-9]$ ]] || ziwei_die "ZIWEI_BACKUP_GZIP_LEVEL 必须在 1-9 之间" "$ZIWEI_EX_USAGE"

if [[ -n "${ZIWEI_BACKUP_EXCLUDE_TABLES:-}" ]]; then
  # shellcheck disable=SC2206
  EXCLUDE_TABLES+=( ${ZIWEI_BACKUP_EXCLUDE_TABLES} )
fi

ziwei_require_cmd psql pg_dump pg_restore gzip jq date find

CONN="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
ziwei_load_conn "$CONN"
DB="$ZIWEI_PGDATABASE"

STAMP="$(date +%Y%m%d-%H%M%S)"
[[ -n "$LABEL" ]] || LABEL="$(hostname -s 2>/dev/null || echo host)"
LABEL="${LABEL//[^A-Za-z0-9._-]/_}"

BACKUP_DIR="$DEST/ziwei-$STAMP-$LABEL"
mkdir -p "$BACKUP_DIR"
if [[ -n "$(ls -A "$BACKUP_DIR" 2>/dev/null || true)" ]]; then
  ziwei_die "备份目录已存在且非空：$BACKUP_DIR" "$ZIWEI_EX_BACKUP"
fi

# 从备份名解析年龄（天）。支持 ziwei-YYYYmmdd-HHMMSS[-label] 与 ziwei-YYYYmmdd-HHMMSS.dump
# 解析不出来时返回空串，调用方退回用 mtime。
ziwei_backup_age_days() {
  local base="$1" now="$2" stamp epoch
  stamp="${base#ziwei-}"
  stamp="${stamp%%.*}"          # 去掉 .dump 后缀
  [[ "$stamp" =~ ^([0-9]{8})-([0-9]{6}) ]] || return 0
  local d="${BASH_REMATCH[1]}" t="${BASH_REMATCH[2]}"
  epoch="$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null || echo '')"
  [[ -n "$epoch" ]] || return 0
  printf '%s' "$(( ( now - epoch ) / 86400 ))"
}

cleanup_partial() {
  local code=$?
  if (( code != 0 )); then
    ziwei_err "备份失败（退出码 $code），清理未完成目录：$BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
  fi
  exit "$code"
}
trap cleanup_partial EXIT

# ── 阶段 1：采集源库元信息 ───────────────────────────────
ziwei_step "1/6 采集源库信息"
BACKUP_STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ziwei_log "连接目标：$PGUSER@$PGHOST:$PGPORT/$DB"

if ! ziwei_pg_alive "$DB"; then
  ziwei_die "无法连接数据库 $DB（$PGHOST:$PGPORT）" "$ZIWEI_EX_CONNECT"
fi

PG_VERSION="$(ziwei_pg_scalar "$DB" 'SHOW server_version' | tr -d '[:space:]')"
DB_SIZE_BYTES="$(ziwei_pg_scalar "$DB" 'SELECT pg_database_size(current_database())' | tr -d '[:space:]')"
DB_SIZE_HUMAN="$(ziwei_pg_scalar "$DB" 'SELECT pg_size_pretty(pg_database_size(current_database()))' | tr -d '[:space:]')"
ziwei_log "Postgres $PG_VERSION ｜ 库大小 $DB_SIZE_HUMAN（$DB_SIZE_BYTES 字节）"

TABLE_SQL="SELECT table_schema||'.'||table_name FROM information_schema.tables
            WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
            ORDER BY 1"
mapfile -t ALL_TABLES < <(ziwei_pg_scalar "$DB" "$TABLE_SQL")
(( ${#ALL_TABLES[@]} > 0 )) || ziwei_die "源库没有任何表" "$ZIWEI_EX_BACKUP"

# --table 给出白名单（支持 glob，如 public.ziwei_*）；不给则全量，再按 --exclude-table 排除
SELECTED=()
for t in "${ALL_TABLES[@]}"; do
  keep=1
  if (( ${#TABLES[@]} > 0 )); then
    keep=0
    for pat in "${TABLES[@]}"; do
      # shellcheck disable=SC2254
      [[ "$t" == $pat ]] && { keep=1; break; }
    done
  fi
  if (( keep == 1 )); then
    for pat in "${EXCLUDE_TABLES[@]+"${EXCLUDE_TABLES[@]}"}"; do
      # shellcheck disable=SC2254
      [[ "$t" == $pat ]] && { keep=0; break; }
    done
  fi
  (( keep == 1 )) && SELECTED+=("$t")
done
(( ${#SELECTED[@]} > 0 )) || ziwei_die "过滤后没有任何表可备份" "$ZIWEI_EX_USAGE"
ziwei_log "将备份 ${#SELECTED[@]} 张表（共 ${#ALL_TABLES[@]} 张）"

TABLE_ARGS=()
for t in "${SELECTED[@]}"; do
  TABLE_ARGS+=(--table="$t")
done

COUNT_JSON='{}'
for t in "${SELECTED[@]}"; do
  n="$(ziwei_pg_scalar "$DB" "SELECT count(*) FROM $t" | tr -d '[:space:]')"
  COUNT_JSON="$(printf '%s' "$COUNT_JSON" | jq --arg k "$t" --argjson v "${n:-0}" '. + {($k): $v}')"
done
ziwei_log "行数统计完成"

# ── 阶段 2：pg_dump 自定义格式 ───────────────────────────
ziwei_step "2/6 pg_dump 自定义格式"
DUMP_FILE="$BACKUP_DIR/ziwei.dump"
dump_start=$(date +%s)
if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" \
      --format=custom --compress=6 --no-owner --no-privileges \
      --file="$DUMP_FILE" "${TABLE_ARGS[@]}"; then
  ziwei_die "pg_dump 失败" "$ZIWEI_EX_BACKUP"
fi
dump_end=$(date +%s)
DUMP_SIZE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
DUMP_SIZE_HUMAN="$(du -h "$DUMP_FILE" | cut -f1)"
ziwei_log "ziwei.dump：$DUMP_SIZE_HUMAN，用时 $(( dump_end - dump_start ))s"

# ── 阶段 3：结构 / 数据分离导出 ──────────────────────────
ziwei_step "3/6 导出 schema.sql / data.sql"
SCHEMA_FILE="$BACKUP_DIR/schema.sql.gz"
DATA_FILE="$BACKUP_DIR/data.sql.gz"

if (( DO_SCHEMA == 1 )); then
  schema_start=$(date +%s)
  if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" \
        --schema-only --no-owner --no-privileges "${TABLE_ARGS[@]}" \
        | gzip -"${GZIP_LEVEL}" > "$SCHEMA_FILE"; then
    ziwei_die "schema 导出失败" "$ZIWEI_EX_BACKUP"
  fi
  ziwei_log "schema.sql.gz：$(du -h "$SCHEMA_FILE" | cut -f1)，用时 $(( $(date +%s) - schema_start ))s"
else
  ziwei_log "跳过 schema 导出（--skip-schema）"
fi

if (( DO_DATA == 1 )); then
  data_start=$(date +%s)
  if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" \
        --data-only --no-owner --no-privileges --format=plain "${TABLE_ARGS[@]}" \
        | gzip -"${GZIP_LEVEL}" > "$DATA_FILE"; then
    ziwei_die "data 导出失败" "$ZIWEI_EX_BACKUP"
  fi
  ziwei_log "data.sql.gz：$(du -h "$DATA_FILE" | cut -f1)，用时 $(( $(date +%s) - data_start ))s"
else
  ziwei_log "跳过 data 导出（--skip-data）"
fi

# ── 阶段 4：校验和与 manifest ────────────────────────────
ziwei_step "4/6 生成 manifest 与校验和"
(
  cd "$BACKUP_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ziwei.dump *.sql.gz > SHA256SUMS 2>/dev/null || true
  else
    shasum -a 256 ziwei.dump *.sql.gz > SHA256SUMS 2>/dev/null || true
  fi
)
[[ -s "$BACKUP_DIR/SHA256SUMS" ]] || ziwei_die "生成 SHA256SUMS 失败" "$ZIWEI_EX_BACKUP"

SHA_PAIRS=''
for f in ziwei.dump schema.sql.gz data.sql.gz; do
  [[ -f "$BACKUP_DIR/$f" ]] || continue
  SHA_PAIRS="${SHA_PAIRS}$(ziwei_sha256 "$BACKUP_DIR/$f")  $f"$'\n'
done
SHA_MAP="$(printf '%s' "$SHA_PAIRS" | jq -R -s 'split("\n") | map(select(length>0) | split("  ")) | map({key: .[1], value: .[0]}) | from_entries')"

BACKUP_STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
YEARS_JSON="$(ziwei_pg_scalar "$DB" "SELECT json_build_object('from', min(birth_year), 'to', max(birth_year), 'count', count(DISTINCT birth_year)) FROM ziwei_charts" 2>/dev/null || echo '{}')"
[[ -n "$YEARS_JSON" ]] || YEARS_JSON='{}'

jq -n \
  --arg started_at "$BACKUP_STARTED_AT" \
  --arg finished_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg host "$(hostname -s 2>/dev/null || echo host)" \
  --arg label "$LABEL" \
  --arg pg_version "$PG_VERSION" \
  --arg db "$DB" \
  --arg conn "$CONN" \
  --arg db_size_human "$DB_SIZE_HUMAN" \
  --argjson db_size_bytes "${DB_SIZE_BYTES:-0}" \
  --arg dump_size_human "$DUMP_SIZE_HUMAN" \
  --argjson dump_size_bytes "${DUMP_SIZE_BYTES:-0}" \
  --argjson dump_seconds "$(( dump_end - dump_start ))" \
  --argjson row_counts "$COUNT_JSON" \
  --argjson years "$YEARS_JSON" \
  --argjson sha256 "$SHA_MAP" \
  --argjson tables "$(printf '%s\n' "${SELECTED[@]}" | jq -R . | jq -s .)" \
  --argjson has_schema "$( (( DO_SCHEMA == 1 )) && echo true || echo false )" \
  --argjson has_data "$( (( DO_DATA == 1 )) && echo true || echo false )" \
  '{
     schema_version: 1,
     backup: {started_at: $started_at, finished_at: $finished_at, host: $host, label: $label},
     source: {database: $db, pg_version: $pg_version, connection: $conn,
              size_bytes: $db_size_bytes, size_human: $db_size_human},
     artifacts: {
        dump:   {file: "ziwei.dump", format: "pg_dump-custom", size_bytes: $dump_size_bytes,
                 size_human: $dump_size_human, seconds: $dump_seconds},
        schema: (if $has_schema then {file: "schema.sql.gz", format: "sql-gzip"} else null end),
        data:   (if $has_data   then {file: "data.sql.gz",   format: "sql-gzip"} else null end)
     },
     tables: $tables,
     row_counts: $row_counts,
     year_range: $years,
     sha256: $sha256
   }' > "$BACKUP_DIR/manifest.json"

{
  echo "紫微斗数解读库备份清单"
  echo "========================"
  echo "备份目录    : $BACKUP_DIR"
  echo "开始时间    : $BACKUP_STARTED_AT"
  echo "结束时间    : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "源数据库    : $DB  ($PGHOST:$PGPORT, Postgres $PG_VERSION)"
  echo "源库大小    : $DB_SIZE_HUMAN"
  echo "备份主机    : $(hostname -s 2>/dev/null || echo host)"
  echo
  echo "文件："
  [[ -f "$DUMP_FILE"  ]] && printf '  %-16s %10s  %s\n' "ziwei.dump"    "$DUMP_SIZE_HUMAN" "pg_dump 自定义格式"
  [[ -f "$SCHEMA_FILE" ]] && printf '  %-16s %10s  %s\n' "schema.sql.gz" "$(du -h "$SCHEMA_FILE" | cut -f1)" "仅结构"
  [[ -f "$DATA_FILE"   ]] && printf '  %-16s %10s  %s\n' "data.sql.gz"   "$(du -h "$DATA_FILE" | cut -f1)" "仅数据"
  echo
  echo "各表行数："
  jq -r '.row_counts | to_entries[] | [.key, (.value|tostring)] | @tsv' "$BACKUP_DIR/manifest.json" \
    | while IFS=$'\t' read -r key val; do
        printf '  %-28s %s\n' "$key" "$val"
      done
  echo
  echo "年份覆盖：$(jq -c '.year_range' "$BACKUP_DIR/manifest.json")"
  echo "sha256："
  jq -r '.sha256 | to_entries[] | "  " + .value + "  " + .key' "$BACKUP_DIR/manifest.json"
} > "$BACKUP_DIR/manifest.txt"

ziwei_log "manifest 已生成"

# ── 阶段 5：可选的恢复校验 ───────────────────────────────
VERIFY_RESULT='skipped'
if (( DO_VERIFY == 1 )); then
  ziwei_step "5/6 恢复校验（restore 到临时库并比对行数）"
  VERIFY_DB="ziwei_verify_${STAMP}_$$"
  restore_start=$(date +%s)

  ziwei_log "创建临时库 $VERIFY_DB"
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" \
        -c "CREATE DATABASE \"$VERIFY_DB\";"; then
    ziwei_die "创建临时校验库失败" "$ZIWEI_EX_VERIFY"
  fi

  cleanup_verify_db() {
    if (( KEEP_VERIFY_DB == 1 )); then
      ziwei_warn "按 --keep-verify-db 保留临时库 $VERIFY_DB"
    else
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" >/dev/null 2>&1 || true
    fi
  }

  if ! pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$VERIFY_DB" \
        --no-owner --no-privileges --exit-on-error "$DUMP_FILE"; then
    cleanup_verify_db
    ziwei_die "pg_restore 到临时库失败 —— 备份不可用" "$ZIWEI_EX_VERIFY"
  fi

  mismatch=0
  for t in "${SELECTED[@]}"; do
    expected="$(ziwei_pg_scalar "$DB" "SELECT count(*) FROM $t" | tr -d '[:space:]')"
    actual="$(ziwei_pg_scalar "$VERIFY_DB" "SELECT count(*) FROM $t" | tr -d '[:space:]')"
    if [[ "$expected" == "$actual" ]]; then
      printf '  %s  %-28s = %s\n' "OK  " "$t" "$actual"
    else
      printf '  %s  %-28s 期望 %s 实得 %s\n' "BAD " "$t" "$expected" "$actual"
      mismatch=$(( mismatch + 1 ))
    fi
  done
  cleanup_verify_db

  if (( mismatch > 0 )); then
    ziwei_die "恢复校验失败：$mismatch 张表行数不一致" "$ZIWEI_EX_VERIFY"
  fi
  VERIFY_RESULT="passed"
  ziwei_log "恢复校验通过，用时 $(( $(date +%s) - restore_start ))s"
else
  ziwei_step "5/6 恢复校验（已跳过，加 --verify 可开启）"
fi

# ── 阶段 6：保留策略 ─────────────────────────────────────
ziwei_step "6/6 保留策略（保留 $KEEP_DAYS 天）"
pruned=0
if (( DO_PRUNE == 1 )); then
  NOW_EPOCH="$(date +%s)"
  KEEP_SECONDS=$(( KEEP_DAYS * 86400 ))
  while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    [[ "$old" == "$BACKUP_DIR" ]] && continue
    base="$(basename -- "$old")"
    # 备份名里带时间戳：ziwei-YYYYmmdd-HHMMSS-label
    age_days="$(ziwei_backup_age_days "$base" "$NOW_EPOCH")"
    # 名字里没有可解析时间戳的老目录，退回用 mtime 判断
    if [[ -z "$age_days" ]]; then
      mtime="$(stat -c %Y "$old" 2>/dev/null || stat -f %m "$old" 2>/dev/null || echo "$NOW_EPOCH")"
      age_days=$(( ( NOW_EPOCH - mtime ) / 86400 ))
    fi
    if (( age_days > KEEP_DAYS )); then
      ziwei_warn "删除过期备份（$age_days 天 > $KEEP_DAYS 天）：$old"
      rm -rf "$old"
      pruned=$(( pruned + 1 ))
    fi
  done < <(find "$DEST" -mindepth 1 -maxdepth 1 -type d -name 'ziwei-*' -print)

  # 旧版单文件格式的备份（ziwei-YYYYmmdd-HHMMSS.dump）
  while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    base="$(basename -- "$old")"
    age_days="$(ziwei_backup_age_days "$base" "$NOW_EPOCH")"
    [[ -n "$age_days" ]] || age_days=0
    if (( age_days > KEEP_DAYS )); then
      ziwei_warn "删除过期备份（$age_days 天 > $KEEP_DAYS 天）：$old"
      rm -f "$old"
      pruned=$(( pruned + 1 ))
    fi
  done < <(find "$DEST" -mindepth 1 -maxdepth 1 -type f -name 'ziwei-*.dump' -print)

  ziwei_log "清理了 $pruned 个过期备份"
else
  ziwei_log "按 --no-prune 跳过清理"
fi

# ── 收尾 ─────────────────────────────────────────────────
jq --arg verify "$VERIFY_RESULT" --argjson pruned "$pruned" \
   '.verification = $verify | .pruned = $pruned' \
   "$BACKUP_DIR/manifest.json" > "$BACKUP_DIR/manifest.json.tmp" \
  && mv "$BACKUP_DIR/manifest.json.tmp" "$BACKUP_DIR/manifest.json"

trap - EXIT
ziwei_log "备份完成：$BACKUP_DIR"
ziwei_log "总大小：$(du -sh "$BACKUP_DIR" | cut -f1)  ｜ 校验：$VERIFY_RESULT"
exit 0
