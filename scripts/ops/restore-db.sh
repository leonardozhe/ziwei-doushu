#!/usr/bin/env bash
# 紫微斗数解读库 —— 恢复脚本
#
#   ./restore-db.sh --from <备份文件或目录> [选项]
#
# --from 接受三种形式：
#   1) 备份目录      —— /path/to/ziwei-20261022-120000-ci199
#   2) ziwei.dump    —— 单个 pg_dump 自定义格式文件
#   3) schema.sql.gz / data.sql.gz —— 分离的结构/数据文件（可两个一起给）
#
# 选项：
#   --from <path>     备份来源（必填）
#   --to <db>         目标数据库名（默认与源同名的 $PGDATABASE）
#   --target-url <u>  目标连接串（覆盖 ZIWEI_DATABASE_URL）
#   --verify-only     只校验备份文件完整性，不恢复
#   --yes             跳过交互确认
#   --data-only       只灌数据（跳过 schema）
#   --schema-only     只灌结构
#   --prefer-sql      强制走 SQL 路径（schema.sql + data.sql），默认有 ziwei.dump 时优先用 pg_restore
#   --jobs <n>        pg_restore 并行度（默认 2）
#   --no-drop         不 DROP 目标库（要求目标库为空）
#   -h, --help        显示帮助
#
# 环境变量：
#   ZIWEI_DATABASE_URL     源/目标连接串
#   PGPASSWORD              目标库密码（若连接串里没带）
#
# 退出码：0 成功 / 2 参数错误 / 3 缺依赖 / 4 连不上库 / 6 校验失败 / 7 恢复失败
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

FROM=''
TARGET_DB=''
TARGET_URL="${ZIWEI_DATABASE_URL:-}"
VERIFY_ONLY=0
ASSUME_YES=0
DATA_ONLY=0
SCHEMA_ONLY=0
PREFER_SQL=0
JOBS=2
DO_DROP=1

while (( $# > 0 )); do
  case "$1" in
    --from)
      [[ $# -ge 2 ]] || ziwei_die "--from 需要参数" "$ZIWEI_EX_USAGE"
      FROM="$2"; shift 2 ;;
    --to)
      [[ $# -ge 2 ]] || ziwei_die "--to 需要参数" "$ZIWEI_EX_USAGE"
      TARGET_DB="$2"; shift 2 ;;
    --target-url)
      [[ $# -ge 2 ]] || ziwei_die "--target-url 需要参数" "$ZIWEI_EX_USAGE"
      TARGET_URL="$2"; shift 2 ;;
    --verify-only)  VERIFY_ONLY=1; shift ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --data-only)    DATA_ONLY=1; SCHEMA_ONLY=0; shift ;;
    --schema-only)  SCHEMA_ONLY=1; DATA_ONLY=0; shift ;;
    --prefer-sql)   PREFER_SQL=1; shift ;;
    --jobs)
      [[ $# -ge 2 ]] || ziwei_die "--jobs 需要参数" "$ZIWEI_EX_USAGE"
      JOBS="$2"; shift 2 ;;
    --no-drop)      DO_DROP=0; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage >&2; ziwei_die "未知参数：$1" "$ZIWEI_EX_USAGE" ;;
  esac
done

[[ -n "$FROM" ]] || { usage >&2; ziwei_die "必须指定 --from <备份文件或目录>" "$ZIWEI_EX_USAGE"; }
[[ -e "$FROM" ]] || ziwei_die "备份路径不存在：$FROM" "$ZIWEI_EX_USAGE"
[[ "$JOBS" =~ ^[0-9]+$ ]] || ziwei_die "--jobs 必须是整数" "$ZIWEI_EX_USAGE"

ziwei_require_cmd psql pg_restore gunzip gzip sha256sum

# ── 定位备份内容 ─────────────────────────────────────────
DUMP_FILE=''
SCHEMA_FILE=''
DATA_FILE=''
MANIFEST=''

if [[ -d "$FROM" ]]; then
  [[ -f "$FROM/ziwei.dump" ]] && DUMP_FILE="$FROM/ziwei.dump"
  [[ -f "$FROM/schema.sql.gz" ]] && SCHEMA_FILE="$FROM/schema.sql.gz"
  [[ -f "$FROM/data.sql.gz" ]] && DATA_FILE="$FROM/data.sql.gz"
  [[ -f "$FROM/manifest.json" ]] && MANIFEST="$FROM/manifest.json"
  if [[ -z "$DUMP_FILE" && -z "$SCHEMA_FILE" && -z "$DATA_FILE" ]]; then
    ziwei_die "目录里没有可恢复的备份文件（期望 ziwei.dump / schema.sql.gz / data.sql.gz）：$FROM" "$ZIWEI_EX_USAGE"
  fi
else
  case "$FROM" in
    *.dump)   DUMP_FILE="$FROM" ;;
    *.sql.gz) SCHEMA_FILE="$FROM" ;;
    *.sql)    SCHEMA_FILE="$FROM" ;;
    *)        ziwei_die "无法识别的备份文件类型：$FROM" "$ZIWEI_EX_USAGE" ;;
  esac
  # 同一目录下若还有 data.sql.gz，一并纳入
  dir="$(dirname -- "$FROM")"
  base="$(basename -- "$FROM")"
  if [[ "$base" == "schema.sql.gz" || "$base" == "schema.sql" ]]; then
    [[ -f "$dir/data.sql.gz" ]] && DATA_FILE="$dir/data.sql.gz"
  fi
