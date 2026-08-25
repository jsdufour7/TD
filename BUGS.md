# AI Core — Bugs and Limitations

## Fixed during this session

Each entry records the symptom, the root cause and the fix. All were found by running
the code, not by reading it.

### B-01 · Drizzle conditions combined with `&&` instead of `and()` — FIXED
**Symptom.** `GET /api/projects/:id/runs?status=running` ignored the status filter and
returned every run.
**Cause.** `eq(a) && eq(b)` evaluates to the second operand in JavaScript, silently
dropping the first condition.
**Fix.** `and(eq(projectId), eq(status))` in `src/app/api/projects/[projectId]/runs/route.ts`,
with a comment explaining why `&&` is wrong here.

### B-02 · Every page returned HTTP 500 (edge runtime) — FIXED
**Symptom.** `GET /login` → 500. `Failed to load external module node:path: Native
module not found: node:path`, source `edge-server`.
**Cause.** `instrumentation.ts` is compiled for the edge runtime too; its module graph
reaches `node:path`. Failure is at module-evaluation time, so a runtime guard cannot help.
**Fix.** Removed `instrumentation.ts`; boot lazily via `src/platform/boot.ts`. See ADR-003.

### B-03 · `npm run "<script command>"` instead of the script name — FIXED
**Symptom.** Deterministic verification failed with `npm error Missing script: "tsc --noEmit"`.
**Cause.** `agent-executor.ts` stored each script's *command* and passed it where npm
expects the script's *name*.
**Fix.** Candidates now map a verification concern to an existing script **name**;
`argv = ['run', scriptName]`. Regression-locked by an integration test asserting
`argv[0] === 'npm' && argv[1] === 'run' && argv[2] ∈ {typecheck, test}`.

### B-04 · ESLint could not start — FIXED
**Symptom.** `TypeError: Converting circular structure to JSON`.
**Cause.** `FlatCompat` wrapping a config that is already flat.
**Fix.** Native flat config; see ADR-008. Also file-scoped the `@typescript-eslint` rules.

### B-05 · Playwright broke the production build — FIXED
**Symptom.** `Module not found: Can't resolve 'chromium-bidi/lib/cjs/cdp/CdpConnection'`.
**Cause.** `playwright-core` lazily requires an uninstalled optional module; the bundler
resolves it eagerly.
**Fix.** Runtime `createRequire` load. See ADR-006.

### B-06 · Cross-project run lookup returned 500 instead of 404 — FIXED
**Cause.** `jsonError(new Error('Run not found'))` is not an `AppError`, so it fell
through to the generic 500 branch and logged a spurious "unhandled route error".
**Fix.** `jsonError(notFound(...))` in the route; `throw notFound(...)` in the engine.

### B-07 · Malformed project/org id returned 500 instead of 403 — FIXED
**Cause.** A non-UUID string fails the Postgres column cast before the authorization
query can return "no rows".
**Fix.** `requireProjectForOrg` validates UUID shape first and throws
`projectIsolationViolation` — the same response as a genuine mismatch, so the two cases
are indistinguishable to a caller.

### B-08 · Dev servers could not be cancelled — FIXED
**Cause.** `command-runner.ts` deleted the live-process entry when a dev-server promise
resolved, so `cancelCommand` / `stopProjectDevServers` could no longer reach the child.
**Fix.** Keep the entry in the live map for the process lifetime; `cancelCommand` now
also updates the DB row, since a dev server's promise has already settled.

### B-09 · Re-inspecting a repository duplicated canonical memory — FIXED
**Cause.** Repository inspection always inserted a new `memories` row.
**Fix.** Upsert on `(projectId, kind, title)`. Verified: two post-fix inspections kept
the count unchanged instead of growing.

### B-10 · Test harness env overrides were silently ignored — FIXED
**Symptom.** `spawn npm ENOENT` inside tests only.
**Cause.** `src/lib/env.ts` caches `process.env` at module-evaluation time; the harness
set variables after a hoisted import had already evaluated it. Verified:
`harness sandboxDir = /tmp/aicore-test-…/sandbox` vs `env.sandbox.root = /home/user/TD/.data/sandbox` → `MATCH? false`.
**Fix.** `tests/setup.ts` via Vitest `setupFiles`. See ADR-009.

### B-11 · React correctness issues caught by lint — FIXED
* `live-feed.tsx` read `lastSeq.current` during render; now derived from `events`.
* `workbench.tsx` called `setState` synchronously in an effect; the server component now
  supplies `initialDetail`, run switching fetches in the click handler, and the effect
  only sets up polling.
