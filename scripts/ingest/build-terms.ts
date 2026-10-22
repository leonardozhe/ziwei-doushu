/**
 * 构建术语倒排索引。
 *
 *   npx tsx scripts/ingest/build-terms.ts
 *
 * 为什么需要倒排：
 *   v4.0 全量 877 万段解读（204 亿字）上做任意子串检索无法走索引
 *   （ILIKE 前后通配不提取 trigram；trgm % 在长中文上更慢）。实测 6 年范围要 65 秒。
 *   但命理术语是**有限集合**，把「哪张盘提到哪个术语」预计算成倒排表，
 *   检索就是秒级。
 *
 * 做法：
 *   1. 术语表来自 lib/ziwei/terms.ts（与引擎常量一致）
 *   2. 一次扫描「总览类」小节，用一个合并正则抽出每行命中的所有术语
 *   3. 聚合到「命盘 × 术语」
 */
import { Client } from 'pg';
import { TERMS } from '../../lib/ziwei/terms';

const CONN = process.env.DATABASE_URL
  ?? 'postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei';

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  // ── 1. 术语表 ──────────────────────────────────────────
  console.log(`[build-terms] 术语 ${TERMS.length} 个`);

  await client.query('TRUNCATE ziwei_terms CASCADE');

  const terms = TERMS.map((t) => `(${t.term}, ${quote(t.type)})`).join(',');
  await client.query(
    `INSERT INTO ziwei_terms (term, term_type) VALUES ${terms}`,
  );

  // ── 2. 合并正则（长词优先，避免「命宫」抢在「父母宫」前面）────
  const sorted = [...TERMS].sort((a, b) => b.term.length - a.term.length);
  const pattern = sorted.map((t) => escapeRegex(t.term)).join('|');

  const client2 = client;
  console.log('[build-terms] 开始扫描总览类小节…');
  const t0 = Date.now();

  // 一次扫描。regexp_matches 抽出所有命中词，再用数组包含过滤（只保留在术语表里的）
  await client2.query('TRUNCATE ziwei_term_charts');

  const res = await client2.query(
    `WITH scan AS (
       SELECT s.chart_key, s.content
         FROM ziwei_sections s
        WHERE s.heading LIKE '%总览'
     ),
     hits AS (
       SELECT scan.chart_key,
              (m.w)[1] AS term
         FROM scan,
              LATERAL regexp_matches(scan.content, $1, 'g') AS m(w)
     )
     INSERT INTO ziwei_term_charts (term_id, chart_key, hits)
     SELECT t.id, h.chart_key, count(*)::int
       FROM hits h
       JOIN ziwei_terms t ON t.term = h.term
      GROUP BY t.id, h.chart_key`,
    [pattern],
  );

  console.log(`[build-terms] 倒排写入 ${res.rowCount} 行，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── 3. 统计 ────────────────────────────────────────────
  const stats = await client2.query(
    `SELECT count(*)::int AS terms,
            count(*) FILTER (WHERE chart_count > 0)::int AS used_terms
       FROM ziwei_terms`,
  );
  const counts = await client2.query(
    `SELECT count(DISTINCT term_id)::int AS terms,
            count(*)::int AS pairs
       FROM ziwei_term_charts`,
  );
  const top = await client2.query(
    `SELECT t.term, t.term_type, count(*)::int AS charts
       FROM ziwei_term_charts tc
       JOIN ziwei_terms t ON t.id = tc.term_id
      GROUP BY t.term, t.term_type
      ORDER BY charts DESC
      LIMIT 10`,
  );

  // 更新 chart_count
  await client2.query(
    `UPDATE ziwei_terms t
        SET chart_count = COALESCE(c.n, 0)
       FROM (SELECT term_id, count(*) AS n FROM ziwei_term_charts GROUP BY term_id) c
      WHERE c.term_id = t.id`,
  );

  console.log(`[build-terms] 术语表 ${stats.rows[0].terms} 个，其中被引用 ${counts.rows[0].terms} 个`);
  console.log(`[build-terms] 倒排关系 ${counts.rows[0].pairs} 条`);
  console.log('[build-terms] 命中最多的术语:');
  for (const r of top.rows) {
    console.log(`   ${r.term.padEnd(6)} ${r.term_type.padEnd(12)} ${r.charts} 张盘`);
  }

  await client.end();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

main().catch((e) => {
  console.error('[build-terms] 失败:', e);
  process.exit(1);
});
