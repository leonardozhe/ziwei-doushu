import { getPool } from '@/lib/db/client';
import { apiOk } from '@/lib/api/response';

/**
 * GET /api/health —— 基础盘健康检查
 *
 * 报告：数据库连通性、已入库的命盘数与解读段数、数据集覆盖年份。
 */
export async function GET() {
  const pool = getPool();
  if (!pool) {
    return apiOk({
      status: 'degraded',
      database: 'not configured',
      note: 'DATABASE_URL is not set; chart generation works, interpretation lookup does not',
    });
  }

  try {
    const counts = await pool.query<{ charts: string; readings: string }>(
      `SELECT (SELECT count(*) FROM ziwei_charts)  AS charts,
              (SELECT count(*) FROM ziwei_readings) AS readings`,
    );
    const years = await pool.query<{ min_year: number; max_year: number; years: number }>(
      `SELECT min(birth_year) AS min_year, max(birth_year) AS max_year,
              count(DISTINCT birth_year) AS years
         FROM ziwei_charts`,
    );
    const version = await pool.query<{ content_version: string }>(
      `SELECT content_version FROM ziwei_charts LIMIT 1`,
    );

    return apiOk({
      status: 'ok',
      database: 'connected',
      charts: Number(counts.rows[0]?.charts ?? 0),
      readings: Number(counts.rows[0]?.readings ?? 0),
      yearRange: years.rows[0]
        ? { from: years.rows[0].min_year, to: years.rows[0].max_year, count: Number(years.rows[0].years) }
        : null,
      contentVersion: version.rows[0]?.content_version ?? null,
    });
  } catch (err) {
    return apiOk({
      status: 'error',
      database: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
