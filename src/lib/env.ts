import path from 'node:path';

/**
 * Typed environment access. Everything AI Core reads from the process
 * environment is parsed here, once, so the rest of the codebase never touches
 * `process.env` directly and never guesses at a default.
 *
 * Server-only by construction: this module reads process.env and is imported
 * exclusively from server modules and route handlers. (Next 16 does not ship
 * the `server-only` marker package, so the boundary is enforced by convention
 * plus the fact that the sibling crypto module requires node:crypto.)
 */

function readString(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? undefined : raw;
  return value ?? fallback;
}

function readRequired(name: string, fallback: string, isProduction: boolean): string {
  const value = readString(name, fallback);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (isProduction && value === fallback && name === 'AI_CORE_MASTER_KEY') {
    throw new Error(
      'AI_CORE_MASTER_KEY must be set to a unique value in production. Refusing to start with the development default.',
    );
  }
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = readString(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readInt(name: string, fallback: number): number {
  const raw = readString(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolve(root: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

const APP_ROOT = process.cwd();

function build() {
  const appEnv = (readString('APP_ENV', 'development') ?? 'development') as
    | 'development'
    | 'production';
  const isProduction = appEnv === 'production';

  const driver = (readString('DATABASE_DRIVER', 'pglite') ?? 'pglite') as 'pglite' | 'postgres';

  const masterKey = readRequired(
    'AI_CORE_MASTER_KEY',
    // Deterministic development key. Only ever used when APP_ENV != production.
    'dev-only-master-key-do-not-use-in-production',
    isProduction,
  );

  return {
    appEnv,
    isProduction,
    isDevelopment: !isProduction,
    root: APP_ROOT,

    database: {
      driver,
      pgliteDataDir: resolve(APP_ROOT, readString('PGLITE_DATA_DIR', './.data/pglite')!),
      url: readString('DATABASE_URL'),
    },

    security: {
      masterKey,
      sessionCookieName: 'ai_core_session',
      /** 30 days. */
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    },

    bootstrap: {
      email: readString('AI_CORE_BOOTSTRAP_EMAIL', 'admin@twodots.local')!,
      password: readString('AI_CORE_BOOTSTRAP_PASSWORD', 'changeme-please')!,
      name: readString('AI_CORE_BOOTSTRAP_NAME', 'TwoDots Operator')!,
      organizationName: readString('AI_CORE_ORGANIZATION', 'TwoDots')!,
      organizationSlug: readString('AI_CORE_ORGANIZATION_SLUG', 'twodots')!,
    },

    storage: {
      driver: (readString('STORAGE_DRIVER', 'local') ?? 'local') as 'local' | 's3' | 'r2',
      localDir: resolve(APP_ROOT, readString('STORAGE_LOCAL_DIR', './.data/storage')!),
    },

    sandbox: {
      root: resolve(APP_ROOT, readString('AI_CORE_SANDBOX_ROOT', './.data/sandbox')!),
    },

    runEngine: {
      enabled: readBool('RUN_ENGINE_ENABLED', true),
      concurrency: readInt('RUN_ENGINE_CONCURRENCY', 2),
      /** Default wall-clock budget for a single run before it is marked failed. */
      runTimeoutMs: readInt('RUN_TIMEOUT_MS', 30 * 60 * 1000),
      /** Default per-command timeout. */
      commandTimeoutMs: readInt('COMMAND_TIMEOUT_MS', 5 * 60 * 1000),
      /** Poll interval for the worker when nothing is in flight. */
      pollIntervalMs: readInt('RUN_POLL_INTERVAL_MS', 1500),
    },

    models: {
      openai: {
        apiKey: readString('OPENAI_API_KEY'),
        baseUrl: readString('OPENAI_BASE_URL', 'https://api.openai.com/v1')!,
      },
      anthropic: {
        apiKey: readString('ANTHROPIC_API_KEY'),
        baseUrl: readString('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')!,
      },
      openrouter: {
        apiKey: readString('OPENROUTER_API_KEY'),
        baseUrl: readString('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')!,
      },
      local: {
        baseUrl: readString('LOCAL_MODEL_BASE_URL'),
        apiKey: readString('LOCAL_MODEL_API_KEY'),
        model: readString('LOCAL_MODEL_NAME', 'local-model')!,
      },
    },

    github: {
      token: readString('GITHUB_TOKEN'),
    },
  };
}

export type Env = ReturnType<typeof build>;

const globalEnv = globalThis as unknown as { __aiCoreEnv?: Env };

export const env: Env = globalEnv.__aiCoreEnv ?? (globalEnv.__aiCoreEnv = build());

/**
 * Masks anything that looks like a credential before it can reach a log line or
 * an API response. Applied by the logger and by every error path.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(sk|pk|ghp|gho|github_pat|xox[baprs])-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, '$1[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');
}
