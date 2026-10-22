import { generateChart } from '@/lib/ziwei/algorithm';
import type { BirthInfo } from '@/lib/ziwei/types';
import { apiError, apiOk } from '@/lib/api/response';

/**
 * POST /api/chart —— 服务端排盘
 *
 * 用开源排盘引擎把出生信息转成完整命盘 JSON。
 * 上游开源版的前端是纯浏览器排盘；这条路由把同一套引擎暴露成 API，
 * 方便国际化前端、移动端、第三方集成共用同一个排盘口径。
 */
export async function POST(request: Request) {
  let body: Partial<BirthInfo>;
  try {
    body = await request.json();
  } catch {
    return apiError('invalid JSON body');
  }

  const { year, month, day, hour, gender, name, province, city, longitude } = body;

  const missing = (['year', 'month', 'day', 'hour', 'gender'] as const).filter(
    (k) => body[k] === undefined || body[k] === null,
  );
  if (missing.length) return apiError(`missing fields: ${missing.join(', ')}`);
  if (gender !== 'male' && gender !== 'female') {
    return apiError("gender must be 'male' or 'female'");
  }

  const birthInfo: BirthInfo = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    gender,
    ...(name ? { name: String(name) } : {}),
    ...(province ? { province: String(province) } : {}),
    ...(city ? { city: String(city) } : {}),
    ...(longitude !== undefined ? { longitude: Number(longitude) } : {}),
  };

  try {
    const chart = generateChart(birthInfo);
    return apiOk({ chart });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRange = err instanceof RangeError;
    return apiError(message, isRange ? 400 : 500);
  }
}
