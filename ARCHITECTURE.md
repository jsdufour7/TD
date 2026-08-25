# AI Core — Architecture

Last verified: 2026-08-24 · 102 source files · ~16.8k lines in `src/`

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16.3.2, App Router, Turbopack | Required by the spec; server components for data-dense views |
| Language | TypeScript strict (`noUncheckedIndexedAccess`, `noImplicitOverride`) | Domain types are the contract between engine and UI |
| Styling | Tailwind CSS 4, CSS-first `@theme` tokens | Design tokens are semantic (`surface`, `ink`, `ok`, `danger`), not decorative |
| Persistence | PostgreSQL via Drizzle ORM on `pg-core` | Real relational model; dialect chosen once |
| Driver | PGlite locally, node-postgres in production | See §4 |
| Events | Server-Sent Events derived from `run_events` | Survives refresh; resumable with `?after=<seq>` |
| Jobs | Postgres-backed durable queue + in-process worker | No Redis available in this environment; see §5 |
| Validation | Zod at every API boundary and every tool input | One schema, used for parsing and for the tool manifest |

## 2. Module boundaries

```
src/
  app/            HTTP surface: 19 pages + 22 API routes. No business logic.
  auth/           Session, password hashing, authorization guards.
  platform/       Lazy boot: migrations + run-engine worker on first request.
  db/             schema/ (39 tables), client (driver selection), bootstrap.
  domain/         Shared domain types.
  ai/             providers/ (openai-compatible, anthropic), router, credentials.
  agents/         catalog.ts — the 13 role definitions.
  engine/         run-engine, planner, agent-executor, checkpoints,
                  command-runner, events, tool-context.
  tools/          26 registered tools + registry/invocation path.
  context/        Context assembly with per-section token budgets.
  repo/           Repository inspection (read-only).
  memory/         (reserved) retrieval strategies.
  lib/            env, crypto, logger, errors, sandbox, audit, api, ui.
  components/     ui/ primitives, layout/, work/ interactive surfaces.
```

Dependency direction is one-way: `app → engine → tools → lib`. The engine never
imports from `app`. Tools never import from the engine except through the
`ToolContext` they are handed, which is what keeps them testable in isolation.

## 3. Persistence

Drizzle schema is authored against `drizzle-orm/pg-core`. Migrations are generated
by `drizzle-kit` into `drizzle/*.sql` and applied by `scripts/migrate.ts`, which
walks `drizzle/meta/_journal.json` and records applied tags in
`__ai_core_migrations`. The same migrator runs at boot (`src/db/bootstrap.ts`) and
from the CLI (`npm run db:migrate`), so there is one code path for schema changes.

## 4. Why PGlite rather than a PostgreSQL server

`apt-get` is blocked in this environment (npm registry only), so no PostgreSQL
server can be installed. PGlite is the **real PostgreSQL engine** compiled to
WebAssembly — verified at audit time:

```
PostgreSQL 18.3 (PGlite 0.5.7) on wasm32-unknown-linux-gnu, compiled by emcc 3.1.74
```

That means real SQL, relations, constraints, transactions and migrations. Because
the schema is `pg-core`, moving to a hosted server is a driver flag
(`DATABASE_DRIVER=postgres`), not a rewrite. Only `src/db/client.ts` changes.

Trade-off accepted: PGlite is single-connection and in-process. It is a development
and single-node deployment target, not a horizontally scaled one.

## 5. Why a Postgres queue rather than BullMQ

Redis is unavailable. More importantly, the property the spec actually requires —
"a browser refresh must not erase the run" — comes from keeping run state in the
database, which we do regardless of queue technology.

`agent_runs.status = 'queued'` is the queue. The worker claims with
`SELECT ... FOR UPDATE SKIP LOCKED` on PostgreSQL (plain read-then-update on
PGlite, which is single-connection). On boot, `recoverStalledRuns()` re-queues
anything left `running` or `queued` by a previous process and emits
`run.recovered`, so the orchestrator continues from its checkpoint instead of
re-planning.

## 6. Boot sequence

Next.js compiles `instrumentation.ts` for **both** the Node.js and edge runtimes.
The boot path reaches `node:path` transitively, which cannot be evaluated on the
edge, and a runtime guard does not help because the failure happens at
module-evaluation time. Next 16.3 exposes no `instrumentation.node.ts`.

