import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres 连接池 —— 解读数据集 v4.0 的服务端访问入口。
 *
 * 连接串从环境变量 DATABASE_URL 读；未配置时返回 null，
 * 让「只排盘、不查解读」的纯前端场景照常工作（开源版引擎不需要数据库）。
 */

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (pool) return pool;

  const connString = process.env.DATABASE_URL;
  if (!connString) return null;

  pool = new Pool({
    connectionString: connString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is not configured');
  const res = await p.query<T>(text, params as never[]);
  return res.rows;
}
