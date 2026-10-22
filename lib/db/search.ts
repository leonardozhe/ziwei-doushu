import { query } from './client';
import type { Topic } from './readings';

/**
 * 解读检索 —— 基于**小节表** `ziwei_sections`。
 *
 * 为什么不用 `ziwei_readings.content` 直接检索（v4.0 全量实测）：
 *   - `content ILIKE '%kw%'`：前后都通配时 GIN trgm 索引无法提取 trigram，
 *     走不了索引 → 全表扫描，实测跨年 > 2 分钟
 *   - `content % 'kw'`：能走索引，但在 2.3KB 中文长文本上比全表扫描还慢
 *
 * 怎么解决：
 *   把每段解读按 **【小节标题】** 拆成独立行（小节标题是有限集合，实测 26 种）。
 *   每行内容变短（平均 ~200 字），trgm 索引终于能真正用上。
 *   实测：877 万段 → 91,460,638 个小节，平均 10.4 个/段。
 *
 * 排序语义：**命盘命中段数**优先（一个盘里出现 3 次比另一个盘出现 1 次更相关），
 * 其次按年份倒序。语义是「哪些盘在讲这件事」。
 */

/** 命宫主星的取值集合（用于过滤） */
export const MINGZHU_LIST = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴',
  '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
] as const;

/** 小节标题的取值集合（实测 26 种） */
export const HEADING_LIST = [
  '命格总览', '性格总览', '感情总览', '事业总览', '财运总览', '健康总览',
  '兄弟总览', '子女总览', '迁移总览', '人际总览', '田宅总览', '福德总览', '父母总览',
  '一句话定调', '核心论断', '命盘依据', '三方四正联动', '命盘推演',
  '身宫 · 后天追求', '针对你的命盘', '⚠️ 风险提醒',
  '四化路径分析 · 落到你这盘', '四化路径 · 你这盘', '年干四化·关键宫位影响',
  '倪师子午流注 · 宫位取象（流派参考）', '经典出处', '（前言）',
] as const;

export interface SearchFilters {
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  gender?: 'male' | 'female';
  topic?: Topic;
  heading?: string;
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
  matching_headings: string[];
  snippet: string;
  snippet_heading: string;
}

/** 构造「命盘表」侧的过滤条件 */
function chartFilterClauses(f: SearchFilters, params: unknown[]): string[] {
  const clauses: string[] = [];

  if (f.year !== undefined) {
    params.push(f.year);
    clauses.push(`c.birth_year = $${params.length}`);
  }
  if (f.yearFrom !== undefined) {
    params.push(f.yearFrom);
    clauses.push(`c.birth_year >= $${params.length}`);
  }
  if (f.yearTo !== undefined) {
    params.push(f.yearTo);
    clauses.push(`c.birth_year <= $${params.length}`);
  }
  if (f.gender) {
    params.push(f.gender);
    clauses.push(`c.gender = $${params.length}`);
  }
  if (f.mingzhu) {
    params.push(f.mingzhu);
    clauses.push(`c.mingzhu = $${params.length}`);
  }

  return clauses;
}

export async function searchReadings(
  keyword: string,
  opts: SearchFilters & { limit?: number; offset?: number } = {},
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  // $1 = 关键词（含通配符）；$2 = 裸关键词（用于 snippet 定位）
  const params: unknown[] = [`%${escapeLike(keyword)}%`];
  const chartClauses = chartFilterClauses(opts, params);

  let topicClause = '';
  if (opts.topic) {
    params.push(opts.topic);
    topicClause = `AND s.topic = $${params.length}`;
  }
  let headingClause = '';
  if (opts.heading) {
    params.push(opts.heading);
    headingClause = `AND s.heading = $${params.length}`;
  }

  params.push(keyword);
  const rawIdx = params.length;
  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  return query<SearchHit>(
    `WITH cand AS (
       SELECT c.chart_key, c.birth_year
         FROM ziwei_charts c
        WHERE ${chartClauses.length ? chartClauses.join(' AND ') : 'TRUE'}
     ),
     hit AS (
       SELECT s.chart_key,
              cand.birth_year,
              count(*)                          AS hits,
              array_agg(DISTINCT s.topic)       AS matching_topics,
              array_agg(DISTINCT s.heading)     AS matching_headings,
              min(s.id)                         AS first_id
         FROM cand
         JOIN ziwei_sections s USING (chart_key)
        WHERE s.content ILIKE $1
          ${topicClause}
          ${headingClause}
        GROUP BY s.chart_key, cand.birth_year
        ORDER BY hits DESC, cand.birth_year DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
     )
     SELECT h.chart_key,
            c.birth_year, c.birth_month, c.birth_day, c.birth_hour,
            c.gender, c.mingzhu,
            h.hits,
            h.matching_topics,
            h.matching_headings,
            (SELECT s2.heading FROM ziwei_sections s2 WHERE s2.id = h.first_id) AS snippet_heading,
            (SELECT substring(s2.content
                               from greatest(1, position($${rawIdx} in s2.content) - 40)
                               for 220)
               FROM ziwei_sections s2 WHERE s2.id = h.first_id) AS snippet
       FROM hit h
       JOIN ziwei_charts c USING (chart_key)
      ORDER BY h.hits DESC, c.birth_year DESC`,
    params,
  );
}

/** 命中该关键词的命盘总数 */
export async function countMatchingCharts(
  keyword: string,
  filters: SearchFilters = {},
): Promise<number> {
  const params: unknown[] = [`%${escapeLike(keyword)}%`];
  const chartClauses = chartFilterClauses(filters, params);

  let topicClause = '';
  if (filters.topic) {
    params.push(filters.topic);
    topicClause = `AND s.topic = $${params.length}`;
  }
  let headingClause = '';
  if (filters.heading) {
    params.push(filters.heading);
    headingClause = `AND s.heading = $${params.length}`;
  }

  const rows = await query<{ n: string }>(
    `SELECT count(DISTINCT s.chart_key) AS n
       FROM ziwei_charts c
       JOIN ziwei_sections s USING (chart_key)
      WHERE s.content ILIKE $1
        ${topicClause}
        ${headingClause}
        ${chartClauses.length ? 'AND ' + chartClauses.join(' AND ') : ''}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

/** 转义 ILIKE 模式里的特殊字符 */
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1');
}
