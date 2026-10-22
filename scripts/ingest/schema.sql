-- 紫微斗数解读数据集 v4.0 —— 数据库结构
-- 数据集: https://github.com/Renhuai123/ziwei-doushu  (CC BY 4.0)
-- 规模: 674,976 命盘 × 13 维 = 8,774,688 段解读

-- 1) 命盘主表：一行 = 一张盘
CREATE TABLE IF NOT EXISTS ziwei_charts (
  chart_key       text PRIMARY KEY,        -- YYYY-MM-DD-h-GENDER
  birth_year      int  NOT NULL,
  birth_month     int  NOT NULL,
  birth_day       int  NOT NULL,
  birth_hour      int  NOT NULL,           -- 时辰序号 0-11 (子=0)
  gender          text NOT NULL CHECK (gender IN ('male','female')),
  mingzhu         text,                    -- 命宫第一颗主星
  content_version text NOT NULL DEFAULT 'ca268829f7a9',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ziwei_charts_birth_idx  ON ziwei_charts (birth_year, birth_month, birth_day);
CREATE INDEX IF NOT EXISTS ziwei_charts_year_idx   ON ziwei_charts (birth_year);
CREATE INDEX IF NOT EXISTS ziwei_charts_gender_idx ON ziwei_charts (gender);
CREATE INDEX IF NOT EXISTS ziwei_charts_mingzhu_idx ON ziwei_charts (mingzhu);

-- 2) 解读表：一行 = 一张盘的一个维度
CREATE TABLE IF NOT EXISTS ziwei_readings (
  id          bigserial PRIMARY KEY,
  chart_key   text NOT NULL REFERENCES ziwei_charts(chart_key) ON DELETE CASCADE,
  topic       text NOT NULL,               -- overview/personality/love/... 13 维
  char_count  int  NOT NULL,
  content     text NOT NULL,               -- Markdown 正文
  UNIQUE (chart_key, topic)
);

CREATE INDEX IF NOT EXISTS ziwei_readings_topic_idx ON ziwei_readings (topic);
CREATE INDEX IF NOT EXISTS ziwei_readings_chart_idx ON ziwei_readings (chart_key);

-- 3) 中文全文检索：pg_trgm 字符级三元组，支持中文子串 / 短语匹配
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS ziwei_readings_content_trgm_idx
  ON ziwei_readings USING gin (content gin_trgm_ops);

-- 4) 载入审计
CREATE TABLE IF NOT EXISTS ziwei_ingest_log (
  id            bigserial PRIMARY KEY,
  year          int NOT NULL,
  charts        int NOT NULL,
  readings      int NOT NULL,
  source_sha256 text,
  source_bytes  bigint,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);
