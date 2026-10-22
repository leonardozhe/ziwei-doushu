import { getPool } from '@/lib/db/client';
import { searchTerms, countTermCharts, findTerms } from '@/lib/db/term-search';
import { searchReadings } from '@/lib/db/search';
import { MINGZHU_LIST, HEADING_LIST } from '@/lib/db/search';
import { TOPIC_LABELS, TOPICS, type Topic } from '@/lib/db/readings';
import { TERM_TYPE_LABELS } from '@/lib/ziwei/terms';
import { apiError, apiOk } from '@/lib/api/response';

/**
 * GET /api/search?q=关键词&limit=&offset=&year=&yearFrom=&yearTo=&gender=&topic=&heading=&mingzhu=
 *
 * 两条检索路径：
 *
 * 1. **术语命中**（主路径，毫秒级）
 *    命理术语是有限集合（174 个），「哪张盘提到哪个术语」已预计算成倒排表
 *    `ziwei_term_charts`。查表即得结果。
 *    例：q=天府 → 命宫主星是天府的盘 + 解读里提到天府的盘
 *
 * 2. **全文子串**（兜底，慢）
 *    自由文本在 `ziwei_sections` 上做 ILIKE。877 万段正文上这个查询无法走索引
 *    （实测 6 年范围 65 秒），所以**必须带过滤条件**，否则会很慢。
 *
 * 两条路的结果合并返回，并标注 `via` 字段。
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
  const gender: 'male' | 'female' | undefined =
    genderParam === 'male' || genderParam === 'female' ? genderParam : undefined;

  const mingzhuParam = url.searchParams.get('mingzhu');
  const mingzhu = mingzhuParam && (MINGZHU_LIST as readonly string[]).includes(mingzhuParam)
    ? mingzhuParam
    : undefined;

  const headingParam = url.searchParams.get('heading');
  const heading = headingParam && (HEADING_LIST as readonly string[]).includes(headingParam)
    ? headingParam
    : undefined;

  const filters = {
    year: intParam('year'),
    yearFrom: intParam('yearFrom'),
    yearTo: intParam('yearTo'),
    gender,
    mingzhu,
  };

  try {
    // ── 路径 1：术语倒排 ──────────────────────────────
    const exactTerm = await findTerms(q, 1);
    const termResults: unknown[] = [];
    let termTotal = 0;
    let matchedTerm: string | null = null;

    if (exactTerm.length && exactTerm[0].term === q) {
      matchedTerm = exactTerm[0].term;
      const hits = await searchTerms(q, { ...filters, limit, offset });
      termTotal = await countTermCharts(q, filters);
      termResults.push(...hits.map((h) => ({
        via: 'term' as const,
        term: h.term,
        termType: h.term_type,
        termTypeLabel: TERM_TYPE_LABELS[h.term_type as keyof typeof TERM_TYPE_LABELS] ?? h.term_type,
        chartKey: h.chart_key,
        birth: {
          year: h.birth_year, month: h.birth_month, day: h.birth_day,
          hour: h.birth_hour, gender: h.gender,
        },
        mingzhu: h.mingzhu,
        hits: h.hits,
      })));
    }

    // ── 路径 2：全文子串（兜底）──────────────────────
    // 无任何过滤条件时全表扫描要几分钟，这里直接跳过并提示。
    const hasNarrowing =
      filters.year !== undefined ||
      filters.yearFrom !== undefined ||
      filters.yearTo !== undefined ||
      filters.gender !== undefined ||
      filters.mingzhu !== undefined ||
      topic !== undefined ||
      heading !== undefined;

    let textResults: unknown[] = [];
    let textTotal = 0;
    let textSearchSkipped = false;

    // 术语精确命中时不再跑全文路径：
    //   全文 ILIKE 要扫 877 万段正文，即使带过滤也要几十秒；
    //   而术语倒排已经给出更准的结果（命中段数 + 命宫主星）。
    if (hasNarrowing && !matchedTerm) {
      const hits = await searchReadings(q, {
        ...filters, topic, heading, limit, offset,
      });
      textTotal = hits.length;
      textResults = hits.map((h) => ({
        via: 'text' as const,
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
      }));
    } else if (!matchedTerm) {
      textSearchSkipped = true;
    } else {
      // 术语已命中，跳过全文路径
      textSearchSkipped = true;
    }

    const results = [...termResults, ...textResults].slice(0, limit);

    return apiOk({
      query: q,
      matchedTerm,
      count: results.length,
      termTotal,
      textTotal,
      textSearchSkipped,
      filters: { ...filters, topic, heading },
      results,
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500);
  }
}
