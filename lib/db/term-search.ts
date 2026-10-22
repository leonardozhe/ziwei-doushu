import { query } from './client';
import type { Topic } from './readings';

/**
 * 术语检索 —— 走倒排表 `ziwei_term_charts`。
 *
 * 这是解读检索的主路径：
 *   命理术语是有限集合（`lib/ziwei/terms.ts`，174 个），
 *   「哪张盘提到哪个术语」已预计算成倒排表，查询是纯索引扫描。
 *
 * 对比（v4.0 全量实测）：
 *   全文 ILIKE  '%kw%'  6 年范围 → 65 秒
 *   倒排表 term_id 命中      → 毫秒级
 *
 * 自由文本（不在术语表里的词）仍走 `ziwei_sections` 的 ILIKE，
 * 由 `searchReadings` 负责；`searchTerms` 负责术语这一路。
 */

export interface TermHit {
  term: string;
  term_type: string;
  chart_key: string;
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour: number;
  gender: string;
  mingzhu: string | null;
  hits: number;
}

export interface TermSearchOptions {
  limit?: number;
  offset?: number;
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  gender?: 'male' | 'female';
  topic?: Topic;
  mingzhu?: string;
}

export async function searchTerms(
  term: string,
  opts: TermSearchOptions = {},
): Promise<TermHit[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const params: unknown[] = [term];

  // 年份条件作用在倒排表冗余的 birth_year 上（可直接走复合索引）
  const innerWhere: string[] = [];
  if (opts.year !== undefined) {
    params.push(opts.year);
    innerWhere.push(`birth_year = $${params.length}`);
  }
  if (opts.yearFrom !== undefined) {
    params.push(opts.yearFrom);
    innerWhere.push(`birth_year >= $${params.length}`);
  }
  if (opts.yearTo !== undefined) {
    params.push(opts.yearTo);
    innerWhere.push(`birth_year <= $${params.length}`);
  }

  // 性别 / 命宫主星同样走倒排表冗余列（join 命盘表实测 1773ms，
  // 不 join 只要 26ms —— 差 70 倍）
  if (opts.gender) {
    params.push(opts.gender);
    innerWhere.push(`gender = $${params.length}`);
  }
  if (opts.mingzhu) {
    params.push(opts.mingzhu);
    innerWhere.push(`mingzhu = $${params.length}`);
  }

  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  return query<TermHit>(
    // 排序键 (hits DESC, birth_year DESC) 已在 ziwei_term_charts_rank_idx 里，
    // 命中集先在索引内 top-N，再 join 命盘表取明细。
    `SELECT t.term, t.term_type,
            c.chart_key, c.birth_year, c.birth_month, c.birth_day, c.birth_hour,
            c.gender, c.mingzhu,
            tc.hits
       FROM (
         SELECT term_id, chart_key, hits
           FROM ziwei_term_charts
          WHERE term_id = (SELECT id FROM ziwei_terms WHERE term = $1)
            ${innerWhere.length ? 'AND ' + innerWhere.join(' AND ') : ''}
          ORDER BY hits DESC, birth_year DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
       ) tc
       JOIN ziwei_terms t ON t.id = tc.term_id
       JOIN ziwei_charts c ON c.chart_key = tc.chart_key`,
    params,
  );
}

/** 命中有该术语的命盘总数 */
export async function countTermCharts(
  term: string,
  opts: Omit<TermSearchOptions, 'limit' | 'offset'> = {},
): Promise<number> {
  const params: unknown[] = [term];
  const where: string[] = [];

  if (opts.year !== undefined) {
    params.push(opts.year);
    where.push(`tc.birth_year = $${params.length}`);
  }
  if (opts.yearFrom !== undefined) {
    params.push(opts.yearFrom);
    where.push(`tc.birth_year >= $${params.length}`);
  }
  if (opts.yearTo !== undefined) {
    params.push(opts.yearTo);
    where.push(`tc.birth_year <= $${params.length}`);
  }
  if (opts.gender) {
    params.push(opts.gender);
    where.push(`tc.gender = $${params.length}`);
  }
  if (opts.mingzhu) {
    params.push(opts.mingzhu);
    where.push(`tc.mingzhu = $${params.length}`);
  }

  // 注意：不要用 count(DISTINCT tc.chart_key) ——
  //   (term_id, chart_key) 本来就是主键，天然唯一；
  //   DISTINCT 让 Postgres 去重，实测 3546ms vs 38ms（慢 100 倍）。
  // 无过滤条件时直接读预存的 chart_count（1.2ms），
  // 实时 count 要扫 67 万行（2000ms+）。
  if (where.length === 0) {
    const rows = await query<{ chart_count: number }>(
      `SELECT chart_count FROM ziwei_terms WHERE term = $1`,
      [term],
    );
    return Number(rows[0]?.chart_count ?? 0);
  }

  // 有过滤条件才实时 count（不 join 命盘表：1773ms → 26ms）
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n
       FROM ziwei_term_charts tc
       JOIN ziwei_terms t ON t.id = tc.term_id
      WHERE t.term = $1
        ${where.join(' AND ')}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

/** 术语表里匹配给定关键词的术语（支持部分匹配，让用户能搜到「紫」找到「紫微」） */
export async function findTerms(keyword: string, limit = 10) {
  return query<{ term: string; term_type: string; chart_count: number }>(
    `SELECT term, term_type, chart_count
       FROM ziwei_terms
      WHERE term LIKE $1
      ORDER BY chart_count DESC
      LIMIT $2`,
    [`%${keyword}%`, limit],
  );
}
