# AI Core — Architecture Decision Log

## ADR-001 · PostgreSQL via PGlite rather than a Postgres server

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** `apt-get` is blocked in this environment (npm registry only), so no
PostgreSQL or Redis server can be installed. The spec requires PostgreSQL as primary
persistence with real migrations and relational modelling.

**Decision.** Use PGlite — the real PostgreSQL engine compiled to WebAssembly — behind
the same Drizzle `pg-core` schema, selectable with `DATABASE_DRIVER=pglite|postgres`.

**Evidence.** Verified at audit time:
`PostgreSQL 18.3 (PGlite 0.5.7) on wasm32-unknown-linux-gnu, compiled by emcc 3.1.74`.

**Consequences.** Real SQL, relations, constraints, transactions and migrations today.
Moving to a hosted server later changes only `src/db/client.ts`. Accepted trade-off:
PGlite is single-connection and in-process, so this is a single-node deployment target.

**Rejected.** SQLite (would require a second dialect of the entire schema); JSON files
(explicitly forbidden by the spec for critical state).

---

## ADR-002 · Postgres-backed durable queue rather than BullMQ

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** Redis is unavailable. The spec asks for BullMQ "or a similarly dependable
job system".

**Decision.** `agent_runs.status = 'queued'` is the queue. An in-process worker claims
runs with `SELECT ... FOR UPDATE SKIP LOCKED` (plain read-then-update on single-connection
PGlite).

**Rationale.** The property the spec actually requires — a refresh or restart must not
lose a run — comes from keeping run state in the database, which is true regardless of
queue technology. Adding Redis would add an unavailable dependency without improving
durability.

**Consequences.** Multi-node deployment needs either Redis/BullMQ or a Postgres
advisory-lock claim. Documented in `ARCHITECTURE.md` §5 and `BACKLOG.md`.

---

## ADR-003 · Lazy boot instead of `instrumentation.ts`

**Date:** 2026-08-24 · **Status:** Accepted (forced by a verified failure)

**Context.** Next.js compiles `instrumentation.ts` for **both** the Node.js and edge
runtimes. The boot path reaches `node:path` transitively. The failure occurs at
module-evaluation time, so a `NEXT_RUNTIME !== 'nodejs'` guard inside `register()`
does not prevent it. Next 16.3.2 exposes no `instrumentation.node.ts` variant
(verified: `INSTRUMENTATION_HOOK_FILENAME = 'instrumentation'` is the only constant).

**Observed error.**
`Error: Failed to load external module node:path: TypeError: Native module not found: node:path`
with import trace `Edge Instrumentation: ./src/tools/platform-tools.ts → ./src/tools/index.ts
→ ./src/engine/agent-executor.ts → ./src/engine/run-engine.ts → ./src/instrumentation.ts`.
Every page returned HTTP 500.

**Decision.** Delete `instrumentation.ts`. `src/platform/boot.ts` exports an idempotent
`ensurePlatformReady()`, awaited from `getCurrentUser()` — the single chokepoint every
page and API route passes through.

**Consequences.** Boot happens on first request rather than at process start. Rejected
promises are cleared so a later request retries. A worker that fails to start does not
make the app unusable.

---

## ADR-004 · `proxy.ts` instead of `middleware.ts`

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** Next 16 renamed the middleware convention. Verified in
`node_modules/next/dist/lib/constants.js`: `PROXY_FILENAME = 'proxy'`, and having both
files is a hard build error. The export must be named `proxy` (verified in
`next/dist/build/templates/middleware.js`: `isProxy ? mod.proxy : mod.middleware`).

**Decision.** `src/proxy.ts` exporting `function proxy()`. Security headers only.

**Rationale for not authorizing here.** The proxy runs on the edge and cannot reach the
database or `node:crypto`, so it cannot validate a session token. Authorization lives in
`requireUser` / `requireProject`. Hidden UI is never the only control.

---

## ADR-005 · Hand-written provider adapters rather than the Vercel AI SDK

**Date:** 2026-08-24 · **Status:** Accepted

**Decision.** Implement `ModelProvider` directly for OpenAI-compatible and Anthropic
wire formats. The `ai` package was removed from `package.json`.

**Rationale.** The spec requires a clean provider abstraction where adding a provider is
a data change. A hand-written interface keeps `complete()` and `health()` exactly as the
router needs them, covers OpenAI/OpenRouter/Groq/Ollama/llama.cpp/vLLM with one
implementation, and avoids a large dependency whose abstractions we would mostly bypass.

---

## ADR-006 · Playwright loaded at runtime via `createRequire`

**Date:** 2026-08-24 · **Status:** Accepted (forced by a verified build failure)

**Context.** `playwright-core` lazily requires `chromium-bidi`, which is not installed.
The bundler resolves it eagerly and fails, including during the edge-instrumentation pass.

**Decision.** Load Playwright through `createRequire(import.meta.url)` with the module
name assembled at runtime, keeping it out of the static module graph. Also listed in
`serverExternalPackages`.

**Consequences.** Playwright becomes a genuinely optional runtime dependency. When it is
absent, `browserCapability()` reports that plainly and browser tools fail with a clear
message rather than crashing the platform.

---

## ADR-007 · Deterministic fallback rather than simulated intelligence

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** No model provider is reachable in this environment. The spec forbids
interfaces that look operational without real behaviour.

**Decision.** When no provider is reachable, `runDeterministic` performs the work that
is genuinely executable — running the project's own typecheck/lint/test/build commands
and recording true pass/fail — and marks reasoning-dependent tasks `blocked` with an
actionable reason. Deterministic planning emits `mode: 'deterministic'` so it is never
mistaken for model reasoning.

**Consequences.** The full loop is demonstrable and testable without an API key, and
nothing pretends to be an LLM. The cost is that code generation is unavailable until a
provider is configured.

---

## ADR-008 · Native ESLint flat config, no `FlatCompat`

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** `eslint-config-next@16.3.2` already exports a flat-config **array**
(verified: the root export is an array of `next`, `next/typescript`, `ignores`).
Routing it through `FlatCompat` made eslintrc's validator choke on the flat plugin
objects: `TypeError: Converting circular structure to JSON`.

**Decision.** Import `eslint-config-next/core-web-vitals` directly and spread it.
Removed the now-unused `@eslint/eslintrc` dependency.

**Additional finding.** `next/typescript` registers `@typescript-eslint` scoped to
`**/*.{ts,tsx}`. Declaring `@typescript-eslint/*` rules in an unscoped config object
applies them to `.mjs` files too, where the plugin is not registered, and ESLint fails
with "could not find plugin". Those rules are therefore file-scoped.

---

## ADR-009 · Test environment configured in a Vitest setup file

**Date:** 2026-08-24 · **Status:** Accepted

**Context.** `src/lib/env.ts` reads `process.env` once at module-evaluation time and
caches it on `globalThis`. Setting env vars inside the test harness had no effect,
because a hoisted import of `@/db/client` evaluates `@/lib/env` first. The symptom was
misleading: `spawn npm ENOENT`, because the runner resolved a sandbox `cwd` that did
not exist and Node reports a bad cwd as an ENOENT on the command.

**Decision.** `tests/setup.ts` (wired via `setupFiles`) sets the environment before any
test module is imported. The harness reads it rather than setting it.
