# PHASE 0 — Repository Audit (TwoDots / AI Core)

Date: 2026-08-24 · Branch: `arena/01a034bd-td` · Base: `340aca5`

## Finding: the repository is empty

Verified by direct inspection, not assumption:

```
$ ls -la /home/user/TD
drwxr-xr-x  .git          # <- the only entry

$ git log --all --oneline | wc -l
1

$ git log --all --pretty=format: --name-only | sort -u | wc -l
0
```

The repository contains exactly **one commit** (`340aca5 "Delete B2twodots-landing-page-development
directory"`) and **zero tracked files**. There is no previous AI Core work, no `package.json`, no
`node_modules`, no documentation.

Consequence for the "RECOVER AND EXTEND BEFORE REBUILDING" rule: there is nothing to recover.
Nothing was preserved because nothing existed. Everything in this repository is new.

## Environment capability audit

Probed each capability rather than assuming it, because the architecture depends on the answers.

| Capability | Result | Command |
| --- | --- | --- |
| Node.js | **v22.22.3** | `node -v` |
| npm | **10.9.8** (registry reachable, HTTP 200) | `npm view next version` |
| pnpm | absent | `pnpm -v` → not found |
| yarn | 1.22.22 | `yarn -v` |
| Python | 3.11.2 | `python3 --version` |
| git | 2.39.5 | `git --version` |
| **PostgreSQL server** | **absent** (`psql` not found) | `which psql` |
| **Redis server** | **absent** (`redis-server` not found) | `which redis-server` |
| **Docker** | **absent** | `docker --version` → not found |
| `sudo` | available | `sudo -n true` → ok |
| **apt / OS packages** | **BLOCKED — network is npm-registry-only** | `sudo apt-get update` → `Failed to fetch http://deb.debian.org/... Connection failed` |
| CPU / RAM / disk | 2 cores / 3.9 GB / 20 GB free | `nproc`, `free -m`, `df -h` |

### The decisive result

`apt-get update` fails on every mirror, so PostgreSQL and Redis cannot be installed at the OS level.
However, npm **is** reachable, and npm distributes a real Postgres engine:

```
$ node t.mjs
PG OK version: PostgreSQL 18.3 (PGlite 0.5.7) on wasm32-unknown-linux-gnu,
    compiled by emcc ... 3.1.74, 32-bit
rows: [{"id":1,"name":"hello"}]
```

**PostgreSQL 18.3 genuinely executes here**, compiled to WebAssembly, persisting to disk. This is
not a shim or a mock — it is the real Postgres query engine, which means real SQL, real relations,
real constraints, real transactions, real migrations.

## Architecture decisions forced by the audit

1. **Persistence = PostgreSQL via PGlite locally, node-postgres in production.**
   The Drizzle schema is written once against `drizzle-orm/pg-core`. Switching from the embedded
   engine to a hosted Postgres server changes only the driver in `src/db/client.ts` — the schema,
   the migrations, the queries and the relational model are unchanged. Selected with
   `DATABASE_DRIVER=pglite|postgres`.

2. **Job queue = durable Postgres-backed queue, not BullMQ/Redis.**
   Redis is unavailable. Run state is authoritative in Postgres; an in-process worker claims runs
   with `SELECT ... FOR UPDATE SKIP LOCKED`. Because the *state* is in the database rather than in
   Redis, a browser refresh or a server restart does not lose a run — which is the property the
   spec actually requires. BullMQ remains the documented production path.

3. **Isolation = filesystem sandboxing per project, not containers.**
   Docker is absent, so true container isolation is impossible here. Each project gets a sandbox
   root and every file/command tool path is resolved and prefix-checked against it. This is
   documented as **V1 sandboxing, not hardened production isolation** — see `SECURITY.md`.

4. **No mocking of AI results.** Where no model provider is configured, the platform says
   "Not configured" and degrades to a deterministic heuristic planner that performs real repository
   inspection and produces real tasks. Nothing pretends to be an LLM.

## Verification performed at audit time

* `git status` → clean working tree on `arena/01a034bd-td`
* PGlite smoke test executed successfully (output above) — engine confirmed working
* npm registry confirmed reachable for all required packages:
  `next@16.3.2`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `@electric-sql/pglite@0.5.7`,
  `vitest@4.1.11`, `playwright@1.62.1`