* `primitives.tsx` built a class as `` `text-${tone}` ``; Tailwind cannot generate
  dynamic class names, so it produced nothing. Replaced with an explicit lookup map.

---

### B-12 · Sign-in button inert in the live preview — FIXED
**Symptom.** The login page rendered and the credentials were correct, but clicking
"Sign in" did nothing. No error, no navigation, no loading state.

**Red herrings ruled out first.** `POST /api/auth/login` returned 200 via curl; `/login`
returned 200; all authenticated pages returned 200 with real HTML. So nothing was wrong
server-side. React's dev `eval` probe was found in the served bundle, but it is wrapped
in `try/catch` and only logs — not fatal, so it was not the cause.

**Root cause.** Next.js 16 blocks cross-origin access to `/_next/*` dev resources by
default. Served through the sandbox preview host, every client chunk was answered with
403. The server log stated it directly:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/static/chunks/….js
  from "3000-i109uo670veewyf14gxz3.e2b.app".
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

The server-rendered HTML still loaded, so the page *looked* correct, but no client
bundle ever arrived. React never hydrated, so the `onSubmit` handler did not exist and
the button was inert.

**Fix.** `allowedDevOrigins: ['*.e2b.app', 'localhost', '**.localhost']` in
`next.config.ts`. Verified: the same chunk request with the preview origin now returns
**200** where it previously returned 403, and the warning no longer appears.

**Also corrected while diagnosing** (sound hardening, but *not* the cause):
* CSP omitted `'unsafe-eval'`, which React's dev build probes for; added in development
  only.
* `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'self'` would block the preview's
  iframe; framing is now permitted in development and locked to `DENY`/`'self'` in
  production.
* `Button` computed `disabled` *before* the rest-spread, so `loading` could not disable
  it when `disabled` was also passed; and with no `type` default a bare `<button>` in a
  form submits it. Spread now comes first, and `type` defaults to `"button"`.

**Note on runtime:** `proxy.ts` runs on the edge, so it must not import `@/lib/env`
(which reaches `node:path` — see B-02). It reads `process.env.NODE_ENV` directly.

---

### B-13 · `Performance.measure` TypeError on 'AppLayout' after sign-in — FIXED
**Symptom.** Browser overlay:
`Failed to execute 'measure' on 'Performance': 'AppLayout' cannot have a negative time stamp`,
thrown from React's `flushComponentPerformance` / `flushInitialRenderPerformance`.

**Root cause — two contributing parts.**

1. *React side (dev-only, not ours to patch).* In
   `react-server-dom-turbopack-client.browser.development.js`, the **aborted-component**
   branch calls `performance.measure(name, { start, end: childrenEndTime })`. It clamps
   `start` (`0 > startTime ? 0 : startTime`) but not `end`, and `childrenEndTime` is
   initialised to `-Infinity`. A component whose stream aborted before producing child
   timings is therefore measured with a negative end time, which the browser rejects.

2. *Our side — the trigger.* `router.replace()` was immediately followed by
   `router.refresh()` in three places. `replace` already fetches a fresh RSC payload for
   the destination; the extra `refresh()` re-fetches and **aborts that in-flight render**.
   `AppLayout` is inside it, so it hit the aborted branch above.

The server log corroborates this exactly — two back-to-back fetches of the same route,
then the error:

```
GET /home 200 in 34ms
GET /home 200 in 37ms
[browser] Uncaught TypeError: ... 'AppLayout' cannot have a negative time stamp.
```

**Fix.** Removed the redundant `router.refresh()` after `router.replace` / `router.push`
in `login/page.tsx`, `layout/sidebar.tsx` and `work/new-project-dialog.tsx`. The 11
remaining `router.refresh()` calls are standalone post-mutation refreshes, which are
correct and unaffected.

**Hardening.** `AppLayout` also calls `redirect()` when there is no user, which throws
and aborts the RSC stream the same way. `proxy.ts` now redirects signed-out visitors
based on session-cookie *presence*, so the layout never starts rendering for them. This
is a UX redirect only — authorization still lives in `requireUser`, verified: a forged
cookie still yields 307 on `/home` and 401 JSON on `/api/projects`.

**Verification.** Signed out: `/login` 200 (no loop), `/` → `/login`, `/home|/projects|
/settings` → `/login?redirect=…`, `/api/*` → 401 JSON (never redirected), `/_next/*` 200.
Signed in: `/` → `/home`, all app pages 200 with real HTML.

