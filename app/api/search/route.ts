import { getPool } from '@/lib/db/client';
import { searchReadings, countMatchingCharts, MINGZHU_LIST, HEADING_LIST, type SearchFilters } from '@/lib/db/search';
import { TOPIC_LABELS, TOPICS, type Topic } from '@/lib/db/readings';
import { apiError, apiOk } from '@/lib/api/response';

/**
 * GET /api/search?q=关键词&limit=&offset=&topic=&year=&yearFrom=&yearTo=&gender=&mingzhu=
 *
 * 在解读正文里做中文子串检索，按「命盘命中段数」排序。
 *
 * 性能说明：v4.0 全量 877 万段解读中，「天府」这类高频词命中 39% 的段落，
 * 纯全文相似度排序会退化成全表扫描（实测 6 分钟）。这里用
 * **ILIKE 命中 + 按盘聚合** 的方式，并把年份/性别/维度/命宫主星作为前置过滤器，
 * 让常见查询在可接受时间内返回。
 */
export async function GET(request: Request) {
  if (!getPool()) {
    return apiError('DATABASE_URL is not configured; interpretation dataset is unavailable', 503);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return apiError('q (keyword) is required');
  if (q.length < 2) return apiError('keyword must be at least 2 characters');

  const intParam = (k: string) => {
    const raw = url.searchParams.get(k);
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
  };

  const limit = Math.min(intParam('limit') ?? 20, 100);
  const offset = Math.max(intParam('offset') ?? 0, 0);

  const topicParam = url.searchParams.get('topic');
  const topic = topicParam && (TOPICS as readonly string[]).includes(topicParam)
    ? (topicParam as Topic)
    : undefined;

  const genderParam = url.searchParams.get('gender');
  const gender = genderParam === 'male' || genderParam === 'female' ? genderParam : undefined;

  const mingzhuParam = url.searchParams.get('mingzhu');
  const mingzhu = mingzhuParam && (MINGZHU_LIST as readonly string[]).includes(mingzhuParam)
    ? mingzhuParam
    : undefined;

  const headingParam = url.searchParams.get('heading');
  const heading = headingParam && (HEADING_LIST as readonly string[]).includes(headingParam)
    ? headingParam
    : undefined;

  const filters: SearchFilters = {
    topic,
    heading,
    gender,
    mingzhu,
    year: intParam('year'),
    yearFrom: intParam('yearFrom'),
    yearTo: intParam('yearTo'),
  };

  // 无任何过滤条件时，候选集是全部 67.5 万张盘，ILIKE 退化成全表扫描
  // （实测单次 >2 分钟）。这里给一个明确的报错，让调用方加过滤条件，
  // 而不是让请求挂到超时。
  const hasNarrowing =
    filters.year !== undefined ||
    filters.yearFrom !== undefined ||
    filters.yearTo !== undefined ||
    filters.gender !== undefined ||
    filters.mingzhu !== undefined ||
    filters.topic !== undefined ||
    filters.heading !== undefined;

  if (!hasNarrowing) {
    return apiError(
      '全库检索会扫描 877 万段解读，请至少加一个过滤条件：' +
      'year / yearFrom / yearTo / gender / topic / heading / mingzhu',
      400,
      { hint: '例如 /api/search?q=天府&year=1990' },
    );
  }

  try {
    const hits = await searchReadings(q, { ...filters, limit, offset });
    const total = await countMatchingCharts(q, filters);

    return apiOk({
      query: q,
      count: hits.length,
      totalCharts: total,
      filters,
      results: hits.map((h) => ({
        chartKey: h.chart_key,
        birth: {
          year: h.birth_year, month: h.birth_month, day: h.birth_day,
          hour: h.birth_hour, gender: h.gender,
        },
        mingzhu: h.mingzhu,
        hits: h.hits,
        matchingTopics: h.matching_topics.map((t) => ({
          topic: t,
          label: TOPIC_LABELS[t as Topic] ?? t,
        })),
        matchingHeadings: h.matching_headings,
        snippetHeading: h.snippet_heading,
        snippet: h.snippet,
      })),
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500);
  }
}
