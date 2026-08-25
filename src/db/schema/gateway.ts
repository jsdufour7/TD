import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Multi-model gateway (§21, §22, §23, §42).
 *
 * Provider configuration is data, not code: adding a provider is a row, not a
 * deploy. Credentials are stored as opaque ciphertext and are never returned to
 * the browser — see src/lib/crypto.ts and SECURITY.md.
 */

/**
 * A secret reference. The plaintext lives either in an environment variable
 * (preferred) or in `ciphertext` (AES-256-GCM with AI_CORE_MASTER_KEY).
 * Nothing in this table is ever serialised to a client response.
 */
export const credentialReferences = pgTable(
  'credential_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** env | encrypted */
    source: text('source').notNull().default('env'),
    envVar: text('env_var'),
    ciphertext: text('ciphertext'),
    /** Present so the UI can prove a credential exists without revealing it. */
    fingerprint: text('fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('credential_name_idx').on(t.name)],
);

export const modelProviders = pgTable(
  'model_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable key, e.g. 'openai', 'anthropic', 'local-llama' */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** openai_compatible | anthropic */
    kind: text('kind').notNull().default('openai_compatible'),
    baseUrl: text('base_url').notNull(),
    credentialId: uuid('credential_id').references(() => credentialReferences.id, {
      onDelete: 'set null',
    }),
    /** A provider that only serves private data (local endpoints). */
    isLocal: boolean('is_local').notNull().default(false),
    /** Local / private traffic may leave the machine: false for local providers. */
    isPrivate: boolean('is_private').notNull().default(false),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** unknown | online | degraded | offline */
    healthStatus: text('health_status').notNull().default('unknown'),
    healthMessage: text('health_message'),
    healthLatencyMs: integer('health_latency_ms'),
    lastHealthAt: timestamp('last_health_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('provider_key_idx').on(t.key)],
);

export const modelDefinitions = pgTable(
  'model_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'cascade' }),
    /** The id sent on the wire, e.g. 'gpt-4o', 'claude-sonnet-4-5', 'local-model' */
    modelKey: text('model_key').notNull(),
    displayName: text('display_name').notNull(),
    contextLength: integer('context_length').notNull().default(8192),
    supportsTools: boolean('supports_tools').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    /** Reasoning tier used by the router: fast | balanced | strong */
    reasoningTier: text('reasoning_tier').notNull().default('balanced'),
    /** Coding tier: weak | capable | strong */
    codingTier: text('coding_tier').notNull().default('capable'),
    /** USD per 1M tokens; 0 for local models. */
    costInputPerMtok: text('cost_input_per_mtok').notNull().default('0'),
    costOutputPerMtok: text('cost_output_per_mtok').notNull().default('0'),
    /** Typical latency class: low | medium | high */
    latencyClass: text('latency_class').notNull().default('medium'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(100),
  },
  (t) => [index('models_provider_idx').on(t.providerId)],
);

/**
 * Routing policies (§23). Rows, not a hard-coded switch, so "today's best model"
 * can be changed without a deploy.
 */
export const modelRoutes = pgTable(
  'model_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FAST | BALANCED | BEST | LOCAL_ONLY | PRIVACY_FIRST | LOW_COST | CODING_MAX | MANUAL */
    policy: text('policy').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => modelDefinitions.id, { onDelete: 'cascade' }),
    /** Lower number wins. */
    priority: integer('priority').notNull().default(100),
    /** Extra predicates, e.g. { "requiresTools": true, "minContext": 32000 } */
    conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default({}),
    isEnabled: boolean('is_enabled').notNull().default(true),
  },
  (t) => [index('routes_policy_idx').on(t.policy, t.priority)],
);

/** Per-call usage and cost (§42). Local models record time with zero cost. */
export const modelUsages = pgTable(
  'model_usages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id'),
    runId: uuid('run_id'),
    agentInstanceId: uuid('agent_instance_id'),
    providerKey: text('provider_key').notNull(),
    modelKey: text('model_key').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    costUsd: text('cost_usd').notNull().default('0'),
    /** ok | error | timeout | offline */
    outcome: text('outcome').notNull().default('ok'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_run_idx').on(t.runId),
    index('usage_project_idx').on(t.projectId, t.createdAt),
    index('usage_model_idx').on(t.modelKey, t.createdAt),
  ],
);

/** Integration adapters (§44). Only the framework plus a real GitHub adapter now. */
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** github | vercel | cloudflare | local_fs */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** connected | not_configured | error */
    status: text('status').notNull().default('not_configured'),
    credentialId: uuid('credential_id').references(() => credentialReferences.id, {
      onDelete: 'set null',
    }),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    message: text('message'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integrations_key_idx').on(t.key)],
);

export type CredentialReference = typeof credentialReferences.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type ModelDefinition = typeof modelDefinitions.$inferSelect;
export type ModelRoute = typeof modelRoutes.$inferSelect;
export type ModelUsage = typeof modelUsages.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
