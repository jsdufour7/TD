import { hashPassword } from '../src/auth/password';
import { getDb, closeDb, schema } from '../src/db/client';
import { AGENT_CATALOG } from '../src/agents/catalog';
import { env } from '../src/lib/env';
import { encryptSecret, fingerprintSecret } from '../src/lib/crypto';
import { sql, eq } from 'drizzle-orm';

/**
 * First-run seeding.
 *
 * Everything written here is real platform configuration: the agent catalog, the
 * bootstrap administrator, model provider definitions and routing policies, and
 * default environments. It is idempotent — running it twice changes nothing.
 *
 * Demo *project* data is never written here. Demo projects are created only by
 * `npm run db:seed:demo`, which flags them with is_demo_data = true (§49).
 */

type ProviderSpec = {
  key: string;
  name: string;
  kind: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  envVar: string;
  isLocal: boolean;
  isPrivate: boolean;
  models: Array<{
    modelKey: string;
    displayName: string;
    contextLength: number;
    supportsTools: boolean;
    supportsVision: boolean;
    reasoningTier: 'fast' | 'balanced' | 'strong';
    codingTier: 'weak' | 'capable' | 'strong';
    costInput: string;
    costOutput: string;
    latencyClass: 'low' | 'medium' | 'high';
  }>;
};

