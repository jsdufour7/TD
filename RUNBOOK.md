# AI Core — Runbook

## 1. Prerequisites

* Node.js >= 22 (verified on v22.22.3)
* npm (verified 10.9.8)

No PostgreSQL, Redis or Docker install is required: the embedded engine is PGlite.

## 2. First run

```bash
cp .env.example .env.local
# Set a real master key:
printf 'AI_CORE_MASTER_KEY=%s\n' "$(openssl rand -hex 32)" >> .env.local

npm install
npm run db:migrate      # applies drizzle/*.sql to .data/pglite
npm run db:seed         # agent catalog, providers, routes, integrations
npm run dev             # http://localhost:3000
```

`npm run dev` also self-bootstraps on the first request (migrations, admin user,
agent catalog, worker) via `src/platform/boot.ts`, so a bare `npm run dev` works too.
Running `db:migrate` / `db:seed` explicitly is still recommended so you see the output.

Default administrator: `admin@twodots.local` / `changeme-please`
(override with `AI_CORE_BOOTSTRAP_EMAIL` / `AI_CORE_BOOTSTRAP_PASSWORD`).

## 3. Verification gate

```bash
npm run verify    # typecheck + lint + test + build
```

Individually:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # eslint flat config
npm test            # vitest: 54 cases, real embedded database
npm run build       # next build
```

Current status: typecheck 0 errors · lint clean · 54/54 tests · build 44 routes.

## 4. Everyday commands

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Production start | `npm run build && npm start` |
| New migration | `npm run db:generate` then `npm run db:migrate` |
| Inspect the schema | `npm run db:studio` |
| Seed catalog only | `npm run db:seed` |
| Run one test file | `npx vitest run tests/integration/run-lifecycle.test.ts` |
| Watch tests | `npm run test:watch` |

## 5. Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_DRIVER` | `pglite` or `postgres` | `pglite` |
| `PGLITE_DATA_DIR` | Embedded database location | `./.data/pglite` |
| `DATABASE_URL` | Required when driver is `postgres` | — |
| `AI_CORE_MASTER_KEY` | Credential encryption + session signing | dev default (refused in production) |
| `AI_CORE_SANDBOX_ROOT` | Root of all project sandboxes | `./.data/sandbox` |
| `STORAGE_LOCAL_DIR` | Artifact/screenshot storage | `./.data/storage` |
| `RUN_ENGINE_ENABLED` | Master switch for the worker | `true` |
| `RUN_ENGINE_CONCURRENCY` | Simultaneous runs | `2` |
| `COMMAND_TIMEOUT_MS` | Per-command timeout | `300000` |
| `LOCAL_MODEL_BASE_URL` | Local OpenAI-compatible endpoint | — |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | Hosted providers | — |
| `GITHUB_TOKEN` | GitHub integration | — |

`.env.local` is gitignored. Never commit it.

## 6. Enabling a model provider

Without a provider, AI Core plans deterministically, runs the project's own
verification commands, and marks reasoning tasks `blocked`.

```bash
# Option A — hosted
OPENAI_API_KEY=sk-... 

# Option B — local, no account needed (llama.cpp, vLLM, Ollama /v1)
LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL_NAME=local-model
```

Then open **Models → Check health**. A provider shows `online`, `degraded` or
`offline`. `LOCAL_ONLY` routing never falls back to a hosted provider.

## 7. Enabling browser verification

```bash
npx playwright install chromium
```

If the download is blocked, `browserCapability()` reports that plainly and browser
tools fail with a clear message instead of pretending to succeed.

## 8. Troubleshooting

### ⚠ PGlite allows only ONE process per data directory

Never run `db:migrate`, `db:seed`, `db:studio`, **`npm run build`** or an ad-hoc DB
script while the dev server is running. A second process opening `.data/pglite` aborts
the WASM instance and leaves the directory inconsistent; the symptom is every query
failing with:

```
Failed query: select … from "users" …
cause: RuntimeError: Aborted(). Build with -sASSERTIONS for more info.
```

Recovery (dev data only — no source or schema is lost):

```bash
# stop the dev server first
rm -rf .data
npm run db:migrate && npm run db:seed
npm run dev
```

`npm run build` used to be an unnoticed offender: it prerendered `/`, which calls
`getCurrentUser()` → `ensurePlatformReady()` → `bootstrapDatabase()` and so opened the
data directory. `src/app/page.tsx` is now `export const dynamic = 'force-dynamic'`, so the
build no longer touches the database at all. Any new page that reads the session must set
the same, or the build will reintroduce this.

`npm test` is safe alongside a running server: `tests/setup.ts` provisions a separate
temporary database per run.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in appears to do nothing; login 200 then `/home` 307 | `SameSite=Lax` cookie is not sent from the cross-site preview iframe | Already fixed — cookie is `SameSite=None; Secure` over HTTPS. See BUGS.md B-14 |
| Every query fails with `RuntimeError: Aborted()` | A second process opened `.data/pglite` | See the warning above |
| Every page 500 with `Native module not found: node:path` | A Node-only module reached the edge bundle | Do not re-add `src/instrumentation.ts`; use `src/platform/boot.ts`. See ADR-003 |
| Both middleware and proxy file are detected | Next 16 forbids both | Keep only `src/proxy.ts` exporting `function proxy` |
| `npm error Missing script: "tsc --noEmit"` | Script *command* passed where the *name* belongs | Pass `['run', <scriptName>]`. Regression-tested |
| `spawn npm ENOENT` in tests | Env set after `@/lib/env` cached it; cwd did not exist | Configure env in `tests/setup.ts`. See ADR-009 |
| `Converting circular structure to JSON` from ESLint | `FlatCompat` around an already-flat config | Import `eslint-config-next/core-web-vitals` directly |
| `Can't resolve 'chromium-bidi/...'` at build | Bundler eagerly resolving a lazy optional dep | Keep Playwright behind runtime `createRequire` |
| Client bundle 403s from the preview host | Next 16 blocks cross-origin `/_next/*` dev resources | `allowedDevOrigins` in `next.config.ts`. See BUGS.md B-12 |
| Run stuck in `running` after a crash | Process died mid-run | Automatic: `recoverStalledRuns()` re-queues on boot and emits `run.recovered` |
| Dev server will not stop | Live-process map entry missing | Use `stopProjectDevServers` / `DELETE /api/projects/:id/commands?commandId=` |

## 9. Resetting local state

```bash
rm -rf .data          # embedded database, sandboxes, artifacts
npm run db:migrate && npm run db:seed
```

This deletes all local projects, runs and memories. It does not touch source code.

## 10. Deploying

Not implemented. `deploy` records an explicit error rather than simulating success.
See `BACKLOG.md`.
