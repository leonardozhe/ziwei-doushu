import { query } from './client';
import type { Topic } from './readings';

/**
 * 解读正文检索。
 *
 * 设计要点（基于 v4.0 全量数据的实测）：
 *   数据集里「天府」这种高频主星名出现在 **345 万 / 877 万**段解读中（39%）。
 *   对全文做相似度排序（`content % keyword`）会退化成全表扫描 —— 实测单次 6 分钟。
 *
 *   所以这里改成**按盘聚合的子串命中**：
 *     - 命中段数作为排序键（一个盘里出现 3 次比另一个盘出现 1 次更相关）
 *     - 支持按年份 / 性别 / 维度 / 命宫主星过滤，先把候选集缩小
 *     - 结果按「命盘命中数」排序，语义是「哪些盘在讲这件事」
 */

/** 命宫主星的取值集合（用于过滤） */
export const MINGZHU_LIST = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴',
  '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
] as const;

export interface SearchFilters {
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  gender?: 'male' | 'female';
  topic?: Topic;
  mingzhu?: string;
}

export interface SearchHit {
  chart_key: string;
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour: number;
  gender: string;
  mingzhu: string | null;
  hits: number;
  matching_topics: string[];
  snippet: string;
}

/**
 * 把**作用于命盘表**的过滤条件拼成 SQL where 片段，同时往 params 里追加参数。
 * topic 作用于解读表，由调用方单独处理。
 */
function buildChartFilters(filters: SearchFilters, params: unknown[]): string[] {
  const where: string[] = [];

  if (filters.year !== undefined) {
    params.push(filters.year);
    where.push(`c.birth_year = $${params.length}`);
  }
  if (filters.yearFrom !== undefined) {
    params.push(filters.yearFrom);
    where.push(`c.birth_year >= $${params.length}`);
  }
  if (filters.yearTo !== undefined) {
    params.push(filters.yearTo);
    where.push(`c.birth_year <= $${params.length}`);
  }
  if (filters.gender) {
    params.push(filters.gender);
    where.push(`c.gender = $${params.length}`);
  }
  if (filters.mingzhu) {
    params.push(filters.mingzhu);
    where.push(`c.mingzhu = $${params.length}`);
  }

  return where;
}

export async function searchReadings(
  keyword: string,
  opts: SearchFilters & { limit?: number; offset?: number } = {},
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const params: unknown[] = [keyword];
  const candWhere = buildChartFilters(opts, params);

  // topic 作用于解读表，单独成句
  let topicClause = '';
  if (opts.topic) {
    params.push(opts.topic);
    topicClause = `AND r.topic = $${params.length}`;
  }

  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  // 执行顺序：**先按盘过滤（走 ziwei_charts 的索引），再在候选盘内做 ILIKE**。
  // 直接对 877 万段全文做 ILIKE 会退化成全表扫描（实测 6 分钟）；
  // 先用 birth_year / gender / mingzhu 把候选盘缩小后，实测 1.8 秒。
  return query<SearchHit>(
    `WITH cand AS (
       SELECT c.chart_key, c.birth_year, c.birth_month, c.birth_day,
              c.birth_hour, c.gender, c.mingzhu
         FROM ziwei_charts c
        WHERE ${candWhere.length ? candWhere.join(' AND ') : 'true'}
     ),
     hit AS (
       SELECT r.chart_key,
              count(*)                   AS hits,
              array_agg(DISTINCT r.topic) AS matching_topics,
              min(r.id)                  AS first_id
         FROM ziwei_readings r
         JOIN cand c USING (chart_key)
        WHERE r.content ILIKE $1
          ${topicClause}
        GROUP BY r.chart_key
        ORDER BY hits DESC, c.birth_year DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
     )
     SELECT h.chart_key,
            c.birth_year, c.birth_month, c.birth_day, c.birth_hour,
            c.gender, c.mingzhu,
            h.hits,
            h.matching_topics,
            (SELECT substring(r2.content from greatest(1, position($1 in r2.content) - 40) for 220)
               FROM ziwei_readings r2
              WHERE r2.id = h.first_id) AS snippet
       FROM hit h
       JOIN ziwei_charts c USING (chart_key)
      ORDER BY h.hits DESC, c.birth_year DESC`,
    params,
  );
}

/** 命中该关键词的命盘总数（用于展示「共 N 张盘提到」） */
export async function countMatchingCharts(
  keyword: string,
  filters: SearchFilters = {},
): Promise<number> {
  const params: unknown[] = [keyword];
  const candWhere = buildChartFilters(filters, params);

  let topicClause = '';
  if (filters.topic) {
    params.push(filters.topic);
    topicClause = `AND r.topic = $${params.length}`;
  }

  const rows = await query<{ n: string }>(
    `SELECT count(DISTINCT r.chart_key) AS n
       FROM ziwei_readings r
       JOIN ziwei_charts c USING (chart_key)
      WHERE r.content ILIKE $1
        ${topicClause}
        ${candWhere.length ? 'AND ' + candWhere.join(' AND ') : ''}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}
