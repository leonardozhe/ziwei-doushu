import type { BirthInfo } from './types';

/**
 * 出生信息 ⇄ URL 查询串互转。
 *
 * 让命盘可以靠链接直接打开和分享：
 *   /chart?y=1990&m=1&d=1&h=4&g=male
 *
 * h 是**时辰序号 0–11**（子=0 … 亥=11），与数据集口径一致，不是钟点。
 */

export interface BirthParams {
  y: number;
  m: number;
  d: number;
  h: number;
  g: 'male' | 'female';
}

export function birthToParams(b: BirthInfo): BirthParams {
  return { y: b.year, m: b.month, d: b.day, h: b.hour, g: b.gender };
}

export function paramsToBirth(p: BirthParams): BirthInfo {
  return { year: p.y, month: p.m, day: p.d, hour: p.h, gender: p.g };
}

/** 从 URL 的 search 参数解析出生信息；不合法返回 null */
export function parseBirthFromSearch(search: string | URLSearchParams): BirthInfo | null {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;

  const num = (k: string) => {
    const raw = sp.get(k);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  };

  const y = num('y');
  const m = num('m');
  const d = num('d');
  const h = num('h');
  const g = sp.get('g');

  if (y === null || m === null || d === null || h === null) return null;
  if (g !== 'male' && g !== 'female') return null;
  if (h < 0 || h > 11) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  return { year: y, month: m, day: d, hour: h, gender: g };
}

/** 把出生信息编码成查询串（不含 leading ?） */
export function birthToSearch(b: BirthInfo): string {
  const p = birthToParams(b);
  return new URLSearchParams({
    y: String(p.y), m: String(p.m), d: String(p.d), h: String(p.h), g: p.g,
  }).toString();
}
