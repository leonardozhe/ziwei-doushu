-- 构建术语倒排索引
--
--   psql ... -f scripts/ingest/build-terms.sql
--
-- 做法：
--   1) 灌术语表（terms.csv 由 scripts/ingest/export-terms.ts 从 lib/ziwei/terms.ts 生成）
--   2) 对每个小节，用一次 regexp_matches 抽出它命中的所有术语，
--      落成「小节 × 术语」行，再聚合到「命盘 × 术语」。
--
--   为什么不用「每个术语去 LIKE 一遍」：那是 8268 万行 × N 术语的笛卡尔积，跑不完。
--   一次扫描 + 正则抽取是线性的。
--
--   扫描范围：只扫「总览类」小节（各维度总述）——
--     数据量可控，且内容是面向用户的维度总述，产品上最该被搜到。

\set ON_ERROR_STOP on
\timing on

-- 1) 术语表
TRUNCATE ziwei_terms CASCADE;
\copy ziwei_terms (term, term_type) FROM 'terms.csv' WITH (FORMAT csv, HEADER true)

-- 2) 建一个「术语 → 正则」的可搜索对象。
--    用 array 存术语，regexp_matches 的结果直接与 array 做交集，
--    避免 8268 万行 × N 术语的笛卡尔积。
CREATE TEMP TABLE term_arr AS
SELECT array_agg(term ORDER BY term) AS terms,
       array_agg(id ORDER BY term)    AS ids
  FROM ziwei_terms;

-- 3) 倒排：一次扫描小节表，抽出每行命中的术语
TRUNCATE ziwei_term_charts;

INSERT INTO ziwei_term_charts (term_id, chart_key, hits)
SELECT
  ta.ids[array_position(matched.terms, m.term)],
  s.chart_key,
  count(*)::int
FROM (
  SELECT s.chart_key, s.content
    FROM ziwei_sections s
   WHERE s.heading LIKE '%总览'
) s
CROSS JOIN term_arr ta
CROSS JOIN LATERAL (
  -- 抽出该行里出现的、属于术语表的词
  SELECT DISTINCT (x.w)[1] AS term
    FROM regexp_matches(s.content, '(太阳|天机|紫微|命宫|化禄|...)', 'g') AS x(w)
   WHERE (x.w)[1] = ANY (ta.terms)
) m
GROUP BY 1, 2;

SELECT count(*) AS pairs FROM ziwei_term_charts;
