import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type {
  ChatMessage,
  HealthResult,
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
  ToolSpec,
} from '../provider';

const log = createLogger('provider:openai-compatible');

/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * One implementation covers OpenAI, OpenRouter, Groq, Azure's compatible
 * surface, Ollama's `/v1` endpoint and any local llama.cpp / vLLM server,
 * because they all speak the same wire format (§21, §22).
 */

type WireToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type WireResponse = {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: WireToolCall[] };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string };
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly kind = 'openai_compatible' as const;

  constructor(
    readonly key: string,
    readonly baseUrl: string,
    private readonly apiKey: string | null,
    private readonly displayName: string,
  ) {}

  get isConfigured(): boolean {
    // Local endpoints frequently require no key, so "no key" does not mean
    // "not configured" for them. Reachability is decided by health().
    return Boolean(this.apiKey) || this.isLikelyLocal();
  }

  private isLikelyLocal(): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(this.baseUrl);
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async complete(options: ModelCallOptions): Promise<ModelCallResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: options.modelKey,
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.2,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool: ToolSpec) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    // Chain the caller's signal (run cancellation) onto ours.
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      // A local provider being switched off is an expected condition, not a bug.
      throw new AppError(
        'provider_offline',
        `Provider ${this.displayName} is unreachable at ${this.baseUrl}: ${message}`,
      );
    }
    clearTimeout(timeout);

    const text = await response.text();
    if (!response.ok) {
      const detail = safeErrorMessage(text) ?? `HTTP ${response.status}`;
      throw new AppError(
        response.status === 401 || response.status === 403 ? 'provider_unavailable' : 'provider_offline',
        `Provider ${this.displayName} returned ${response.status}: ${detail}`,
      );
    }

    let parsed: WireResponse;
    try {
      parsed = JSON.parse(text) as WireResponse;
    } catch {
      throw new AppError('provider_offline', `Provider ${this.displayName} returned a non-JSON response`);
    }

    const choice = parsed.choices?.[0];
    const toolCalls = (choice?.message?.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc, index) => ({
        id: tc.id ?? `call_${index}`,
        name: tc.function!.name!,
        arguments: safeParseArgs(tc.function?.arguments),
      }));

    const usage = parsed.usage ?? {};
    const result: ModelCallResult = {
      content: choice?.message?.content ?? null,
      toolCalls,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      },
      finishReason: choice?.finish_reason ?? null,
      durationMs: Date.now() - started,
      modelKey: options.modelKey,
    };

    if (result.usage.inputTokens === 0 && result.usage.outputTokens === 0) {
      // Local servers often omit usage. Record an estimate so cost tracking is
      // approximately right rather than silently zero.
      const approx = estimateTokens(options.messages);
      result.usage.inputTokens = approx.input;
      result.usage.outputTokens = estimateTokensFromString(result.content ?? '');
      log.debug('usage estimated — provider returned no token counts', { provider: this.key });
    }

    return result;
  }

  async health(timeoutMs = 8000): Promise<HealthResult> {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(this.url('/models'), {
        headers: this.headers(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - started;

      if (response.ok) {
        return { status: 'online', latencyMs, message: 'Reachable' };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: 'degraded',
          latencyMs,
          message: 'Reachable but the credential was rejected',
        };
      }
      return { status: 'degraded', latencyMs, message: `Responded with HTTP ${response.status}` };
    } catch (error) {
      return {
        status: 'offline',
        latencyMs: Date.now() - started,
        message: `Unreachable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
      };
    }
  }
}

function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function safeErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as WireResponse;
    return parsed.error?.message ?? null;
  } catch {
    return body.slice(0, 300) || null;
  }
}

/** Rough token estimate (~4 chars/token) used only when a provider omits usage. */
export function estimateTokens(messages: ChatMessage[]): { input: number } {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return { input: Math.ceil(chars / 4) };
}

export function estimateTokensFromString(text: string): number {
  return Math.ceil(text.length / 4);
}
