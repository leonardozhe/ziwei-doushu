#!/usr/bin/env bash
# 对比不同中文检索索引方案在解读数据集上的构建成本
#
#   ./benchmark-index.sh [样本条数]
#
# 目的：为「877 万段解读 / 204 亿字符」选一个建索引成本可接受的方案。
# 背景：GIN + pg_trgm 对长中文正文建索引极贵（单年 82s → 全量 ~105min），
#      需要和 tsvector 方案做对比。
set -euo pipefail

CONN="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
N="${1:-113880}"

echo "=== 样本量: $N 条 ==="
psql "$CONN" -v ON_ERROR_STOP=1 <<SQL
DROP TABLE IF EXISTS probe_trgm; DROP TABLE IF EXISTS probe_tsv;
CREATE TABLE probe_trgm (content text);
INSERT INTO probe_trgm SELECT content FROM ziwei_readings LIMIT $N;
\timing on
CREATE INDEX probe_trgm_idx ON probe_trgm USING gin (content gin_trgm_ops);
\timing off
SQL

echo "=== 方案 B: tsvector (simple 配置, 无分词词典) ==="
psql "$CONN" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE probe_tsv (content text, tsv tsvector);
INSERT INTO probe_tsv SELECT content, to_tsvector('simple', content) FROM ziwei_readings LIMIT $N;
\timing on
CREATE INDEX probe_tsv_idx ON probe_tsv USING gin (tsv);
\timing off
SQL

psql "$CONN" -c "
SELECT 'trgm' AS method, pg_size_pretty(pg_total_relation_size('probe_trgm_idx')) AS index_size
UNION ALL
SELECT 'tsvector', pg_size_pretty(pg_total_relation_size('probe_tsv_idx'));"

psql "$CONN" -c "DROP TABLE probe_trgm; DROP TABLE probe_tsv;"
