# AI Core — Security

## 1. Threat model

AI Core will hold valuable source code, credentials and infrastructure access. The
principal threats:

| # | Threat | Primary control |
| --- | --- | --- |
| T1 | Cross-project data access | Organisation-scoped queries in `requireProject`; integration tests |
| T2 | Path traversal out of a sandbox | `resolveSandboxPath` with realpath resolution |
| T3 | Command injection via agent-generated shell | `spawn` with an argv array, `shell: false`, argument screening |
| T4 | Secret leakage to browser/logs/DB | Env-var credentials, AES-256-GCM at rest, `redactSecrets`, fingerprints only |
| T5 | Destructive action without consent | Approval gate on 10 operation categories |
| T6 | Unbounded agent resource use | Step ceiling, wall clock, repeated-error and no-progress detection |
| T7 | SSRF via `fetch_url` | Private/internal address blocklist |
| T8 | Runaway or orphaned processes | Process-group kill, timeout, dev-server lifecycle tracking |

## 2. Authentication and authorization

* Passwords hashed with scrypt (N=16384, r=8, p=1) from `node:crypto`. No native deps.
* Sessions are opaque random tokens; only their SHA-256 HMAC is stored. Cookie is
  `httpOnly`, `sameSite=lax`, `secure` in production, 30-day expiry enforced in the DB.
* Every route calls `requireUser()` / `requireProject()`. `requireProject` queries by
  **organisation id as well as project id**, so a project from another organisation
  returns the same 403 as a nonexistent one.
* Nested resources are re-scoped: `PATCH /tasks` filters by `(taskId, projectId)`;
  `DELETE /commands` verifies the command's project before cancelling.
* Authorization is **not** performed in `proxy.ts`. The edge runtime cannot reach the
  database or `node:crypto`. Hidden UI is never the only control.
* `AI_CORE_MASTER_KEY` is required and refuses the development default in production.

## 3. Path confinement (verified)

`resolveSandboxPath(root, requested)` rejects, in order: non-strings, null bytes,
absolute paths, `..` escapes (static containment), and symlink escapes (realpath
resolution, walking to the nearest existing ancestor so not-yet-created files are
still checked).

Verified over HTTP:

```
path=../../../etc/passwd  -> 400 {"code":"path_escape","message":"Path escapes the project sandbox: ..."}
path=/etc/passwd          -> 400 {"code":"path_escape","message":"Absolute paths are not allowed: ..."}
```

Covered by 12 unit tests including a real symlink pointing outside the sandbox.

## 4. Sandbox isolation — honest scope statement

**What this is:** path-confinement. Every file-tool path and every command `cwd` is
resolved against the project sandbox and rejected if it escapes.

**What this is not:** container isolation. A process running inside a project sandbox
still shares the host kernel, the host user account, the host network and the host
environment. Agent-generated code executing `run_command` can read anything that user
can read, and can make outbound network connections.

**Required before exposing AI Core publicly:** execute agent commands inside containers
or a sandboxing runtime (gVisor/Firecracker), with a dedicated unprivileged user,
network egress policy, and read-only mounts outside the workspace. Tracked as the top
item in `BACKLOG.md`.

## 5. Command execution

* `spawn(command, argv, { shell: false })` — argv goes straight to `execve`, so shell
  metacharacters in an argument are literal text and cannot start a second command.
* Arguments are screened for shell control characters (`&&`, `||`, backticks, `$(`,
  `; rm`, `> /etc`) and null bytes.
* A forbidden-binary list refuses `rm`, `mkfs`, `dd`, `shutdown`, `reboot`, `halt`,
  `poweroff` outright.
* Child processes receive a scrubbed environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `OPENROUTER_API_KEY`, `GITHUB_TOKEN` and `AI_CORE_MASTER_KEY` are removed.
* `detached: true` plus negative-PID kill terminates the whole process group.
* Non-preapproved executables require an approval request.

## 6. Secrets

* Preferred source is an environment variable; the plaintext never enters the database.
* When stored, credentials use AES-256-GCM with a key derived from
  `AI_CORE_MASTER_KEY`. Format `v1:<iv>:<tag>:<ciphertext>` allows rotation.
* The API returns only a **fingerprint** (`…ab12cd34`) and the env-var name. No endpoint
  serialises a credential.
* `redactSecrets()` runs on every log line and on tool-call input before persistence,
  matching `sk-`/`pk-`/`ghp_`/`xox*` keys, `Bearer` tokens, `api_key=` pairs and
  passwords inside database URLs.

## 7. Approvals

Ten categories block on a human decision: `file_delete`, `db_destructive`,
`deploy_production`, `git_push`, `pr_merge`, `secret_change`, `dangerous_command`,
`high_cost`, `infra_delete`, `external_purchase`.

A request records what will happen, why, the risk level, the affected
project/environment, and the exact action payload. The run parks as
`waiting_for_approval`; the blocked tool polls and resumes, aborts, or applies an
edited instruction. Requests expire after one hour.

## 8. Agent loop safety

Per agent definition: `maxSteps`. Per task: `maxAttempts` (default 3). Per run: a
15-minute wall clock. Plus repeated-error detection (3 identical failure signatures →
escalate) and no-progress detection (4 steps with no successful tool call → escalate).
An escalating agent states what it tried rather than burning resources silently.

## 9. Transport and rendering

`proxy.ts` sets CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and
`Cache-Control: no-store` on non-static responses.

`frame-src` allows `http:`/`https:` so the dev-server preview iframe can load a
project's own application. Narrow this to known preview origins before public exposure.

## 10. Auditing

`audit_events` records auth, project CRUD, run control, task edits, approvals, memory
writes and health checks, with actor, entity and outcome. Audit writes are best-effort
but failures are logged loudly, so a gap is visible rather than silent.

## 11. Verified in this session

| Control | Result |
| --- | --- |
| Unauthenticated API access | 401 with structured error |
| Wrong password | 401 (identical message to unknown user) |
| Project A data under project B | run 404 · events 0 · memory/files/tasks/changes 0 · A's run intact |
| Path traversal | 400 `path_escape` for both `../` and absolute |
| Malformed project id | 403 `project_isolation`, not 500 |
| Secrets in API responses | fingerprints only, no plaintext |

## 12. Dependency vulnerabilities (`npm audit`)

Assessed individually rather than by running `npm audit fix --force`, which proposes a
breaking **downgrade** of `drizzle-kit` to 0.18.1.

| Package | Severity | Assessment | Action |
| --- | --- | --- | --- |
| `diff` < 8.0.4 | low | DoS in `parsePatch` / `applyPatch`. AI Core only calls `createTwoFilesPatch`, so the vulnerable functions are never reached. | **Fixed** — bumped to 8.0.4 |
| `esbuild` ≤ 0.24.2 (via `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils`) | moderate ×4 | The advisory concerns the esbuild **dev server** accepting cross-origin requests. `drizzle-kit` is a CLI that never starts a server, and it is a `devDependency` — not shipped to production. No exploitable path. | **Accepted.** `drizzle-kit` is already at the latest release (0.31.10); the chain is upstream. Downgrading would break migrations for no real gain |

Current state after the `diff` fix: **4 moderate**, all in the dev-only `drizzle-kit`
chain above. Re-run `npm audit` after any `drizzle-kit` release that updates
`@esbuild-kit/*`.

## 13. Not yet hardened

* No rate limiting on authentication.
* No CSRF token (mitigated by `sameSite=lax` plus JSON-only mutation endpoints).
* `frame-src` is permissive.
* No container isolation (§4).
* No secret scanning of committed repository content.