function providerSpecs(): ProviderSpec[] {
  const specs: ProviderSpec[] = [];

  specs.push({
    key: 'openai',
    name: 'OpenAI',
    kind: 'openai_compatible',
    baseUrl: env.models.openai.baseUrl,
    apiKey: env.models.openai.apiKey,
    envVar: 'OPENAI_API_KEY',
    isLocal: false,
    isPrivate: false,
    models: [
      { modelKey: 'gpt-4o-mini', displayName: 'GPT-4o mini', contextLength: 128000, supportsTools: true, supportsVision: true, reasoningTier: 'fast', codingTier: 'capable', costInput: '0.15', costOutput: '0.60', latencyClass: 'low' },
      { modelKey: 'gpt-4o', displayName: 'GPT-4o', contextLength: 128000, supportsTools: true, supportsVision: true, reasoningTier: 'balanced', codingTier: 'strong', costInput: '2.50', costOutput: '10.00', latencyClass: 'medium' },
    ],
  });

  specs.push({
    key: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: env.models.anthropic.baseUrl,
    apiKey: env.models.anthropic.apiKey,
    envVar: 'ANTHROPIC_API_KEY',
    isLocal: false,
    isPrivate: false,
    models: [
      { modelKey: 'claude-3-5-haiku-latest', displayName: 'Claude 3.5 Haiku', contextLength: 200000, supportsTools: true, supportsVision: true, reasoningTier: 'fast', codingTier: 'capable', costInput: '0.80', costOutput: '4.00', latencyClass: 'low' },
      { modelKey: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', contextLength: 200000, supportsTools: true, supportsVision: true, reasoningTier: 'strong', codingTier: 'strong', costInput: '3.00', costOutput: '15.00', latencyClass: 'medium' },
    ],
  });

  specs.push({
    key: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai_compatible',
    baseUrl: env.models.openrouter.baseUrl,
    apiKey: env.models.openrouter.apiKey,
    envVar: 'OPENROUTER_API_KEY',
    isLocal: false,
    isPrivate: false,
    models: [
      { modelKey: 'deepseek/deepseek-chat-v3-0324', displayName: 'DeepSeek V3', contextLength: 163840, supportsTools: true, supportsVision: false, reasoningTier: 'balanced', codingTier: 'strong', costInput: '0.27', costOutput: '1.10', latencyClass: 'medium' },
    ],
  });

  if (env.models.local.baseUrl) {
    specs.push({
      key: 'local',
      name: 'Local (OpenAI-compatible)',
      kind: 'openai_compatible',
      baseUrl: env.models.local.baseUrl,
      apiKey: env.models.local.apiKey,
      envVar: 'LOCAL_MODEL_API_KEY',
      isLocal: true,
      isPrivate: true,
      models: [
        { modelKey: env.models.local.model, displayName: env.models.local.model, contextLength: 32768, supportsTools: false, supportsVision: false, reasoningTier: 'balanced', codingTier: 'capable', costInput: '0', costOutput: '0', latencyClass: 'high' },
      ],
    });
  }

  return specs;
}

async function main(): Promise<void> {
  const db = await getDb();

  // --- Organization -------------------------------------------------------
  const existingOrg = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, env.bootstrap.organizationSlug))
    .limit(1);

  let org = existingOrg[0];
  if (!org) {
    const [created] = await db
      .insert(schema.organizations)
      .values({ name: env.bootstrap.organizationName, slug: env.bootstrap.organizationSlug })
      .returning();
    org = created!;
    console.log(`+ organization ${org.slug}`);
  } else {
    console.log(`= organization ${org.slug}`);
  }

  // --- Bootstrap administrator -------------------------------------------
  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, env.bootstrap.email))
    .limit(1);

  if (existingUser[0]) {
    console.log(`= user ${env.bootstrap.email}`);
  } else {
    await db.insert(schema.users).values({
      organizationId: org.id,
      email: env.bootstrap.email,
      name: env.bootstrap.name,
      role: 'owner',
      passwordHash: hashPassword(env.bootstrap.password),
    });
    console.log(`+ user ${env.bootstrap.email} (owner)`);
  }

  // --- Agent catalog ------------------------------------------------------
  let created = 0;
  for (const agent of AGENT_CATALOG) {
    await db
      .insert(schema.agentDefinitions)
      .values({
        key: agent.key,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        systemInstructions: agent.systemInstructions,
        allowedTools: agent.allowedTools,
        permissions: agent.permissions,
        modelPolicy: agent.modelPolicy,
        temperature: agent.temperature,
        maxSteps: agent.maxSteps,
        maxConcurrency: agent.maxConcurrency,
        budgetTier: agent.budgetTier,
        accentColor: agent.accentColor,
        icon: agent.icon,
        sortOrder: agent.sortOrder,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: schema.agentDefinitions.key,
        set: {
          name: agent.name,
          role: agent.role,
          description: agent.description,
          systemInstructions: agent.systemInstructions,
          allowedTools: agent.allowedTools,
          permissions: agent.permissions,
          modelPolicy: agent.modelPolicy,
          temperature: agent.temperature,
          maxSteps: agent.maxSteps,
          maxConcurrency: agent.maxConcurrency,
          budgetTier: agent.budgetTier,
          accentColor: agent.accentColor,
          icon: agent.icon,
          sortOrder: agent.sortOrder,
        },
      });
    created += 1;
  }
  console.log(`+ agent definitions: ${created}`);

  // --- Model providers, models, credentials -------------------------------
  let providerCount = 0;
  const modelIdByPolicy: Record<string, string> = {};

  for (const spec of providerSpecs()) {
    // Credential reference — plaintext never stored, fingerprint only.
    let credentialId: string | null = null;
    if (spec.apiKey) {
      const [cred] = await db
        .insert(schema.credentialReferences)
        .values({
          name: `${spec.key}-api-key`,
          source: 'env',
          envVar: spec.envVar,
          ciphertext: encryptSecret(spec.apiKey),
          fingerprint: fingerprintSecret(spec.apiKey),
        })
        .onConflictDoUpdate({
          target: schema.credentialReferences.name,
          set: {
            source: 'env',
            envVar: spec.envVar,
            ciphertext: encryptSecret(spec.apiKey),
            fingerprint: fingerprintSecret(spec.apiKey),
          },
        })
        .returning();
      credentialId = cred!.id;
    }

    const [provider] = await db
      .insert(schema.modelProviders)
      .values({
        key: spec.key,
        name: spec.name,
        kind: spec.kind,
        baseUrl: spec.baseUrl,
        credentialId,
        isLocal: spec.isLocal,
        isPrivate: spec.isPrivate,
        // A provider with no credential is registered but disabled, and reports
        // itself as offline/unconfigured rather than pretending to work.
        isEnabled: Boolean(spec.apiKey) || spec.isLocal,
        healthStatus: 'unknown',
        healthMessage: spec.apiKey
          ? 'Not checked yet'
          : `No credential configured (set ${spec.envVar})`,
      })
      .onConflictDoUpdate({
        target: schema.modelProviders.key,
        set: {
          name: spec.name,
          kind: spec.kind,
          baseUrl: spec.baseUrl,
          credentialId,
          isLocal: spec.isLocal,
          isPrivate: spec.isPrivate,
          isEnabled: Boolean(spec.apiKey) || spec.isLocal,
        },
      })
      .returning();

    for (const model of spec.models) {
      const [inserted] = await db
        .insert(schema.modelDefinitions)
        .values({
          providerId: provider!.id,
          modelKey: model.modelKey,
          displayName: model.displayName,
          contextLength: model.contextLength,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
          reasoningTier: model.reasoningTier,
          codingTier: model.codingTier,
          costInputPerMtok: model.costInput,
          costOutputPerMtok: model.costOutput,
          latencyClass: model.latencyClass,
          isEnabled: provider!.isEnabled,
        })
        .returning();
      const label = `${spec.key}/${model.modelKey}`;
      // Remember the strongest candidate per tier for route defaults.
      if (model.reasoningTier === 'strong') modelIdByPolicy.BEST ??= inserted!.id;
      if (model.reasoningTier === 'fast') modelIdByPolicy.FAST ??= inserted!.id;
      if (model.codingTier === 'strong') modelIdByPolicy.CODING_MAX ??= inserted!.id;
      if (spec.isLocal) modelIdByPolicy.LOCAL_ONLY ??= inserted!.id;
      if (spec.isPrivate) modelIdByPolicy.PRIVACY_FIRST ??= inserted!.id;
      modelIdByPolicy.BALANCED ??= inserted!.id;
      modelIdByPolicy.LOW_COST ??= inserted!.id;
      void label;
    }
    providerCount += 1;
  }
  console.log(`+ model providers: ${providerCount}`);

  // --- Default routing policies ------------------------------------------
  let routeCount = 0;
  for (const [policy, modelId] of Object.entries(modelIdByPolicy)) {
    if (!modelId) continue;
    await db.insert(schema.modelRoutes).values({
      policy,
      modelId,
      priority: 100,
      conditions: {},
      isEnabled: true,
    });
    routeCount += 1;
  }
  console.log(`+ model routes: ${routeCount}`);

  // --- Integration registry ----------------------------------------------
  const integrationSpecs = [
    {
      key: 'github',
      name: 'GitHub',
      status: env.github.token ? 'connected' : 'not_configured',
      message: env.github.token ? 'Token present' : 'Set GITHUB_TOKEN to connect',
    },
    {
      key: 'local_fs',
      name: 'Local Filesystem / Dev Bridge',
      status: 'connected',
      message: 'Always available. Confined to the project sandbox.',
    },
    {
      key: 'vercel',
      name: 'Vercel',
      status: 'not_configured',
      message: 'Not implemented in V1 — see IMPLEMENTATION_STATUS.md',
    },
  ];
  for (const spec of integrationSpecs) {
    await db
      .insert(schema.integrations)
      .values({ key: spec.key, name: spec.name, status: spec.status, message: spec.message })
      .onConflictDoUpdate({
        target: schema.integrations.key,
        set: { name: spec.name, status: spec.status, message: spec.message },
      });
  }
  console.log(`+ integrations: ${integrationSpecs.length}`);

  const tableCount = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'`,
  );
  console.log(`seed complete. public tables: ${tableCount.rows?.[0]?.count ?? '?'}`);

  await closeDb();
}

main().catch(async (error) => {
  console.error('seed failed:', error);
  await closeDb();
  process.exit(1);
});
