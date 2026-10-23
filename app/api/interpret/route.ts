import { getPool } from '@/lib/db/client';
import { getReadings, type Topic } from '@/lib/db/readings';
import { resolveAiConfig, streamChat, AiUpstreamError, type ChatMessage } from '@/lib/ai/client';
import { buildMessages, pickGroundingTopics, type GroundingReading } from '@/lib/ai/chart-prompt';
import { apiError } from '@/lib/api/response';
import type { ZiweiChart } from '@/lib/ziwei/types';

/**
 * POST /api/interpret —— AI 命理解读（SSE 流式）
 *
 * 请求：{ chart: ZiweiChart, messages: {role, content}[] }
 * 响应：text/event-stream
 *   data: {"delta":{"text":"..."}}
 *   data: [DONE]
 *
 * 这是「追问」能力：命盘与断语库由服务端注入，前端只传盘和对话历史。
 * 模型看到的是
 *   1) 完整命盘结构（12 宫 / 四化 / 大限）
 *   2) 数据集 v4.0 里这张盘已定稿的 13 维断语（按问题选相关维度）
 * 因此回答不会脱离这张盘自由发挥。
 */

// 单进程内的简易限流：同一 IP 每分钟最多 N 次
const RATE_LIMIT = Number(process.env.AI_RATE_LIMIT_PER_MIN || 12);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

/** 校验 chart 是否具备必要的结构，避免把任意 JSON 塞进 prompt */
function isUsableChart(value: unknown): value is ZiweiChart {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<ZiweiChart>;
  return (
    !!c.birthInfo &&
    typeof c.birthInfo.year === 'number' &&
    typeof c.birthInfo.month === 'number' &&
    typeof c.birthInfo.day === 'number' &&
    typeof c.birthInfo.hour === 'number' &&
    (c.birthInfo.gender === 'male' || c.birthInfo.gender === 'female') &&
    Array.isArray(c.palaces) &&
    c.palaces.length === 12
  );
}

export async function POST(request: Request) {
  const config = resolveAiConfig();
  if (!config) {
    return apiError(
      'AI 解读未配置：请在 .env.local 设置 AI_BASE_URL / AI_API_KEY / AI_MODEL',
      503,
    );
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'local';
  if (rateLimited(ip)) {
    return apiError(`请求过于频繁，请稍后再试（每分钟上限 ${RATE_LIMIT} 次）`, 429);
  }

  let body: { chart?: unknown; messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError('invalid JSON body');
  }

  if (!isUsableChart(body.chart)) {
    return apiError('chart is missing or malformed');
  }
  const chart = body.chart;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return apiError('messages must be a non-empty array');
  }

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const raw of body.messages.slice(-20)) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as { role?: unknown; content?: unknown };
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > 4000) continue;
    history.push({ role: m.role, content });
  }
  if (!history.length) return apiError('no valid messages');

  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) return apiError('messages must contain a user turn');

  // ── 取该盘的断语库片段作为 grounding ──────────────
  let readings: GroundingReading[] = [];
  if (getPool()) {
    try {
      const { chartKey } = await import('@/lib/db/readings');
      const b = chart.birthInfo;
      const key = chartKey(b.year, b.month, b.day, b.hour, b.gender);
      const topics = pickGroundingTopics(lastUser.content);
      // 大限/流年类问题补上「针对你的命盘」这类运限维度没有单独 topic，
      // 数据集只有 13 个固定维度，这里按相关维度取。
      const rows = await getReadings(key, topics as Topic[]);
      readings = rows.map((r) => ({ topic: r.topic, content: r.content }));
    } catch (err) {
      // 断语库取不到不阻断：模型仍可基于命盘结构作答
      console.warn('[interpret] grounding unavailable:', err instanceof Error ? err.message : err);
    }
  }

  const messages: ChatMessage[] = buildMessages(chart, readings, history);

  // ── 流式转发 ────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        for await (const text of streamChat(config, messages)) {
          send({ delta: { text } });
        }
      } catch (err) {
        const message = err instanceof AiUpstreamError
          ? err.message
          : err instanceof Error ? err.message : 'AI 服务异常';
        console.error('[interpret] stream failed:', message);
        send({ error: message });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
