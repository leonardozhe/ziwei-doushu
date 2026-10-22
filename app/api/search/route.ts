import { getPool } from '@/lib/db/client';
import { searchReadings, TOPIC_LABELS, TOPICS, type Topic } from '@/lib/db/readings';
import { apiError, apiOk } from '@/lib/api/response';

/**
 * GET /api/search?q=关键词&limit=&offset=&topic=
 *
 * 在解读正文里做中文子串检索（pg_trgm）。
 */
export async function GET(request: Request) {
  if (!getPool()) {
    return apiError('DATABASE_URL is not configured; interpretation dataset is unavailable', 503);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return apiError('q (keyword) is required');
  if (q.length < 2) return apiError('keyword must be at least 2 characters');

  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  const topicParam = url.searchParams.get('topic');
  const topic = topicParam && (TOPICS as readonly string[]).includes(topicParam)
    ? (topicParam as Topic)
    : null;

  try {
    const hits = await searchReadings(q, { limit, offset, topic: topic ?? undefined });
    return apiOk({
      query: q,
      count: hits.length,
      results: hits.map((h) => ({
        chartKey: h.chart_key,
        birth: {
          year: h.birth_year, month: h.birth_month, day: h.birth_day,
          hour: h.birth_hour, gender: h.gender,
        },
        mingzhu: h.mingzhu,
        topic: h.topic,
        topicLabel: TOPIC_LABELS[h.topic as Topic] ?? h.topic,
        charCount: h.char_count,
        similarity: Number(h.similarity.toFixed(4)),
        snippet: h.snippet,
      })),
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500);
  }
}
