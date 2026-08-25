import { createLogger } from '@/lib/logger';

const log = createLogger('boot');

/**
 * Platform boot (§67 "START NOW" → make the product usable with zero setup).
 *
 * Why this is not `src/instrumentation.ts`:
 *
 * Next.js compiles `instrumentation.ts` for BOTH the Node.js and the edge
 * runtime. The boot path pulls in `@/db/bootstrap` → `@/lib/sandbox` →
 * `node:path`, and evaluating a Node builtin in the edge runtime fails hard:
 *
 *   Error: Failed to load external module node:path:
 *          TypeError: Native module not found: node:path
 *   Import trace:
 *     Edge Instrumentation:
 *       ./src/tools/platform-tools.ts
 *       ./src/tools/index.ts
 *       ./src/engine/agent-executor.ts
 *       ./src/engine/run-engine.ts
 *       ./src/instrumentation.ts
 *
 * A runtime guard inside `register()` does not help, because the failure is at
 * module-evaluation time — the bundler includes the graph regardless of whether
 * the code path runs. Next 16.3 exposes no `instrumentation.node.ts` variant, so
 * boot is instead performed lazily on the first Node-runtime request.
 *
 * The function is idempotent: concurrent callers share one promise, so
 * migrations run once and only one run-engine worker is started.
 */

const state = globalThis as unknown as { __aiCoreReady?: Promise<void> };

export function ensurePlatformReady(): Promise<void> {
  state.__aiCoreReady ??= boot();
  return state.__aiCoreReady;
}

async function boot(): Promise<void> {
  try {
    const { bootstrapDatabase } = await import('@/db/bootstrap');
    await bootstrapDatabase();
  } catch (error) {
    // Clear the cached rejection so the next request retries rather than
    // serving a permanently broken platform.
    state.__aiCoreReady = undefined;
    log.error('database bootstrap failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
    const { startRunWorker } = await import('@/engine/run-engine');
    startRunWorker();
  } catch (error) {
    // A worker that fails to start must not make the whole app unusable: the
    // UI can still show state, and the next request will try again.
    state.__aiCoreReady = undefined;
    log.error('run engine failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
