-- 解读小节索引 —— 让「在解读里找某句话」变成可索引的结构化查询
--
-- 背景（v4.0 全量实测）：
--   直接在 ziwei_readings.content 上做 ILIKE '%kw%' 或 content % 'kw'：
--     - ILIKE 走不了 GIN trgm 索引（前后都通配时无法提取 trigram）
--     - trgm 的 % 操作符在 2.3KB 中文长文本上比全表扫描更慢
--   实测跨年检索 > 2 分钟，无法接受。
--
-- 方案：把每段解读按 **【小节标题】** 拆成独立行。
--   小节标题是有限集合（实测 26 种），每行内容变短（几百到两千字），
--   可以建 GIN trgm 索引并真正用上。检索时先走索引拿命盘，再回表验证。
--
-- 结构：
--   ziwei_sections
--     chart_key   命盘
--     topic       13 维之一
--     seq         该维度内的小节序号
--     heading     小节标题（如「核心论断」「经典出处」）
--     content     小节正文

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