So boot is lazy: `src/platform/boot.ts` exports an idempotent
`ensurePlatformReady()`, awaited from `getCurrentUser()` — the single chokepoint
every page and API route passes through. It applies migrations, seeds the agent
catalog and starts the worker exactly once.

## 7. Request path

```
Request → src/proxy.ts (security headers, edge)
        → route handler / server component
        → requireUser() → ensurePlatformReady()
        → requireProject() (organisation-scoped query; 403 on mismatch)
        → service/engine
        → Drizzle → PostgreSQL
```

Authorization is server-side only. The proxy cannot validate a session (no
database, no `node:crypto` on the edge) and deliberately does not try.

## 8. Run engine

`createRun` writes `goals` + `agent_runs` and emits `run.created`. The worker
claims the run and walks the lifecycle:

```
planRun()            → inspect repository (read-only)
                     → LLM planning via COO create_task, else deterministic plan
                     → writeCheckpoint('plan-complete')
loop readyTasks()    → executeTask() per task
                     → writeCheckpoint(task-…)
  on failure         → phase=repair, re-queue if attempts remain,
                       record a working memory so the same approach is not retried
finaliseRun()        → summarise from recorded tasks/changes/tests
                     → record execution memory, notify the user
```

`readyTasks()` releases a task only when every dependency is `completed`,
`blocked` or `cancelled`. A blocked dependency does not deadlock the graph.

## 9. Agent execution loop

`executeTask` builds context, then loops up to the agent's `maxSteps`:

```
callModel(tools)  → no tool calls?  → final summary, done
                  → tool calls?     → invokeTool each, append results, repeat
```

Safety limits (§19 of the spec): step ceiling, 15-minute wall clock, repeated-error
detection (3 identical failures → escalate), no-progress detection (4 steps without
a successful tool call → escalate).

When no model provider is reachable, `runDeterministic` takes over. It does the
work that is genuinely executable — running the project's own typecheck, lint,
test and build commands and recording true pass/fail — and marks reasoning-dependent
tasks `blocked` with an actionable reason. It never fabricates an implementation.

## 10. Context assembly

`assembleContext()` composes a prompt from: agent instructions, project identity,
project instructions, selected memory, goal/task with acceptance criteria,
repository summary, caller-supplied file excerpts and prior tool outcomes.

Each section has a token budget and over-budget sections are trimmed head+tail.
The result carries **provenance** — which sections were included, how many tokens
each consumed, what was trimmed — emitted as a `context.assembled` event so a bad
context decision can be diagnosed rather than guessed at.

Memory is retrieved selectively: canonical, decision and preference memory are
always candidates; working and execution memory are only pulled when a task is
active.

## 11. Event transport

`emitAndNotify()` inserts into `run_events` with `seq` allocated inside the INSERT
(`SELECT COALESCE(MAX(seq),0)+1`), then notifies in-process SSE subscribers.
Clients reconnect with `?after=<seq>` and receive everything they missed, so the
feed is gap-free and duplicate-free across refreshes.

## 12. Known architectural limits

* PGlite is single-connection and in-process — single-node only.
* The worker is in-process; a multi-node deployment needs Redis/BullMQ or a
  Postgres advisory-lock based claim.
* Sandbox isolation is path-confinement, not containers. See `SECURITY.md`.
* Semantic retrieval is modelled (`knowledge_items.embedding`) but not wired.

## Executive runtime (added)

`objectives` (intention, autonomie, critères) and `plans` (stratégie versionnée) sit
above the existing `goals`/`tasks`/`runs`. Tasks and runs carry `objectiveId` /
`planId` / `createdByType`, so a directive decomposes top-down while all prior
functionality is preserved.

- `src/engine/objectives.ts` — objective state machine; illegal transitions throw.
- `src/engine/coo.ts` — classifies intent (question vs operational), then creates
  objective + plan + dependency-linked tasks and hands the run to the existing engine.
- Autonomy modes: `manual` (advise only), `approval`, `autonomous`, `mission`.
- Voice: push-to-talk feeds the **same** COO thread; browser engines are the free
  default, `/api/voice/*` proxies local whisper/Kokoro as an upgrade.
