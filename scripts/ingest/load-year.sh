#!/usr/bin/env bash
# 把一个年份的 v4.0 数据集灌进 Postgres
#
#   ./load-year.sh <year> <file.jsonl.zst> [pg_conninfo]
#
# 流程: 解压(流式, 不落盘) -> JSONL -> TSV -> psql COPY 直灌
set -euo pipefail

YEAR="$1"
ZST="$2"
CONN="${3:-${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}}"
WORK="${ZIWEI_WORK_DIR:-/home/ci/dev/ziwei-global/data/work}"

mkdir -p "$WORK"
TMPD="$WORK/y${YEAR}"
mkdir -p "$TMPD"

echo "[$(date +%T)] year=$YEAR src=$(basename "$ZST")"

# 1) 流式解压 + 转 TSV（解压产物不落 56GB 磁盘，只留中间 TSV）
node "$(dirname "$0")/jsonl-to-tsv.mjs" "$ZST" "$TMPD/charts.tsv" "$TMPD/readings.tsv"

# 2) 灌命盘主表
# charts.tsv -> 临时表 -> upsert
psql "$CONN" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE stg_charts (chart_key text, birth_year int, birth_month int, birth_day int, birth_hour int, gender text, mingzhu text);
\copy stg_charts FROM '$TMPD/charts.tsv'
INSERT INTO ziwei_charts (chart_key, birth_year, birth_month, birth_day, birth_hour, gender, mingzhu)
SELECT chart_key, birth_year, birth_month, birth_day, birth_hour, gender, mingzhu FROM stg_charts
ON CONFLICT (chart_key) DO UPDATE SET
  birth_year = EXCLUDED.birth_year, birth_month = EXCLUDED.birth_month,
  birth_day = EXCLUDED.birth_day, birth_hour = EXCLUDED.birth_hour,
  gender = EXCLUDED.gender, mingzhu = EXCLUDED.mingzhu;
SQL

# 3) 灌解读表
psql "$CONN" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE stg_readings (chart_key text, topic text, char_count int, content text);
\copy stg_readings FROM '$TMPD/readings.tsv'
INSERT INTO ziwei_readings (chart_key, topic, char_count, content)
SELECT chart_key, topic, char_count, content FROM stg_readings
ON CONFLICT (chart_key, topic) DO UPDATE SET
  char_count = EXCLUDED.char_count, content = EXCLUDED.content;
SQL

# 4) 审计
CH=$(psql "$CONN" -tA -c "SELECT count(*) FROM ziwei_charts WHERE birth_year=$YEAR")
RD=$(psql "$CONN" -tA -c "SELECT count(*) FROM ziwei_readings r JOIN ziwei_charts c USING (chart_key) WHERE c.birth_year=$YEAR")
SHA=$(sha256sum "$ZST" | cut -d' ' -f1)
psql "$CONN" -v ON_ERROR_STOP=1 -c "
INSERT INTO ziwei_ingest_log (year, charts, readings, source_sha256, source_bytes)
VALUES ($YEAR, $CH, $RD, '$SHA', $(stat -c%s "$ZST"));" >/dev/null

echo "[$(date +%T)] year=$YEAR done charts=$CH readings=$RD"
