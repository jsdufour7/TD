/**
 * Model provider abstraction (§21).
 *
 * Business logic depends only on `ModelProvider`. Adding a provider means
 * implementing this interface and registering it — nothing else changes.
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present when role === 'tool'. */
  toolCallId?: string;
  name?: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolInvocation = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelCallOptions = {
  modelKey: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ModelCallResult = {
  content: string | null;
  toolCalls: ToolInvocation[];
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  finishReason: string | null;
  durationMs: number;
  modelKey: string;
};

export type HealthResult = {
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  message: string;
};

export interface ModelProvider {
  readonly key: string;
  readonly kind: 'openai_compatible' | 'anthropic';
  readonly baseUrl: string;
  /** True when the provider needs an API key that is currently missing. */
  readonly isConfigured: boolean;

  complete(options: ModelCallOptions): Promise<ModelCallResult>;
  /** Cheap reachability probe. Must never throw. */
  health(timeoutMs?: number): Promise<HealthResult>;
}

/** Estimate cost in USD from per-million-token prices. */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  costInputPerMtok: string,
  costOutputPerMtok: string,
): string {
  const inPrice = Number.parseFloat(costInputPerMtok) || 0;
  const outPrice = Number.parseFloat(costOutputPerMtok) || 0;
  const cost = (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice;
  return cost.toFixed(6);
}
