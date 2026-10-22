-- 小节表的检索索引
--
--   psql ... -f scripts/ingest/index-sections.sql
--
-- ziwei_sections 约 9146 万行，平均每行 200 字左右。
-- 对 content 建 GIN trgm 索引：这一次行内容够短，索引能真正被用上。
--
-- 预计索引大小：content 总字符数 204 亿 → trgm 三元组约 204 亿个，
-- 预估 20~30 GB。建索引约 20~40 分钟。

\set ON_ERROR_STOP on
\timing on

DROP INDEX IF EXISTS ziwei_sections_content_trgm_idx;

CREATE INDEX CONCURRENTLY ziwei_sections_content_trgm_idx
  ON ziwei_sections USING gin (content gin_trgm_ops);

ANALYZE ziwei_sections;

SELECT pg_size_pretty(pg_total_relation_size('ziwei_sections'))      AS table_size,
       pg_size_pretty(pg_relation_size('ziwei_sections_content_trgm_idx')) AS index_size;
