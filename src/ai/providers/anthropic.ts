import { AppError } from '@/lib/errors';
import type {
  HealthResult,
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../provider';

/**
 * Anthropic Messages API adapter. Kept separate from the OpenAI-compatible
 * adapter because the wire format differs (system is a top-level field, tool
 * calls arrive as content blocks).
 */

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  error?: { message?: string };
};

export class AnthropicProvider implements ModelProvider {
  readonly kind = 'anthropic' as const;

  constructor(
    readonly key: string,
    readonly baseUrl: string,
    private readonly apiKey: string | null,
    private readonly displayName: string,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    };
  }

  async complete(options: ModelCallOptions): Promise<ModelCallResult> {
    if (!this.apiKey) {
      throw new AppError('provider_unavailable', `Provider ${this.displayName} has no API key configured`);
    }

    const started = Date.now();
    const system = options.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const conversation = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const body: Record<string, unknown> = {
      model: options.modelKey,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.2,
      messages: conversation,
    };
    if (system) body.system = system;
    if (options.tools?.length) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new AppError(
        'provider_offline',
        `Provider ${this.displayName} unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    clearTimeout(timer);

    const text = await response.text();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        detail = (JSON.parse(text) as AnthropicResponse).error?.message ?? detail;
      } catch {
        /* keep the status line */
      }
      throw new AppError(
        response.status === 401 || response.status === 403 ? 'provider_unavailable' : 'provider_offline',
        `Provider ${this.displayName} returned ${response.status}: ${detail}`,
      );
    }

    const parsed = JSON.parse(text) as AnthropicResponse;
    const blocks = parsed.content ?? [];
    const content = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const toolCalls = blocks
      .filter((b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));

    return {
      content: content.length > 0 ? content : null,
      toolCalls,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cachedTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      },
      finishReason: parsed.stop_reason ?? null,
      durationMs: Date.now() - started,
      modelKey: options.modelKey,
    };
  }

  async health(timeoutMs = 8000): Promise<HealthResult> {
    if (!this.apiKey) {
      return { status: 'offline', latencyMs: 0, message: 'No API key configured' };
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // A minimal 1-token call is the cheapest reliable reachability check;
      // Anthropic has no unauthenticated status endpoint.
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      if (response.ok) return { status: 'online', latencyMs, message: 'Reachable' };
      if (response.status === 401 || response.status === 403) {
        return { status: 'degraded', latencyMs, message: 'Reachable but the credential was rejected' };
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
