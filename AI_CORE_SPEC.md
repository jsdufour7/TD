# TwoDots AI Core — Canonical Product Specification

Status: **V1 in progress** · Last verified: 2026-08-24 · Branch: `arena/01a034bd-td`

## 1. What AI Core is

AI Core is the AI work operating system for the TwoDots ecosystem. It is intended to
become the environment in which TwoDots products — CoAdvisor, Panorama, PlanOS, DataNerds,
Brandely, ShiftSpot and future ventures — are designed, built, tested and shipped.

The unit of work is not a chat message. It is a **run**: a durable, interruptible,
recoverable unit of autonomous engineering that a human starts, watches, redirects and
approves.

The product combines five capabilities:

| Capability | What it means here |
| --- | --- |
| AI work environment | Persistent project workspaces: instructions, files, memory, conversations, tasks, runs |
| Autonomous engineering | Agents that read repositories, edit files, run commands, run tests, repair failures |
| Multi-agent operations | A COO decomposes objectives and delegates to the smallest competent team |
| Multi-model gateway | Provider-agnostic model routing with policies, health and cost tracking |
| Human command center | Pause, resume, cancel, redirect, approve, reject, reassign, reprioritise |

## 2. The core promise

A user gives AI Core an objective. AI Core:

```
UNDERSTAND → GATHER CONTEXT → PLAN → EXECUTE → VERIFY → REPAIR → REVIEW → DELIVER → REMEMBER
```

A task is **not** complete because code was generated. It is complete when the relevant
result has been verified by running something, and the verification result is recorded.

## 3. Non-negotiable product principles

1. **Persistent, not session-only.** The browser is never the source of truth. A run
   survives a page refresh and a server restart.
2. **Functional, not decorative.** No interface may look operational without real
   behaviour behind it. Unimplemented capability is labelled, never simulated.
3. **Observable, not opaque.** The live feed is derived from real database events.
   No timers, no invented activity, no hidden chain-of-thought.
4. **Interruptible, not uncontrollable.** Pause stops at a safe boundary. Instructions
   can be injected into a live run.
5. **Recoverable, not fragile.** Checkpoints make RECOVER → CONTINUE the default path.
6. **Multi-project.** Isolation is enforced server-side, not by hiding UI.
7. **Multi-model, not provider-locked.** Models are configurable data.
8. **Tool-capable, not chat-only.** Agents act through registered, permissioned tools.
9. **Human-controlled.** High-impact operations block on approval.

## 4. Domain model

Thirty-nine domain tables in PostgreSQL (`grep -c "^export const .* = pgTable(" src/db/schema/*.ts`).
Grouped by concern:

**Identity & tenancy** — organizations, users, sessions, audit_events, notifications
**Project workspace** — projects, project_members, project_instructions, environments,
files, knowledge_items, memories, conversations, messages
**Work** — goals, tasks, task_dependencies, agent_runs, run_events, run_checkpoints,
agent_definitions, agent_instances, tool_calls, commands, test_runs, git_changes,
approval_requests, artifacts, deployments
**Repository** — repositories, branches, commit_references, pull_request_references
**Gateway** — model_providers, model_definitions, model_routes, credential_references,
model_usages, integrations

## 5. The agent catalog

Thirteen roles, each with its own system instructions, tool allow-list, permission set,
model policy and step budget. An agent that is not granted a tool cannot call it — the
engine enforces this at dispatch, not in the prompt.

| Key | Role | Model policy |
| --- | --- | --- |
| `coo` | Chief Orchestrator — plans and delegates, does not implement | BEST |
| `product-architect` | Business goals → requirements | BEST |
| `software-architect` | Boundaries, patterns, major decisions | BEST |
| `fullstack-engineer` | Feature implementation | CODING_MAX |
| `frontend-engineer` | UI, a11y, responsive, states | CODING_MAX |
| `ux-designer` | Experience review | BALANCED |
| `database-engineer` | Schema, migrations, queries | CODING_MAX |
| `qa-engineer` | Tests and verification evidence | CODING_MAX |
| `security-reviewer` | Auth, secrets, injection, boundaries | BEST |
| `devops-engineer` | Build, CI, deployment | BALANCED |
| `code-reviewer` | Diff review for correctness and regressions | BEST |
| `research-agent` | Referenced external findings | BALANCED |
| `documentation-agent` | Docs and handoff | BALANCED |

The COO picks the **smallest competent team**. Twelve agents are not instantiated for a
one-line change.

## 6. Tool surface

Twenty-six registered tools across five groups. Every invocation writes a `tool_calls`
row regardless of outcome.

*File*: read_file, write_file, patch_file, delete_file, list_directory, search_files
*Git*: git_status, git_diff, git_branch, git_commit
*Execution*: run_command, run_tests
*Browser*: browser_open, browser_click, browser_type, browser_screenshot
*Platform*: record_memory, read_memory, create_task, update_task, create_artifact,
request_approval, deploy, database_query, fetch_url, web_search

## 7. Routing policies

`FAST` · `BALANCED` · `BEST` · `LOCAL_ONLY` · `PRIVACY_FIRST` · `LOW_COST` ·
`CODING_MAX` · `MANUAL`

Policies resolve to models through `model_routes` at runtime. Providers that are
disabled or known-offline are skipped. `LOCAL_ONLY` deliberately does **not** fall back
to a hosted provider — that is the point of the policy.

## 8. Approval categories

Operations that block on a human decision: `file_delete`, `db_destructive`,
`deploy_production`, `git_push`, `pr_merge`, `secret_change`, `dangerous_command`,
`high_cost`, `infra_delete`, `external_purchase`.

A request can be **approved**, **rejected**, or **approved with an edited instruction**.

## 9. Definition of done

A feature is done when its acceptance criteria pass, verified by:

```
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint flat config
npm test            # vitest, real database
npm run build       # next build, production
```

plus browser verification where UI changed. Not done: "the component renders", "the
route exists", "the happy path looks right".

## 10. Release gate for V1

```
PROJECT → OBJECTIVE → PLAN → TASKS → AGENT → TOOLS → CODE → COMMANDS
        → TESTS → PREVIEW → CORRECTION → DIFF → REVIEW → RESULT → MEMORY
```

Every stage must be backed by real application state, visible to the user, surviving a
refresh, recoverable after failure, and distinguishable from simulated activity.

See `IMPLEMENTATION_STATUS.md` for which stages are currently real end-to-end and which
are blocked on a model provider or an unavailable runtime.
