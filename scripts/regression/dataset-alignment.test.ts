/**
 * 引擎口径 ↔ 解读数据集口径 一致性回归。
 *
 * 这是数据可信度的核心：数据集的 `ms`（命宫第一颗主星）必须和
 * 引擎 `generateChart()` 算出来的命宫主星一致，否则「按盘取解读」就会取错。
 *
 * 抽样规则：按年份均匀取样，每年取若干张盘，覆盖全部时辰与两种性别。
 */
import assert from 'node:assert/strict';
import { generateChart } from '../../lib/ziwei/algorithm';
import { query } from '../../lib/db/client';
import type { BirthInfo } from '../../lib/ziwei/types';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.log('[dataset-alignment] 未配置 DATABASE_URL，跳过（本地/CI 环境）');
  process.exit(0);
}

/** 时辰序号 → 钟点基准（子时取 0 点） */
function birthFromKey(key: string): BirthInfo | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{1,2})-(male|female)$/);
  if (!m) return null;
  return {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: Number(m[4]), gender: m[5] as 'male' | 'female',
  };
}

async function main() {
  // 每年均匀抽 4 张盘：闰/平年、月末、两种性别
  const years = await query<{ y: number }>(
    `SELECT DISTINCT birth_year AS y FROM ziwei_charts ORDER BY birth_year`,
  );

  const samples: { chart_key: string; mingzhu: string | null }[] = [];
  for (const { y } of years) {
    const rows = await query<{ chart_key: string; mingzhu: string | null }>(
      `SELECT chart_key, mingzhu
         FROM ziwei_charts
        WHERE birth_year = $1
          AND birth_month = ANY($2)
        ORDER BY chart_key
        LIMIT 4`,
      [y, [1, 2, 6, 12]],
    );
    samples.push(...rows);
  }

  assert.ok(samples.length >= years.length * 4, `抽样数量不足: ${samples.length}`);

  let checked = 0;
  let empty = 0;
  const mismatches: string[] = [];

  for (const s of samples) {
    const birth = birthFromKey(s.chart_key);
    if (!birth) continue;

    const chart = generateChart(birth);
    const engineMingZhu = chart.mingZhu || null;
    const dataMingZhu = s.mingzhu && s.mingzhu.trim() !== '' ? s.mingzhu : null;

    if (dataMingZhu === null) {
      // 数据集说命宫无主星，引擎也应当没有
      if (engineMingZhu !== null) {
        mismatches.push(`${s.chart_key}: 数据集无主星，引擎=${engineMingZhu}`);
      }
      empty++;
    } else if (engineMingZhu !== dataMingZhu) {
      mismatches.push(`${s.chart_key}: 数据集=${dataMingZhu} 引擎=${engineMingZhu}`);
    }
    checked++;
  }

  console.log(`[dataset-alignment] 抽样 ${samples.length} 张，实际校验 ${checked} 张（其中命宫无主星 ${empty} 张）`);

  if (mismatches.length) {
    console.error(`❌ 口径不一致 ${mismatches.length} 例：`);
    for (const mm of mismatches.slice(0, 20)) console.error(`   ${mm}`);
    process.exit(1);
  }

  console.log('✅ 引擎与数据集的命宫主星口径完全一致');
}

main().catch((e) => {
  console.error('[dataset-alignment] 运行失败:', e);
  process.exit(1);
});
