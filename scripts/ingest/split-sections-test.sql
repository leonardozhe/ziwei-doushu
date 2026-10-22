-- 在 1 年数据上验证小节拆分
\set ON_ERROR_STOP on
\timing on

CREATE TEMP TABLE stg (chart_key text, topic text, seq int, heading text, content text);

INSERT INTO stg
SELECT
  r.chart_key, r.topic, s.ord,
  coalesce(nullif(s.heading, ''), '（前言）'),
  s.body
FROM ziwei_readings r
JOIN ziwei_charts c USING (chart_key)
CROSS JOIN LATERAL (
  SELECT part.ord::int AS ord,
         coalesce((regexp_match(part.txt, '^\s*\*\*【([^】]+)】\*\*'))[1], '') AS heading,
         regexp_replace(part.txt, '^\s*\*\*【[^】]+】\*\*\s*', '', 'g') AS body
    FROM unnest(regexp_split_to_table(r.content, '\*\*【[^】]+】\*\*') WITH ORDINALITY AS part(txt, ord)) AS part
) s
WHERE c.birth_year = 1990;

SELECT count(*) AS rows, count(DISTINCT heading) AS headings,
       avg(length(content))::int AS avg_len, max(length(content)) AS max_len
FROM stg;

SELECT heading, count(*) FROM stg GROUP BY 1 ORDER BY 2 DESC LIMIT 8;

-- 看一条
SELECT heading, left(content, 200) FROM stg WHERE heading = '一句话定调' LIMIT 1;