fi

# ── 阶段 1：校验来源完整性 ───────────────────────────────
ziwei_step "1/4 校验备份来源"
ziwei_log "来源：$FROM"

if [[ -n "$MANIFEST" ]] && command -v jq >/dev/null 2>&1; then
  if jq -e . "$MANIFEST" >/dev/null 2>&1; then
    ziwei_log "manifest.json 解析正常"
    ziwei_log "  备份时间：$(jq -r '.backup.started_at // "?"' "$MANIFEST")"
    ziwei_log "  源库大小：$(jq -r '.source.size_human // "?"' "$MANIFEST")"
    ziwei_log "  行数统计：$(jq -r '.row_counts | to_entries | map(.key + "=" + (.value|tostring)) | join(", ")' "$MANIFEST")"
  else
    ziwei_warn "manifest.json 不是合法 JSON，跳过清单校验"
  fi
else
  ziwei_warn "没有 manifest.json，无法做清单级校验"
fi

if [[ -n "$DUMP_FILE" && -f "$DUMP_FILE" ]]; then
  if pg_restore -l "$DUMP_FILE" >/dev/null 2>&1; then
    ziwei_log "ziwei.dump 目录可读（pg_restore -l 通过）"
  else
    ziwei_die "ziwei.dump 损坏或格式不对（pg_restore -l 失败）" "$ZIWEI_EX_VERIFY"
  fi
fi

for f in "$SCHEMA_FILE" "$DATA_FILE"; do
  [[ -n "$f" && -f "$f" ]] || continue
  if gzip -t "$f" 2>/dev/null; then
    ziwei_log "$(basename -- "$f") gzip 完整性 OK"
  else
    ziwei_die "$(basename -- "$f") gzip 校验失败" "$ZIWEI_EX_VERIFY"
  fi
done

if (( VERIFY_ONLY == 1 )); then
  ziwei_step "2/4 仅校验模式"
  ziwei_log "校验通过，未做任何恢复操作"
  exit 0
fi

# ── 阶段 2：确定目标库 ───────────────────────────────────
ziwei_step "2/4 确定目标数据库"
[[ -n "$TARGET_URL" ]] || TARGET_URL="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
ziwei_load_conn "$TARGET_URL"
[[ -n "$TARGET_DB" ]] || TARGET_DB="$ZIWEI_PGDATABASE"
ziwei_log "目标：$PGUSER@$PGHOST:$PGPORT/$TARGET_DB"

if ! ziwei_pg_alive postgres; then
  ziwei_die "连不上 Postgres（$PGHOST:$PGPORT）" "$ZIWEI_EX_CONNECT"
fi

# ── 阶段 3：确认 ─────────────────────────────────────────
ziwei_step "3/4 恢复前检查"
db_exists=0
if ziwei_pg_db_exists "$TARGET_DB"; then
  db_exists=1
  existing_size="$(ziwei_pg_scalar "$TARGET_DB" 'SELECT pg_size_pretty(pg_database_size(current_database()))' | tr -d '[:space:]')"
  ziwei_warn "目标库 $TARGET_DB 已存在（当前大小 $existing_size）"
  if (( DO_DROP == 0 )); then
    ziwei_warn "按 --no-drop 处理：目标库必须为空"
  fi
else
  ziwei_log "目标库 $TARGET_DB 不存在，将新建"
fi

action_desc=''
if [[ -n "$DUMP_FILE" ]] && (( PREFER_SQL == 0 )); then
  action_desc="pg_restore(ziwei.dump)"
elif [[ -n "$SCHEMA_FILE" || -n "$DATA_FILE" ]]; then
  [[ -n "$SCHEMA_FILE" ]] && action_desc="schema "
  [[ -n "$DATA_FILE"   ]] && action_desc="${action_desc}data "
fi
ziwei_log "将执行：$action_desc"

if (( ASSUME_YES == 0 )); then
  printf '\n确认恢复到 %s ？这会覆盖目标库现有数据。[y/N] ' "$TARGET_DB"
  read -r reply || reply=''
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    ziwei_log "用户取消，未做任何改动"
    exit 0
  fi
fi

# ── 阶段 4：执行恢复 ─────────────────────────────────────
ziwei_step "4/4 执行恢复"
restore_start=$(date +%s)

