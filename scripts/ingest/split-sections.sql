-- 把 ziwei_readings 的正文拆成小节行
--
--   psql ... -f scripts/ingest/split-sections.sql
--
-- 做法：用**前瞻分割**在每个 **【标题】** 之前切开（标题保留在片段开头），
--   再从片段开头提取标题、剥掉标题标记作为正文。
-- 切分实测：877 万段解读 → 91,460,638 个小节（约 10.4 个/段）。
--
-- 分批提交，避免单个事务撑爆 WAL。

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS ziwei_sections (
  id         bigserial PRIMARY KEY,
  chart_key  text NOT NULL REFERENCES ziwei_charts(chart_key) ON DELETE CASCADE,
  topic      text NOT NULL,
  seq        int  NOT NULL,
  heading    text NOT NULL,
  content    text NOT NULL,
  UNIQUE (chart_key, topic, seq)
);

CREATE INDEX IF NOT EXISTS ziwei_sections_topic_idx   ON ziwei_sections (topic);
CREATE INDEX IF NOT EXISTS ziwei_sections_heading_idx ON ziwei_sections (heading);
CREATE INDEX IF NOT EXISTS ziwei_sections_chart_idx  ON ziwei_sections (chart_key);

-- ── 分批：每年一批 ───────────────────────────────────────
DO $$
DECLARE
  y int;
  t0 timestamptz := clock_timestamp();
BEGIN
  FOR y IN SELECT DISTINCT birth_year FROM ziwei_charts ORDER BY birth_year LOOP
    EXECUTE format($q$
      INSERT INTO ziwei_sections (chart_key, topic, seq, heading, content)
      SELECT
        r.chart_key, r.topic, s.ord,
        coalesce(nullif(s.heading, ''), '（前言）'),
        s.body
      FROM ziwei_readings r
      JOIN ziwei_charts c USING (chart_key)
      CROSS JOIN LATERAL (
        SELECT
          (row_number() OVER (ORDER BY part.ord))::int AS ord,
          coalesce((regexp_match(part.txt, '^\s*[*][*]【([^】]+)】[*][*]'))[1], '') AS heading,
          regexp_replace(part.txt, '^\s*[*][*]【[^】]+】[*][*]\s*', '', 'g') AS body
        FROM (
          SELECT p.txt, p.ord
            FROM regexp_split_to_table(r.content, '(?=[*][*]【)')
                 WITH ORDINALITY AS p(txt, ord)
        ) AS part
      ) s
      WHERE c.birth_year = %s
      ON CONFLICT (chart_key, topic, seq) DO UPDATE
        SET heading = EXCLUDED.heading, content = EXCLUDED.content;
    $q$, y);

    RAISE NOTICE 'year % done, elapsed %', y, clock_timestamp() - t0;
  END LOOP;
END $$;

SELECT count(*) AS sections,
       count(DISTINCT heading) AS distinct_headings,
       pg_size_pretty(pg_total_relation_size('ziwei_sections')) AS table_size
FROM ziwei_sections;
