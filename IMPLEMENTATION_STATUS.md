# AI Core — Implementation Status

Last verified: 2026-08-24 · Branch: `arena/01a034bd-td` · Commit base: `340aca5`

Every claim below was checked by running something in this session. The verification
commands and their results are in §9.

## 1. Verification gate

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Lint | `npm run lint` | **clean** (exit 0) |
| Tests | `npm test` | **54 passed / 54** (4 files) |
| Production build | `npm run build` | **compiled successfully**, 44 routes |
| Combined | `npm run verify` | **exit 0** |

Build emits 5 Turbopack tracing warnings, all in `src/lib/sandbox.ts` and
`src/repo/inspect.ts` — the two modules whose job is runtime filesystem traversal.
Informational, not errors.

## 2. Scale

| Metric | Count |
| --- | --- |
| Source files (`src/**`) | 102 |
| Lines in `src/` | ~16,800 |
| Domain tables | 39 |
| API routes | 22 |
| Pages | 19 (44 routes total with API) |
| Registered tools | 26 |
| Agent definitions | 13 |
| Test files / cases | 4 / 54 |

## 3. Implemented and verified end-to-end

These were exercised against the running application, not just compiled.

| Capability | Evidence |
| --- | --- |
| Auth: login, session cookie, rejection | `/login` 200; wrong password 401; correct login 200 + `ai_core_session` cookie; unauthenticated `/api/projects` 401 |
| Project creation + sandbox + canonical memory + instructions | `POST /api/projects` 201; sandbox dir created; `total memories: 1`; instruction stored |
| Repository inspection (read-only) | `fileCount: 4`, `languages: {TypeScript: 2}`, `scripts: [typecheck, test]`, `git branch: main`, honest warnings for missing README/test framework |
| Autonomous run: plan → tasks → execute → verify → remember | Run reached `completed`; 5 tasks; 29 events; `2/2 project checks passed`; `exit=0` for both commands |
| Real verification with true results | `typecheck 1/1 passed`, `test 1/1 passed`; `argv: ["npm","run","typecheck"]` |
| Truthful failure reporting | With a broken fixture the run reported `failed` and `0/2 project checks passed` — it did not claim success |
| Retry / repair loop | A failing task was re-queued; 6 test-run rows across 3 attempts; a working memory recorded so the same approach is not retried |
| Deterministic planning (no model) | `mode: deterministic`, dependency-ordered task graph |
| Blocked-with-reason (no model) | Reasoning tasks marked `blocked` with an actionable message naming `LOCAL_MODEL_BASE_URL` |
| Project isolation | Run/events/memory/files/tasks/changes of A are invisible under B; A's run still `completed` afterwards |
| Path traversal defence | `../../../etc/passwd` → 400 `path_escape`; absolute `/etc/passwd` → 400 |
| Live SSE feed | Stream delivers real events; resumable via `?after=<seq>` |
| Model gateway data | 3 providers, 5 routes, credential fingerprints only (no plaintext) |
| Approval system | Queue + approve/reject/edit endpoints; run parks as `waiting_for_approval` |

## 4. Implemented but not exercisable here

| Capability | Status | Why |
| --- | --- | --- |
| LLM agent tool loop | **Implemented, unverified** | Code path complete (`runWithModel`), but no model provider is configured and no local endpoint is reachable in this sandbox. Unit-tested surfaces only. |
| Browser verification | **Implemented, runtime absent** | Real Playwright code. `npx playwright install chromium` is blocked (npm registry only) and no system browser exists. `browserCapability()` reports this honestly. |
| Live preview | **Partial** | Dev-server URL detection and embedded iframe work; console/network error capture needs the browser runtime above. |
| E2E Playwright specs | **Not runnable** | Same blocker. Specs are written but cannot execute. |

## 5. Not implemented

