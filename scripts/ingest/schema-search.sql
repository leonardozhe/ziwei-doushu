-- 解读正文的检索加速结构
--
-- 背景（v4.0 全量实测）：
--   `content ILIKE '%kw%'` 走不了 GIN trgm 索引（gin_trgm_ops 只对 % 操作符有效，
--   而 % 操作符在 2.3KB 长文本上比全表扫描还慢）。实测跨年检索 >2 分钟。
--
-- 方案：把正文里的**所有 2 字以上中文词**抽成一个「关键词指纹」列，
--   对该列建 GIN trgm 索引。检索时先在指纹列上用 trgm 匹配（能走索引），
--   拿到命盘集合后再回表用 ILIKE 精确验证。
--
-- 指纹列内容形如： 太阳|太阴|天府|化禄|化忌|财帛宫|命宫 ...
-- 每个词用 | 分隔，长度可控（一个盘 13 维合起来约 200~400 个词）。

-- 1) 关键词指纹列（generated column，普通表用触发器更省事，这里用 stored generated）
ALTER TABLE ziwei_readings
  ADD COLUMN IF NOT EXISTS kw_fingerprint text;

-- 2) 用一个 IMMUTABLE 函数抽取中文词
CREATE OR REPLACE FUNCTION ziwei_extract_cn_words(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(string_agg(DISTINCT w, '|' ORDER BY w), '')
    FROM regexp_matches(coalesce(src, ''), '[\u4e00-\u9fff]{2,8}', 'g') AS m(w);
$$;

-- 3) 回填（877 万行，约几分钟）
UPDATE ziwei_readings
   SET kw_fingerprint = ziwei_extract_cn_words(content)
 WHERE kw_fingerprint IS NULL;

-- 4) 指纹列的 GIN trgm 索引
CREATE INDEX CONCURRENTLY IF NOT EXISTS ziwei_readings_kw_fp_trgm_idx
  ON ziwei_readings USING gin (kw_fingerprint gin_trgm_ops);
