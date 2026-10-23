/**
 * OpenAI 兼容协议的流式客户端。
 *
 * 目标服务：任何兼容 `/v1/chat/completions` 且支持 `stream: true` 的端点，
 * 例如 199 服务器上的 uni-api 多模型网关（http://127.0.0.1:8010），
 * 或 DeepSeek / OpenAI / Moonshot 等官方 API。
 *
 * 注意：推理类模型（deepseek-v4 系列）会先流式输出 `reasoning_content`，
 * 再输出 `content`。这里只透传 `content`，避免把思考过程当正文展示。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
}

/**
 * 从环境变量解析模型配置。
 *
 * 优先级：
 *   1. AI_BASE_URL / AI_API_KEY / AI_MODEL（通用，推荐）
 *   2. AI_PROVIDER 对应的预设（deepseek / mimo / openai）
 *
 * 未配置时返回 null —— 上层据此返回 503，而不是抛未捕获异常。
 */
export function resolveAiConfig(): AiConfig | null {
  const generic = {
    baseUrl: process.env.AI_BASE_URL?.replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
  };
  if (generic.baseUrl && generic.apiKey && generic.model) {
    return {
      baseUrl: generic.baseUrl,
      apiKey: generic.apiKey,
      model: generic.model,
      timeoutMs: Number(process.env.AI_TIMEOUT_MS || 60_000),
    };
  }

  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  const presets: Record<string, { baseUrl: string; keyEnv: string; modelEnv: string; defaultModel: string }> = {
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      keyEnv: 'DEEPSEEK_API_KEY',
      modelEnv: 'DEEPSEEK_MODEL',
      defaultModel: 'deepseek-chat',
    },
    mimo: {
      baseUrl: process.env.MIMO_BASE_URL?.replace(/\/+$/, '') || '',
      keyEnv: 'MIMO_API_KEY',
      modelEnv: 'MIMO_MODEL',
      defaultModel: '',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      keyEnv: 'OPENAI_API_KEY',
      modelEnv: 'OPENAI_MODEL',
      defaultModel: 'gpt-4o-mini',
    },
  };

  const preset = presets[provider];
  if (!preset) return null;

  const apiKey = process.env[preset.keyEnv];
  const model = process.env[preset.modelEnv] || preset.defaultModel;
  if (!preset.baseUrl || !apiKey || !model) return null;

  return {
    baseUrl: preset.baseUrl,
    apiKey,
    model,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 60_000),
  };
}

/** 上游错误：带状态码，便于上层区分 4xx / 5xx */
export class AiUpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AiUpstreamError';
  }
}

/** 流式增量：区分「推演过程」与「正文」 */
export interface ChatDelta {
  type: 'reasoning' | 'content';
  text: string;
}

/**
 * 发起流式对话，逐个产出增量。
 *
 * 推理类模型（cc1/deepseek-v4.1-flash 等）会先流式输出 reasoning_content，
 * 7–14 秒后才开始输出正文。把推理过程也透传出去，前端就能立刻给出反馈，
 * 而不是让用户盯着空白等十几秒。
 *
 * 抛错时机：建立连接前抛 AiUpstreamError；
 * 流已开始后上游报错，则静默结束（已产出的内容仍有效）。
 */
export async function* streamChat(
  config: AiConfig,
  messages: ChatMessage[],
): AsyncGenerator<ChatDelta, void, unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: Number(process.env.AI_MAX_TOKENS || 2000),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new AiUpstreamError(timedOut ? 'AI 服务响应超时' : 'AI 服务连接失败', 504);
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    const detail = await response.text().catch(() => '');
    throw new AiUpstreamError(
      `AI 服务返回 ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      response.status >= 500 ? 502 : response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔；上游可能用 \n 或 \r\n
      let sepIndex: number;
      while ((sepIndex = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + (buffer[sepIndex] === '\r' ? 4 : 2));

        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let parsed: unknown;
          try { parsed = JSON.parse(payload); } catch { continue; }

          const delta = (parsed as {
            choices?: { delta?: { content?: string; reasoning_content?: string } }[];
          }).choices?.[0]?.delta;

          if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
            yield { type: 'reasoning', text: delta.reasoning_content };
          }
          if (typeof delta?.content === 'string' && delta.content) {
            yield { type: 'content', text: delta.content };
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
