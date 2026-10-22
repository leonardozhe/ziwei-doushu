import { NextResponse } from 'next/server';

/** 统一 API 错误返回 */
export function apiError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** 统一 API 成功返回 */
export function apiOk<T extends Record<string, unknown>>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}
