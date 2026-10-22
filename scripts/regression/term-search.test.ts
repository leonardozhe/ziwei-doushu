/**
 * 术语倒排检索回归。
 *
 * 验证「命理术语 → 命盘」的倒排查得对、查得快。
 * 需要数据库；未配置 DATABASE_URL 时跳过（CI 环境）。
 */
import assert from 'node:assert/strict';
import { searchTerms, countTermCharts, findTerms } from '../../lib/db/term-search';
import { TERMS } from '../../lib/ziwei/terms';

if (!process.env.DATABASE_URL) {
  console.log('[term-search] 未配置 DATABASE_URL，跳过');
  process.exit(0);
}

async function main() {
  let passed = 0;
  const check = (name: string, cond: boolean, detail = '') => {
    assert.ok(cond, `${name} 失败: ${detail}`);
    passed++;
    console.log(`  ✅ ${name}`);
  };

  console.log('[term-search] 术语倒排检索回归');

  // 术语表非空
  check('术语表非空', TERMS.length > 100, `实际 ${TERMS.length}`);

  // 术语至少 2 字（单字噪声太大，实测会命中全部盘）
  const shortTerms = TERMS.filter((t) => t.term.length < 2);
  check('术语均至少 2 个字', shortTerms.length === 0,
    `短术语: ${shortTerms.map((t) => t.term).join(',')}`);

  // 14 主星都在术语表里
  const majorStars = ['紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴',
    '贪狼', '巨门', '天相', '天梁', '七杀', '破军'];
  const missing = majorStars.filter((s) => !TERMS.some((t) => t.term === s));
  check('14 主星齐全', missing.length === 0, `缺: ${missing.join(',')}`);

  // 12 宫位齐全
  const palaces = ['命宫', '兄弟宫', '夫妻宫', '子女宫', '财帛宫', '疾厄宫',
    '迁移宫', '交友宫', '官禄宫', '田宅宫', '福德宫', '父母宫'];
  const missingP = palaces.filter((p) => !TERMS.some((t) => t.term === p));
  check('12 宫位齐全', missingP.length === 0, `缺: ${missingP.join(',')}`);

  // 倒排表有数据
  const hits = await searchTerms('太阳', { limit: 5 });
  check('「太阳」倒排有结果', hits.length > 0, '查不到');
  check('「太阳」倒排结果带盘信息', hits.length > 0 && !!hits[0].chart_key);
  check('「太阳」倒排结果带命宫主星', hits.length > 0 && hits[0].mingzhu !== undefined);

  // 命中数降序
  if (hits.length > 1) {
    const desc = hits.every((h, i) => i === 0 || hits[i - 1].hits >= h.hits);
    check('结果按命中数降序', desc, JSON.stringify(hits.map((h) => h.hits)));
  }

  // 过滤条件生效
  const yearHits = await searchTerms('太阳', { year: 1990, limit: 5 });
  check('年份过滤生效', yearHits.every((h) => h.birth_year === 1990));

  const total = await countTermCharts('太阳');
  check('countTermCharts 返回数字', Number.isInteger(total) && total > 0, String(total));

  // findTerms 支持部分匹配
  const found = await findTerms('天府', 5);
  check('findTerms 部分匹配可用', found.length > 0);

  // 性能：倒排查询应是毫秒级
  const t0 = Date.now();
  await searchTerms('天府', { limit: 20 });
  const ms = Date.now() - t0;
  check('倒排查询 < 2000ms', ms < 2000, `实际 ${ms}ms`);

  console.log(`[term-search] ${passed} 项断言全部通过（查询耗时 ${ms}ms）`);
}

main().catch((e) => {
  console.error('[term-search] 失败:', e);
  process.exit(1);
});
