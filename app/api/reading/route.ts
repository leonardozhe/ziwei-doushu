import { getPool } from '@/lib/db/client';
import { getChart, getReadings, chartKey, TOPIC_LABELS, TOPICS, type Topic } from '@/lib/db/readings';
import { apiError, apiOk } from '@/lib/api/response';

/**
 * GET /api/reading?year=&month=&day=&hour=&gender=&topics=a,b
 *
 * 从解读数据集 v4.0 取一张盘的 13 维解读文本。
 *
 * 口径提醒（与数据集说明一致）：
 *   - 数据集是「本命盘视图」，不含按当前年龄改写的句子、倪师法则附加段与 AI 解读
 *   - 按时辰序号直接排盘，未做出生地真太阳时校正
 */
export async function GET(request: Request) {
  if (!getPool()) {
    return apiError('DATABASE_URL is not configured; interpretation dataset is unavailable', 503);
  }

  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));
  const day = Number(url.searchParams.get('day'));
  const hour = Number(url.searchParams.get('hour'));
  const gender = url.searchParams.get('gender') ?? '';

  if (![year, month, day, hour].every(Number.isInteger)) {
    return apiError('year, month, day, hour are required integers');
  }
  if (gender !== 'male' && gender !== 'female') {
    return apiError("gender must be 'male' or 'female'");
  }
  if (hour < 0 || hour > 11) {
    return apiError('hour must be a branch index 0-11 (子=0 … 亥=11)');
  }

  const topicsParam = url.searchParams.get('topics');
  const topics: Topic[] | undefined = topicsParam
    ? topicsParam.split(',').map((t) => t.trim()).filter((t): t is Topic => (TOPICS as readonly string[]).includes(t))
    : undefined;

  try {
    const key = chartKey(year, month, day, hour, gender);
    const chart = await getChart(year, month, day, hour, gender);
    if (!chart) {
      return apiError(`no chart found for ${key}`, 404);
    }
    const readings = await getReadings(key, topics);
    return apiOk({
      chart,
      key,
      topics: readings.map((r) => ({
        topic: r.topic,
        label: TOPIC_LABELS[r.topic],
        charCount: r.char_count,
        content: r.content,
      })),
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500);
  }
}
