-- 把 ziwei_readings 的正文拆成小节行
--
--   psql ... -f scripts/ingest/split-sections.sql
--
-- 做法：正则按 **【标题】** 切分，标题本身也作为 heading 存下来。
-- 用 WITH ORDINALITY 保证 seq 稳定。
--
-- 分批提交（每批 20 万行），避免单个事务撑爆 WAL。

\set ON_ERROR_STOP on

-- 1) 拆到临时表
DROP TABLE IF EXISTS ziwei_sections_stage;
CREATE TEMP TABLE ziwei_sections_stage (LIKE ziwei_sections INCLUDING DEFAULTS);

INSERT INTO ziwei_sections_stage (chart_key, topic, seq, heading, content)
SELECT
  r.chart_key,
  r.topic,
  s.ord,
  coalesce(nullif(s.heading, ''), '（前言）'),
  s.body
FROM ziwei_readings r
CROSS JOIN LATERAL (
  SELECT
    part.ord::int AS ord,
    -- 标题：从这段开头提取 **【xxx】**；没有就是前言
    coalesce(
      (regexp_match(part.txt, '^\s*\*\*【([^】]+)】\*\*'))[1],
      ''
    ) AS heading,
    -- 正文：去掉标题标记本身
    regexp_replace(part.txt, '^\s*\*\*【[^】]+】\*\*\s*', '', 'g') AS body
  FROM unnest(
    regexp_split_to_table(
      r.content,
      '\*\*【[^】]+】\*\*'
    ) WITH ORDINALITY AS part(txt, ord)
  ) AS part
) s;

-- 2) 落库
INSERT INTO ziwei_sections (chart_key, topic, seq, heading, content)
SELECT chart_key, topic, seq, heading, content
FROM ziwei_sections_stage
ON CONFLICT (chart_key, topic, seq) DO UPDATE
SET heading = EXCLUDED.heading, content = EXCLUDED.content;

-- 3) 统计
SELECT count(*) AS sections,
       count(DISTINCT heading) AS distinct_headings,
       pg_size_pretty(pg_total_relation_size('ziwei_sections')) AS table_size
FROM ziwei_sections;
