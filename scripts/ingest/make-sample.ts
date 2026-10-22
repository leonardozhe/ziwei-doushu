/**
 * 造一份小样本数据，供 CI 的数据库层回归使用。
 *
 *   DATABASE_URL=... npx tsx scripts/ingest/make-sample.ts
 *
 * 造的数据刻意贴近真实数据集：
 *   - 3 个年份 × 12 时辰 × 2 性别 = 72 张命盘
 *   - 每张盘 13 维解读，内容里含术语（星曜名 / 宫位名 / 四化）
 *   - 命宫主星按真实引擎算出来，保证口径一致
 *
 * 这样 CI 能验证：表结构、引擎↔数据集口径一致性、术语倒排检索的正确性。
 */
import { Client } from 'pg';
import { generateChart } from '../../lib/ziwei/algorithm';
import { TOPICS } from '../../lib/db/readings';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('需要 DATABASE_URL');
  process.exit(1);
}

const YEARS = [1990, 2000, 2010];
const CONTENT_VERSION = 'ca268829f7a9';

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  // 幂等建表：CI 上会先跑 schema.sql，但为了能独立运行，这里自己保证结构存在
  await client.query(`
    CREATE TABLE IF NOT EXISTS ziwei_sections (
      id         bigserial PRIMARY KEY,
      chart_key  text NOT NULL,
      topic      text NOT NULL,
      seq        int  NOT NULL,
      heading    text NOT NULL,
      content    text NOT NULL,
      UNIQUE (chart_key, topic, seq)
    );
    CREATE TABLE IF NOT EXISTS ziwei_terms (
      id          bigserial PRIMARY KEY,
      term        text NOT NULL UNIQUE,
      term_type   text NOT NULL DEFAULT 'other',
      chart_count int  NOT NULL DEFAULT 0,
      content_len int  NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ziwei_term_charts (
      term_id    bigint NOT NULL,
      chart_key  text   NOT NULL,
      hits       int    NOT NULL,
      birth_year int    NOT NULL DEFAULT 0,
      gender     text   NOT NULL DEFAULT '',
      mingzhu    text   NOT NULL DEFAULT '',
      PRIMARY KEY (term_id, chart_key)
    );
  `);

  await client.query('TRUNCATE ziwei_readings, ziwei_charts, ziwei_sections CASCADE');

  let chartCount = 0;
  let readingCount = 0;

  for (const year of YEARS) {
    for (let hour = 0; hour < 12; hour++) {
      for (const gender of ['male', 'female'] as const) {
        const birth = { year, month: 1, day: 1, hour, gender };
        const chart = generateChart(birth);
        const chartKey = `${year}-01-01-${hour}-${gender}`;

        const mingzhu =
          chart.palaces.find((p) => p.isMingGong)?.stars.find((s) => s.type === 'major')?.name
          ?? null;

        await client.query(
          `INSERT INTO ziwei_charts
             (chart_key, birth_year, birth_month, birth_day, birth_hour, gender, mingzhu, content_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (chart_key) DO UPDATE SET mingzhu = EXCLUDED.mingzhu`,
          [chartKey, year, 1, 1, hour, gender, mingzhu, CONTENT_VERSION],
        );
        chartCount++;

        // 13 维解读：内容里塞入真实术语，便于验证倒排检索
        for (const topic of TOPICS) {
          const body = buildBody(chartKey, topic, mingzhu);
          await client.query(
            `INSERT INTO ziwei_readings (chart_key, topic, char_count, content)
             VALUES ($1,$2,$3,$4)`,
            [chartKey, topic, body.length, body],
          );
          readingCount++;
        }
      }
    }
  }

  // 小节表：按 **【标题】** 前瞻分割，验证拆分逻辑
  await client.query(
    `INSERT INTO ziwei_sections (chart_key, topic, seq, heading, content)
     SELECT r.chart_key, r.topic,
            s.ord,
            coalesce(nullif(s.heading, ''), '（前言）'),
            s.body
       FROM ziwei_readings r
       CROSS JOIN LATERAL (
         SELECT
           (row_number() OVER (ORDER BY part.ord))::int AS ord,
           coalesce((regexp_match(part.txt, '^\s*[*][*]【([^】]+)】[*][*]'))[1], '') AS heading,
           regexp_replace(part.txt, '^\s*[*][*]【[^】]+】[*][*]\s*', '', 'g') AS body
         FROM (
           SELECT p.txt, p.ord
             FROM regexp_split_to_table(r.content, '(?=[*][*]【)') WITH ORDINALITY AS p(txt, ord)
         ) AS part
       ) s
     ON CONFLICT (chart_key, topic, seq) DO UPDATE
       SET heading = EXCLUDED.heading, content = EXCLUDED.content`,
  );

  // 术语表 + 倒排
  const { TERMS } = await import('../../lib/ziwei/terms');
  await client.query('TRUNCATE ziwei_term_charts');
  await client.query('TRUNCATE ziwei_terms CASCADE');
  await client.query(
    `INSERT INTO ziwei_terms (term, term_type)
     SELECT * FROM unnest($1::text[], $2::text[])`,
    [TERMS.map((t) => t.term), TERMS.map((t) => t.type)],
  );

  const sorted = [...TERMS].sort((a, b) => b.term.length - a.term.length);
  const pattern = sorted.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  await client.query(
    `WITH scan AS (
       SELECT s.chart_key, c.birth_year, c.gender, c.mingzhu, s.content
         FROM ziwei_sections s
         JOIN ziwei_charts c USING (chart_key)
     ),
     hits AS (
       SELECT scan.chart_key, scan.birth_year, scan.gender, scan.mingzhu, (m.w)[1] AS term
         FROM scan, LATERAL regexp_matches(scan.content, $1, 'g') AS m(w)
     )
     INSERT INTO ziwei_term_charts (term_id, chart_key, hits, birth_year, gender, mingzhu)
     SELECT t.id, h.chart_key, count(*)::int, min(h.birth_year)::int, min(h.gender), min(h.mingzhu)
       FROM hits h JOIN ziwei_terms t ON t.term = h.term
      GROUP BY t.id, h.chart_key`,
    [pattern],
  );

  await client.query(
    `UPDATE ziwei_terms t
        SET chart_count = COALESCE(c.n, 0)
       FROM (SELECT term_id, count(*) AS n FROM ziwei_term_charts GROUP BY term_id) c
      WHERE c.term_id = t.id`,
  );

  const stats = await client.query(
    `SELECT (SELECT count(*) FROM ziwei_charts)      AS charts,
            (SELECT count(*) FROM ziwei_readings)   AS readings,
            (SELECT count(*) FROM ziwei_sections)   AS sections,
            (SELECT count(*) FROM ziwei_term_charts) AS pairs`,
  );
  console.log('[make-sample] 样本数据已生成:', JSON.stringify(stats.rows[0]));

  await client.end();
}

/** 造一段带 **【小节】** 标记、含术语的解读正文 */
function buildBody(chartKey: string, topic: string, mingzhu: string | null): string {
  const star = mingzhu ?? '天府';
  return [
    `**【${labelFor(topic)}】**`,
    '',
    `本盘命宫坐${star}，三方四正见化禄、化权、化科、化忌，财帛宫与官禄宫同论。`,
    `【命格总览】`,
    `以${star}守命，主见分明；财帛宫得地，进退有据。`,
    `**【一句话定调】**`,
    `${star}坐命，先天格局稳；后运在于取舍。`,
    `**【核心论断】**`,
    `《全书》论${star}，庙旺则通达，落陷则须守。`,
  ].join('\n');
}

function labelFor(topic: string): string {
  const map: Record<string, string> = {
    overview: '命格总览', personality: '性格总览', love: '感情总览',
    career: '事业总览', wealth: '财运总览', health: '健康总览',
    family: '兄弟总览', children: '子女总览', move: '迁移总览',
    friends: '人际总览', home: '田宅总览', spirit: '福德总览', parents: '父母总览',
  };
  return map[topic] ?? topic;
}

main().catch((e) => {
  console.error('[make-sample] 失败:', e);
  process.exit(1);
});
