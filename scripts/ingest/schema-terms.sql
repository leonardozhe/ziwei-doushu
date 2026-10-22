-- 术语倒排索引 —— 让「在解读里找某个命理术语」变成秒级查询
--
-- 背景（v4.0 全量实测）：
--   直接在 8268 万行小节上做 ILIKE '%kw%'，即使有 GIN trgm 索引也走不了
--   （前后都通配时无法提取 trigram；trgm 的 % 操作符在长中文上更慢）。
--   实测 6 年范围就要 65 秒，全库更久。
--
-- 方案：术语是**有限集合**（星曜名、宫位名、四化、格局名……），
--   把「哪张盘提到了哪个术语」预计算成倒排表，检索时直接查表。
--
-- 结构：
--   ziwei_terms        术语表：term, term_type, chart_count
--   ziwei_term_charts  倒排：term_id → chart_key（含该术语的解读段数）

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS ziwei_terms (
  id          bigserial PRIMARY KEY,
  term        text NOT NULL UNIQUE,
  term_type   text NOT NULL DEFAULT 'other',
  chart_count int  NOT NULL DEFAULT 0,
  content_len int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ziwei_term_charts (
  term_id    bigint NOT NULL REFERENCES ziwei_terms(id) ON DELETE CASCADE,
  chart_key  text   NOT NULL REFERENCES ziwei_charts(chart_key) ON DELETE CASCADE,
  hits       int    NOT NULL,
  -- 冗余存出生年 / 性别 / 命宫主星：
  --   排序与过滤全在倒排表内完成，不必 join 命盘表
  --   （实测 join 命盘表 1773ms vs 不 join 26ms，差 70 倍）
  birth_year int    NOT NULL DEFAULT 0,
  gender     text   NOT NULL DEFAULT '',
  mingzhu    text   NOT NULL DEFAULT '',
  PRIMARY KEY (term_id, chart_key)
);

-- 排序专用复合索引：让 top-N 排序在索引里完成，不用全量取出再排
CREATE INDEX IF NOT EXISTS ziwei_term_charts_rank_idx
  ON ziwei_term_charts (term_id, hits DESC, birth_year DESC);
CREATE INDEX IF NOT EXISTS ziwei_term_charts_chart_idx ON ziwei_term_charts (chart_key);