| Capability | Behaviour today |
| --- | --- |
| Deployment adapters (Vercel, Cloudflare) | `deploy` tool records an explicit `error` result rather than faking success |
| Executive runtime (Objectives/Plans) | **Implemented** this session: objectives + versioned plans + task/run linkage, validated state machine, 4 autonomy modes |
| COO autonomous loop | **Implemented & verified**: a high-level directive creates objective → plan → tasks (deps) → run and executes via the existing engine without asking the user |
| Voice (push-to-talk) | **Scaffolded & honest**: browser STT/TTS (free/local) wired to the same COO thread; `/api/voice/transcribe|synthesize` proxy local whisper/Kokoro when configured, else report unavailable |
| Chat with COO + meeting room | **Implemented & verified** this session: persistent threads, one-on-one with the COO or convened multi-agent meetings; answers from real project data without a provider, from the model when one is configured; provenance (`modèle`/`données réelles`/`hors-ligne`) always shown |
| Gateway management UI | **Implemented & verified** this session: add/edit/remove providers (llama.cpp, Ollama, vLLM, hosted), health probe, model discovery via `GET /models`, encrypted keys, policy routing — all admin-only and audited |
| Web search | `web_search` returns a clear "no provider configured" failure |
| GitHub push / PR creation | Data model present (`pull_request_references`, `commit_references`); no adapter |
| Semantic retrieval / embeddings | `knowledge_items.embedding` column exists; retrieval is keyword/tag based |
| Container isolation | Path-confinement sandbox only. See `SECURITY.md` |
| Redis / BullMQ | Postgres-backed queue instead. See `ARCHITECTURE.md` §5 |
| Email / Slack / push notifications | In-app only |
| Admin Master UI | **Implemented & verified** this session: list/create/edit users (email, name, role), activate/deactivate, set password; org-scoped, audited, last-owner protected |
| Official logo | Recreated as inline SVG (`src/components/brand/logo.tsx`); raster PNGs supplied as attachments were not materialised into the sandbox — drop them into `public/brand/` to use the exact assets |
| File upload UI | File records and parsing are modelled; no upload endpoint wired |

## 6. Phase status (spec §51)

| Phase | Status |
| --- | --- |
| 0 — Repository audit and recovery | **Complete.** Repo was empty (1 commit, 0 files); nothing to recover. See `AUDIT_PHASE0.md` |
| 1 — Core platform foundation | **Complete.** Auth, 39-table schema, projects, sandbox, navigation |
| 2 — Model gateway | **Complete + manageable in-app.** Providers, credentials, health, router, usage, and an admin UI to add local gateways. Exercised against a mock local server; a real local endpoint (llama.cpp/Ollama) can now be connected by the user |
| 3 — Agents and runs | **Complete.** 13 agents, goals, tasks, runs, events, checkpoints, recovery |
| 4 — Tool execution | **Complete.** 26 tools, permissions, invocation records, cancellation |
| 5 — Coding workbench | **Partial.** File tree, diff review, terminal history, preview frame. No code editor UI |
| 6 — Autonomous coding loop | **Partial.** Verify/repair loop is real and tested. Code-*generation* requires a model provider |
| 7 — Multi-agent orchestration | **Partial.** Delegation, dependencies and agent instances are real; concurrent multi-agent execution untested without a provider |
| 8 — Git integration | **Partial.** status/diff/branch/commit work; push and PR do not |
| 9 — Deployment | **Not implemented** |
| 10 — Advanced work | **Partial.** Artifacts real; research/scheduling not implemented |

## 7. Acceptance tests (spec §52–§56)

| Test | Status |
| --- | --- |
| §52 First end-to-end | **Partial.** Full loop verified through VERIFY with real commands. CODE stage needs a model provider |
| §53 Failure recovery | **Pass.** Broken fixture → detected, recorded, retried, reported truthfully |
| §54 Interruption | **Partial.** Pause/resume/cancel and mid-run instructions implemented and tested at the data layer; not yet driven through a live LLM run |
| §55 Multi-project isolation | **Pass.** Verified over HTTP and in integration tests |
| §56 Local AI | **Blocked.** No local endpoint reachable; provider health and offline-degradation paths are implemented and the offline branch is unit-covered |

## 8. Known issues

See `BUGS.md`. No open correctness bugs are known at the time of writing; the entries
there are limitations with reproduction steps.

## 9. How to reproduce these results

```bash
npm run db:migrate   # applies drizzle/*.sql to the embedded database
npm run db:seed      # agent catalog, providers, routes, integrations
npm run verify       # typecheck + lint + test + build
npm run dev          # http://localhost:3000  (admin@twodots.local / changeme-please)
```
