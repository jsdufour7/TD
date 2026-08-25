# AI Core — Prioritized Backlog

Ordered by value ÷ risk. P0 items block the V1 release gate.

## P0 — Blocks the release gate

1. **Verify the LLM agent tool loop end-to-end.**
   `runWithModel` is implemented but unexercised: no provider is reachable here.
   Configure `LOCAL_MODEL_BASE_URL` or an API key, then run the §52 acceptance test
   ("Add a Settings page with a profile form…") and confirm plan → tasks → edits →
   typecheck → tests → diff → review → memory with a real model.

2. **Container isolation for `run_command`.**
   Today's sandbox is path-confinement only; a process shares the host kernel, user and
   network. Required before any public or multi-tenant exposure. See `SECURITY.md` §4.

3. **Deployment adapter (Vercel first).**
   `deploy` currently records an explicit error. Needs: create deployment, poll status,
   record URL/revision/result, production approval gate.

## P1 — High value, unblocked

4. **GitHub adapter.** Push, branch protection awareness, PR creation and status.
   Data model already exists (`commit_references`, `pull_request_references`).
   `allow_push` is already per-repository and defaults to false.

5. **Code editor in the workbench.** Repository tab shows the tree and diffs but has no
   editing surface. Add Monaco/CodeMirror with the same sandbox guard on save.

6. **File upload endpoint.** `files` table and parsing are modelled; no route writes to it.
   Needed for the §10 knowledge/file system promise (PDF, DOCX, XLSX, CSV, images).

7. **Semantic retrieval.** `knowledge_items.embedding` exists but is unused. Add an
   embedding provider, backfill, and cosine retrieval in `assembleContext`.

8. **E2E Playwright specs.** Written but not runnable without a browser binary.
   Run them once `npx playwright install chromium` succeeds.

## P2 — Hardening

9. **Multi-node worker.** Replace the in-process worker with Redis/BullMQ or a Postgres
   advisory-lock claim so more than one node can run agents.

10. **Rate limiting on authentication.** No throttling exists today.

11. **Narrow `frame-src`.** Currently `http:`/`https:` for the preview iframe; restrict
    to known preview origins.

12. **Secret scanning** of repository content an agent reads or commits.

13. **Cost budgets per run.** Usage is recorded; there is no ceiling that stops a run.

14. **Migration rollback support.** `drizzle-kit` generates up-migrations only.

## P3 — Capability expansion

15. Scheduled and conditional work (cron-like triggers on runs).
16. External integrations: Slack, Linear/Jira, Notion, Google Drive, Sentry.
17. Notification channels beyond in-app: email, Slack, webhook.
18. Multi-organisation UI (the data model already supports it).
19. Artifact rendering (PDF/spreadsheet/presentation generation).
20. Conversation threads persisted per run (`conversations`/`messages` exist, unused).

## Not planned for V1

* Editing binary formats (images, spreadsheets) in place.
* A visual workflow builder.
* Fine-grained RBAC beyond owner/admin/member.

## Executive runtime follow-ups

- DONE: Mission Mode supervisor (`src/engine/mission.ts`) — after each run finalises it
  re-evaluates the objective and re-plans/continues until DONE / BLOCKED / NEEDS_USER /
  BUDGET / MAX_ITERATIONS. Tested.
- DONE: local voice hardening (`src/voice/router.ts` + `/api/voice/status`) — auto-detects
  env URLs, known ports, and binaries on PATH for whisper.cpp / Kokoro / Piper, and reports
  honestly otherwise (browser fallback remains free).
- DONE: concurrency guards (`src/engine/locks.ts`) — filesystem exclusive locks (cross-process,
  stale-takeover for zombie recovery) and idempotency markers; `write_file` now writes under a
  per-file lock. Tested.
- P2: Operations/Debug page for queue + watchdog heartbeats.