---

### B-14 · Sign-in appeared to do nothing: session cookie dropped in the preview iframe — FIXED
**Symptom.** Clicking "Sign in" produced no visible change. The user could click
repeatedly with no effect.

**Server log — the decisive evidence.** Login *succeeded* every time; the session was
simply not recognised on the next request:

```
POST /api/auth/login 200          ← login works
GET  /home 307                    ← but /home bounces
GET  /login?redirect=%2Fhome 200  ← back on the login page
POST /api/auth/login 200          ← user clicks again… (8+ times)
```

**Root cause.** The cookie was set with `SameSite=Lax`:

```
set-cookie: ai_core_session=…; Path=/; HttpOnly; SameSite=lax
```

The live preview serves this app over HTTPS **inside a cross-origin iframe**. A
`SameSite=Lax` cookie is not sent on requests originating from a cross-site iframe —
Lax only permits top-level navigations. So the browser accepted the cookie from the
login response and then omitted it from the very next request. `/home` saw no session
and redirected back to `/login?redirect=/home`. The button was never broken; the
session was.

**Fix.** `setSessionCookie` now derives the site policy from how the request arrived
(`x-forwarded-proto` / `x-forwarded-ssl`):

| Context | Attributes |
| --- | --- |
| HTTPS (preview iframe, production) | `Secure; HttpOnly; SameSite=none` |
| Plain HTTP (local dev) | `HttpOnly; SameSite=lax` |

`SameSite=None` is only honoured by browsers together with `Secure`, so they are set as
a pair and only over HTTPS. Verified both branches return the expected header.

**CSRF note.** `SameSite=None` widens cross-site sending. Exposure is limited because
every mutation endpoint requires a JSON body — a cross-site HTML form cannot set
`content-type: application/json` without triggering a CORS preflight.

**End-to-end verification** (simulating the preview with `x-forwarded-proto: https`):
login 200 → `GET /home` **200** (no bounce) → `/projects` `/agents` `/runs` `/models`
`/approvals` `/settings` all 200 → `GET /api/projects` 200.

---

### B-15 · PGlite WASM aborted after a restart — RECOVERED, hazard documented
**Symptom.** Every DB query failed with
`Failed query: select … from "users" …`, underlying cause
`RuntimeError: Aborted(). Build with -sASSERTIONS for more info.`

**Root cause.** PGlite permits **one process per data directory**. A diagnostic script
opened `.data/pglite` while the dev server already held it; the WASM instance aborted
and the data directory was left inconsistent, so the server's queries failed too.

**Recovery.** Stopped every process, `rm -rf .data`, re-ran `db:migrate` and `db:seed`.
Dev data only — no source or schema loss.

**Hazard now documented in `RUNBOOK.md`:** never run `db:migrate`, `db:seed` or an
ad-hoc DB script while the dev server is running. The test suite is safe because
`tests/setup.ts` provisions a separate temporary database per run.

**Follow-up found later (B-15b).** `npm run build` was a second, less obvious offender: it
prerendered `/`, whose handler calls `getCurrentUser()` → `ensurePlatformReady()` →
`bootstrapDatabase()`, opening the same data directory. The build failed with
`Error occurred prerendering page "/"` and the same `RuntimeError: Aborted()` cause. Fixed
with `export const dynamic = 'force-dynamic'` in `src/app/page.tsx` — an
auth-dependent redirect must never be prerendered. Static page count went 12 → 11, and the
build no longer touches the database. Rule going forward: any page reading the session must
set `force-dynamic`.

---

## Open limitations (not bugs — missing capability)

### L-01 · No model provider reachable in this environment
Planning falls back to deterministic mode and reasoning tasks are marked `blocked`.
The LLM tool loop (`runWithModel`) is implemented but unexercised end-to-end.
**Unblock:** set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `LOCAL_MODEL_BASE_URL`.

### L-02 · No browser runtime
`npx playwright install chromium` fails (npm registry only) and no system browser exists.
`browserCapability()` reports this honestly; browser tools fail with a clear message.

### L-03 · Sandbox is path-confinement, not container isolation
A process inside the sandbox still shares the host kernel, user and network.
See `SECURITY.md` §4.

### L-04 · Single-node worker
The run-engine worker is in-process. Horizontal scaling needs Redis/BullMQ or a
Postgres advisory-lock claim.

### L-05 · Deployment and web-search adapters absent
`deploy` records an explicit error rather than faking success; `web_search` returns a
clear "not configured" failure.
