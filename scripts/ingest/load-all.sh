#!/usr/bin/env bash
# 批量装载 v4.0 数据集全部年份
#
#   ./load-all.sh [年份 ...]        # 不带参数 = 全部
#
# 优化点：
#   1. 批量阶段先 DROP trgm 索引，插完再建（单年建索引要 4 分钟，拖累 77 倍）
#   2. 每个年份独立 psql 会话，失败不阻断后续年份
#   3. 中间 TSV 用完即删，磁盘峰值只留单年
set -uo pipefail

CONN="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
RAW="${ZIWEI_RAW_DIR:-/home/ci/dev/ziwei-global/data/raw}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="${ZIWEI_LOG_DIR:-/home/ci/dev/ziwei-global/logs}/ingest-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$(dirname "$LOG")" "$RAW"

if [ $# -gt 0 ]; then
  YEARS=("$@")
else
  YEARS=()
  for y in $(seq 1950 2026); do YEARS+=("$y"); done
fi

echo "[$(date +%T)] 开始批量装载 ${#YEARS[@]} 年，日志: $LOG" | tee -a "$LOG"

# 批量阶段：摘掉昂贵的 trgm 索引
psql "$CONN" -c "DROP INDEX IF EXISTS ziwei_readings_content_trgm_idx;" 2>&1 | tee -a "$LOG"

FAILED=()
for y in "${YEARS[@]}"; do
  f="$RAW/year-$y.jsonl.zst"
  if [ ! -f "$f" ]; then
    echo "[$(date +%T)] year=$y 缺少文件，跳过" | tee -a "$LOG"
    FAILED+=("$y:missing")
    continue
  fi
  if ! bash "$HERE/load-year.sh" "$y" "$f" "$CONN" 2>&1 | tee -a "$LOG"; then
    FAILED+=("$y:error")
  fi
done

# 重建 trgm 索引
echo "[$(date +%T)] 重建 trgm 索引..." | tee -a "$LOG"
psql "$CONN" -c "
CREATE INDEX CONCURRENTLY IF NOT EXISTS ziwei_readings_content_trgm_idx
  ON ziwei_readings USING gin (content gin_trgm_ops);" 2>&1 | tee -a "$LOG"
psql "$CONN" -c "VACUUM ANALYZE ziwei_charts; VACUUM ANALYZE ziwei_readings;" 2>&1 | tee -a "$LOG"

echo "[$(date +%T)] 完成。失败: ${FAILED[*]:-无}" | tee -a "$LOG"
exit 0
