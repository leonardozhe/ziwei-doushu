-- 小节表的检索索引（部分索引策略）
--
--   psql ... -f scripts/ingest/index-sections.sql
--
-- 为什么是部分索引：
--   ziwei_sections 有 8,268 万行、约 20.4 GB 正文。全量 GIN trgm 索引实测
--   要 3.5 小时以上（blocks 进度 6.4% 时已耗时 40 分钟），性价比不高。
--
--   实测各小节的字节分布（v4.0 全量）：
--     「XX总览」类 14 个小节：各 674,976 行，合计约 2.4 GB
--       —— 内容是面向用户的维度总述（「太阳在卯宫，主XX…」），产品上最该被搜到
--     其余小节：字节量大但多是引文、推导过程，搜索价值低
--
--   所以先给高价值小节建索引，让检索立刻可用；长尾小节按需再补。

\set ON_ERROR_STOP on
\timing on

DROP INDEX IF EXISTS ziwei_sections_content_trgm_idx;

-- 高价值小节：13 维总览 + 身宫 + 命格总览
CREATE INDEX CONCURRENTLY ziwei_sections_content_trgm_idx
  ON ziwei_sections USING gin (content gin_trgm_ops)
  WHERE heading IN (
    '命格总览', '性格总览', '感情总览', '事业总览', '财运总览', '健康总览',
    '兄弟总览', '子女总览', '迁移总览', '人际总览', '田宅总览', '福德总览',
    '父母总览', '身宫 · 后天追求', '一句话定调', '命盘推演', '年干四化·关键宫位影响'
  );

ANALYZE ziwei_sections;

SELECT pg_size_pretty(pg_total_relation_size('ziwei_sections'))            AS table_size,
       pg_size_pretty(pg_relation_size('ziwei_sections_content_trgm_idx'))  AS index_size;
