import { query } from './client';

/** 13 个分析维度，顺序与数据集一致 */
export const TOPICS = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
] as const;

export type Topic = (typeof TOPICS)[number];

/** 维度的中文名，用于前端直接展示 */
export const TOPIC_LABELS: Record<Topic, string> = {
  overview: '命格总览',
  personality: '性格特质',
  love: '感情婚姻',
  career: '事业职业',
  wealth: '财富运势',
  health: '健康状况',
  family: '兄弟合伙',
  children: '子女缘分',
  move: '迁移外出',
  friends: '人际贵人',
  home: '田宅不动产',
  spirit: '精神福德',
  parents: '父母长辈',
};

export interface ChartRow {
  chart_key: string;
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour: number;
  gender: 'male' | 'female';
  mingzhu: string | null;
  content_version: string;
}

export interface ReadingRow {
  topic: Topic;
  char_count: number;
  content: string;
}

/** 命盘 key：YYYY-MM-DD-h-GENDER（时辰序号 0-11） */
export function chartKey(year: number, month: number, day: number, hour: number, gender: string) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}-${hour}-${gender}`;
}

/** 按出生信息取一张盘的元数据 */
export async function getChart(
  year: number, month: number, day: number, hour: number, gender: string,
): Promise<ChartRow | null> {
  const rows = await query<ChartRow>(
    `SELECT chart_key, birth_year, birth_month, birth_day, birth_hour, gender, mingzhu, content_version
       FROM ziwei_charts
      WHERE chart_key = $1`,
    [chartKey(year, month, day, hour, gender)],
  );
  return rows[0] ?? null;
}

/**
 * 取一张盘的全部解读。
 * topics 省略时返回全部 13 维。
 */
export async function getReadings(
  key: string,
  topics?: Topic[],
): Promise<ReadingRow[]> {
  if (topics && topics.length === 0) return [];
  const rows = await query<ReadingRow>(
    `SELECT topic, char_count, content
       FROM ziwei_readings
      WHERE chart_key = $1
        AND ($2::text[] IS NULL OR topic = ANY($2::text[]))
      ORDER BY array_position(ARRAY${`['${TOPICS.join("','")}']`}::text[], topic)`,
    [key, topics ?? null],
  );
  return rows;
}

/**
 * 在解读正文里做中文子串检索（pg_trgm 三元组）。
 * 返回命盘元数据 + 命中片段。
 */
export async function searchReadings(
  keyword: string,
  opts: { limit?: number; offset?: number; topic?: Topic } = {},
) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const topic = opts.topic ?? null;

  return query<{
    chart_key: string;
    birth_year: number;
    birth_month: number;
    birth_day: number;
    birth_hour: number;
    gender: string;
    mingzhu: string | null;
    topic: string;
    char_count: number;
    similarity: number;
    snippet: string;
  }>(
    `SELECT c.chart_key, c.birth_year, c.birth_month, c.birth_day, c.birth_hour,
            c.gender, c.mingzhu, r.topic, r.char_count,
            similarity(r.content, $1) AS similarity,
            substring(r.content from greatest(1, position($1 in r.content) - 40)
                              for 200) AS snippet
       FROM ziwei_readings r
       JOIN ziwei_charts c USING (chart_key)
      WHERE r.content % $1
        AND ($3::text IS NULL OR r.topic = $3)
      ORDER BY similarity DESC, c.chart_key
      LIMIT $2 OFFSET $4`,
    [keyword, limit, topic, offset],
  );
}