# 断开其它连接，避免 DROP DATABASE 被占用挡住
if (( db_exists == 1 && DO_DROP == 1 )); then
  ziwei_log "终止目标库上的其它连接"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  ziwei_log "DROP DATABASE $TARGET_DB"
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";"; then
    ziwei_die "DROP DATABASE 失败" "$ZIWEI_EX_RESTORE"
  fi
fi

if ! ziwei_pg_db_exists "$TARGET_DB"; then
  ziwei_log "CREATE DATABASE $TARGET_DB"
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
        -c "CREATE DATABASE \"$TARGET_DB\";"; then
    ziwei_die "CREATE DATABASE 失败" "$ZIWEI_EX_RESTORE"
  fi
fi

# pg_dump --table=... 不带 CREATE EXTENSION，但会带依赖扩展的索引；
# 这里先把扩展建好，否则恢复时索引会失败。
ziwei_ensure_extensions "$TARGET_DB" || ziwei_die "扩展准备失败，无法恢复" "$ZIWEI_EX_RESTORE"

# 恢复模式：
#   dump —— 有 ziwei.dump 时默认走这条（dump 自带结构+数据）
#   sql  —— 没有 dump，或显式 --prefer-sql 时走 schema.sql + data.sql
# 两者不能同时跑：dump 已经建好表，再灌 schema.sql 会撞 "relation already exists"。
USE_DUMP=0
USE_SQL=0
if [[ -n "$DUMP_FILE" ]] && (( PREFER_SQL == 0 )); then
  USE_DUMP=1
elif [[ -n "$SCHEMA_FILE" || -n "$DATA_FILE" ]]; then
  USE_SQL=1
fi

if (( USE_DUMP == 1 )); then
  ziwei_log "pg_restore ziwei.dump → $TARGET_DB（jobs=$JOBS）"
  if ! pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
        --no-owner --no-privileges --exit-on-error --jobs="$JOBS" "$DUMP_FILE"; then
    ziwei_die "pg_restore 失败" "$ZIWEI_EX_RESTORE"
  fi
fi

if (( USE_SQL == 1 )); then
  if (( SCHEMA_ONLY == 0 )) && [[ -n "$SCHEMA_FILE" ]]; then
    ziwei_log "灌入 schema：$(basename -- "$SCHEMA_FILE") → $TARGET_DB"
    if ! gunzip -c "$SCHEMA_FILE" 2>/dev/null | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
          -v ON_ERROR_STOP=1 --quiet; then
      ziwei_die "schema 恢复失败" "$ZIWEI_EX_RESTORE"
    fi
  fi

  if (( DATA_ONLY == 0 )) && [[ -n "$DATA_FILE" ]]; then
    ziwei_log "灌入 data：$(basename -- "$DATA_FILE") → $TARGET_DB"
    if ! gunzip -c "$DATA_FILE" 2>/dev/null | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
          -v ON_ERROR_STOP=1 --quiet; then
      ziwei_die "data 恢复失败" "$ZIWEI_EX_RESTORE"
    fi
  fi
fi

restore_end=$(date +%s)
ziwei_log "恢复完成，用时 $(( restore_end - restore_start ))s"

# ── 结果核对 ─────────────────────────────────────────────
ziwei_step "恢复后行数核对"
if [[ -n "$MANIFEST" ]] && command -v jq >/dev/null 2>&1 && jq -e '.row_counts' "$MANIFEST" >/dev/null 2>&1; then
  mismatch=0
  while IFS=$'\t' read -r tbl expected; do
    [[ -n "$tbl" ]] || continue
    if [[ "$tbl" == *.* ]]; then
      schema_part="${tbl%%.*}"; table_part="${tbl#*.}"
      actual="$(ziwei_pg_scalar "$TARGET_DB" "SELECT count(*) FROM \"$schema_part\".\"$table_part\"" 2>/dev/null | tr -d '[:space:]')"
    else
      actual="$(ziwei_pg_scalar "$TARGET_DB" "SELECT count(*) FROM \"$tbl\"" 2>/dev/null | tr -d '[:space:]')"
    fi
    if [[ "$actual" == "$expected" ]]; then
      printf '  %s  %-28s = %s\n' "OK  " "$tbl" "$actual"
    else
      printf '  %s  %-28s 期望 %s 实得 %s\n' "BAD " "$tbl" "$expected" "${actual:-N/A}"
      mismatch=$(( mismatch + 1 ))
    fi
  done < <(jq -r '.row_counts | to_entries[] | [.key, (.value|tostring)] | @tsv' "$MANIFEST")
  if (( mismatch > 0 )); then
    ziwei_die "恢复后行数核对失败：$mismatch 张表不一致" "$ZIWEI_EX_VERIFY"
  fi
  ziwei_log "全部表行数与 manifest 一致"
else
  ziwei_warn "没有 manifest.json，跳过行数核对"
fi

ziwei_log "恢复后的库大小：$(ziwei_pg_scalar "$TARGET_DB" 'SELECT pg_size_pretty(pg_database_size(current_database()))' | tr -d '[:space:]')"
exit 0
