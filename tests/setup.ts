import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Vitest setup — runs BEFORE any test module is imported.
 *
 * This ordering is load-bearing. `src/lib/env.ts` reads `process.env` once at
 * module-evaluation time and caches the result on globalThis, and it is pulled in
 * transitively by `@/db/client`. If these variables were set inside the test
 * harness instead, the import hoisting would evaluate `@/lib/env` first and the
 * overrides would be silently ignored — which is exactly what produced a
 * misleading `spawn npm ENOENT` (the runner resolved a sandbox cwd that did not
 * exist, and Node reports a bad cwd as an ENOENT on the command).
 *
 * Each Vitest fork gets its own temp root, so test files cannot collide.
 */

const root = mkdtempSync(path.join(tmpdir(), 'aicore-test-'));

process.env.APP_ENV = 'development';
process.env.DATABASE_DRIVER = 'pglite';
process.env.PGLITE_DATA_DIR = path.join(root, 'pglite');
process.env.AI_CORE_SANDBOX_ROOT = path.join(root, 'sandbox');
process.env.STORAGE_LOCAL_DIR = path.join(root, 'storage');
process.env.AI_CORE_MASTER_KEY = 'test-master-key-not-for-production';

// Never let a test start the background worker: tests drive the engine directly.
process.env.RUN_ENGINE_ENABLED = 'false';

// Make sure no ambient provider credentials leak into tests and change behaviour.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.LOCAL_MODEL_BASE_URL;

mkdirSync(process.env.AI_CORE_SANDBOX_ROOT!, { recursive: true });
mkdirSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true });
