# AI Core — Session Log

Concise, factual record of autonomous development. One entry per meaningful milestone.

## 2026-08-24

### Phase 0 — Repository audit
Inspected `/home/user/TD`: **1 commit, 0 tracked files**. Nothing to recover; the
`RECOVER AND EXTEND` rule had nothing to act on. Probed the environment rather than
assuming it: Node 22.22.3, npm reachable, **no** PostgreSQL / Redis / Docker, and
`apt-get` blocked (npm registry only). Confirmed PGlite runs a genuine engine:
`PostgreSQL 18.3 (PGlite 0.5.7) … compiled by emcc 3.1.74`. Wrote `AUDIT_PHASE0.md`.

### Foundation
Next.js 16.3.2 + TypeScript strict + Tailwind 4. Authored 39 domain tables against
Drizzle `pg-core`; generated `drizzle/0000_init.sql`; wrote a driver-agnostic migrator.
Verified: 40 public tables after migration; seed produced 13 agents, 3 providers,
5 routes, 3 integrations.

### Gateway, engine, tools
Implemented provider adapters (OpenAI-compatible, Anthropic), credential encryption,
the policy router with health caching, the context assembler with provenance, the run
engine with checkpoints and recovery, the planner (LLM + deterministic), the agent
executor with safety limits, and 26 registered tools behind a permissioned registry.

### UI
19 pages + 22 API routes: command center, project workspace with 10 surfaces, workbench
with live SSE feed, task board, diff review, terminal history, preview frame, agents,
runs, models, approvals, settings.

### Bug fixing from real execution
Ran the application and found failures that compilation had not caught. Each is recorded
in `BUGS.md` with cause and fix. The significant ones:

* Every page 500 — `instrumentation.ts` pulled `node:path` into the **edge** bundle.
  Replaced with lazy boot (ADR-003).
* `middleware.ts` deprecated in Next 16 → `src/proxy.ts` exporting `function proxy` (ADR-004).
* `npm run "tsc --noEmit"` — passed a script's *command* where npm needs its *name*.
  Fixed and regression-tested.
* Drizzle conditions joined with `&&` silently dropped a filter.
* Playwright broke the build via an uninstalled optional dep → runtime `createRequire`.
* Cross-project lookups returned 500 instead of 404/403.
* ESLint could not start: `FlatCompat` around an already-flat config (ADR-008).

### Test suite
Built a harness that provisions a real disposable PostgreSQL database per test file.
First run: 50/54. Diagnosed the 4 failures individually instead of relaxing assertions:

* Harness env overrides were ignored (`@/lib/env` caches `process.env` at import time),
  producing a misleading `spawn npm ENOENT`. Fixed with a Vitest `setupFiles`.
* `planRun` did not checkpoint. Added it — planning is a phase worth recovering from.
* Two assertions were wrong about the product, not vice versa: `argv` is stored as the
  full command line (`["npm","run","typecheck"]`), and a run is created `paused` when no
  worker is enabled. Both corrected to assert the real contract.

Final: **54/54 passing**.

### Runtime verification (HTTP, against the running app)
* Auth: `/login` 200 · wrong password 401 · correct login 200 + session cookie ·
  unauthenticated API 401.
* Project creation: 201, sandbox directory created, canonical memory seeded,
  instruction stored.
* Repository inspection: `fileCount: 4`, `languages: {TypeScript: 2}`,
  `scripts: [typecheck, test]`, `git branch: main`, honest warnings.
* Autonomous run: reached `completed` — 5 tasks, 29 events, `2/2 project checks passed`,
  both commands `exit=0`.
* Failure honesty: a deliberately broken fixture produced `failed` and
  `0/2 project checks passed` — it did not claim success.
* Isolation: project A's run/events/memory/files/tasks/changes are invisible under
  project B, and A's run remained `completed`.
* Path traversal: `../../../etc/passwd` and `/etc/passwd` both rejected with 400.

### Documentation
Wrote `AI_CORE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `BACKLOG.md`,
`DECISIONS.md` (9 ADRs), `BUGS.md`, `SECURITY.md`, `RUNBOOK.md`, `SESSION_LOG.md`,
`loop-state.json`.

### Gate
`npm run verify` → exit 0: typecheck 0 errors · lint clean · 54/54 tests ·
build 44 routes.

### Next
P0-1 in `BACKLOG.md`: exercise the LLM agent loop against a real provider, which is the
only thing standing between the current state and the §52 release gate.
