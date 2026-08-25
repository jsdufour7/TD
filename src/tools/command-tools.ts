import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { runCommand } from '@/engine/command-runner';
import { env } from '@/lib/env';
import { defineTool, fail, type ErasedTool, type ToolContext } from './types';

/**
 * Command and test tools (§12).
 *
 * Agents pass an argv array, never a shell string. The runner refuses shell
 * control characters outright, so an agent cannot smuggle `; rm -rf /` through
 * an argument. Long-running dev servers are a distinct kind with their own
 * lifecycle.
 */

/** Commands an agent may run without an approval request. */
const PREAPPROVED_BINARIES = new Set([
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'node',
  'git',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'playwright',
  'ls',
  'cat',
  'pwd',
  'echo',
  'python3',
  'pytest',
  'go',
  'cargo',
  'make',
]);

/** Sub-commands that mutate the machine or spend money, so they need approval. */
const APPROVAL_REQUIRED_PATTERNS: Array<{ binary: string; argPattern: RegExp; category: string }> = [
  { binary: 'npm', argPattern: /^publish$/, category: 'external_purchase' },
  { binary: 'npx', argPattern: /^vercel$/, category: 'deploy_production' },
  { binary: 'yarn', argPattern: /^publish$/, category: 'external_purchase' },
];

function needsApproval(command: string, argv: string[]): { required: boolean; category: string } {
  if (!PREAPPROVED_BINARIES.has(command)) {
    return { required: true, category: 'dangerous_command' };
  }
  for (const rule of APPROVAL_REQUIRED_PATTERNS) {
    if (rule.binary === command && argv.some((a) => rule.argPattern.test(a))) {
      return { required: true, category: rule.category };
    }
  }
  return { required: false, category: 'none' };
}

export const runCommandTool = defineTool({
  name: 'run_command',
  description:
    'Execute a command in the project workspace. Pass the executable and an argument array — never a shell string. Returns stdout, stderr and the exit code. Use kind="dev-server" for long-running servers.',
  permission: 'execute',
  inputSchema: z.object({
    command: z.string().min(1).describe('Executable name, e.g. npm'),
    argv: z.array(z.string()).describe('Argument array, e.g. ["run","build"]'),
    cwd: z.string().default('.').describe('Working directory relative to the project root'),
    kind: z.enum(['one-shot', 'dev-server']).default('one-shot'),
    timeoutMs: z.number().int().min(1000).max(30 * 60 * 1000).optional(),
    requireApproval: z.boolean().optional().describe('Force an approval request even for a known command'),
  }),
  async execute(input, ctx) {
    const gate = needsApproval(input.command, input.argv);
    if (gate.required || input.requireApproval) {
      const decision = await ctx.requestApproval({
        category: gate.category === 'none' ? 'dangerous_command' : gate.category,
        title: `Run: ${input.command} ${input.argv.join(' ')}`,
        description:
          gate.required && !PREAPPROVED_BINARIES.has(input.command)
            ? `"${input.command}" is not on the pre-approved executable list. Approve to run it inside the project sandbox.`
            : 'This command can publish, deploy or otherwise affect systems outside the sandbox.',
        risk: gate.required && !PREAPPROVED_BINARIES.has(input.command) ? 'high' : 'medium',
        action: { tool: 'run_command', command: input.command, argv: input.argv, cwd: input.cwd },
      });
      if (decision.status !== 'approved') {
        return fail(`Command was ${decision.status} by the user: ${input.command} ${input.argv.join(' ')}`);
      }
    }

    const result = await runCommand({
      projectId: ctx.projectId,
      runId: ctx.runId,
      toolCallId: null,
      command: input.command,
      argv: input.argv,
      cwd: input.cwd,
      kind: input.kind,
      timeoutMs: input.timeoutMs,
    });

    const label = `${input.command} ${input.argv.join(' ')}`.trim();
    const succeeded = result.status === 'succeeded' || result.status === 'running';

    return {
      ok: succeeded,
      summary: succeeded
        ? `${label} succeeded (${result.durationMs}ms)`
        : `${label} failed with exit code ${result.exitCode ?? 'none'}`,
      data: {
        commandId: result.commandId,
        status: result.status,
        exitCode: result.exitCode,
        stdout: tail(result.stdout, 20000),
        stderr: tail(result.stderr, 20000),
        durationMs: result.durationMs,
        previewUrl: result.previewUrl ?? null,
      },
      error: succeeded ? undefined : `Exit code ${result.exitCode ?? 'none'}`,
    };
  },
});

/**
 * Test execution records a `test_runs` row, so "8/9 tests passed" in the live
 * feed is a real measurement rather than an assertion by the agent.
 */
export const runTestsTool = defineTool({
  name: 'run_tests',
  description:
    'Run the project test suite and record the result. Returns real pass/fail counts parsed from the runner output.',
  permission: 'execute',
  inputSchema: z.object({
    command: z.string().default('npm').describe('Executable, e.g. npm or npx'),
    argv: z.array(z.string()).default(['test']).describe('Argument array, e.g. ["test"]'),
    cwd: z.string().default('.'),
    suite: z.string().default('unit').describe('Label for this test run'),
    timeoutMs: z.number().int().min(5000).max(30 * 60 * 1000).default(600000),
  }),
  async execute(input, ctx) {
    const db = await getDb();
    const [testRun] = await db
      .insert(schema.testRuns)
      .values({
        projectId: ctx.projectId,
        runId: ctx.runId,
        suite: input.suite,
        framework: input.command,
        status: 'running',
      })
      .returning();

    await ctx.emit({
      type: 'test.started',
      summary: `Running test suite: ${input.suite}`,
      payload: { testRunId: testRun!.id },
    });

    const startedAt = Date.now();
    const result = await runCommand({
      projectId: ctx.projectId,
      runId: ctx.runId,
      toolCallId: null,
      command: input.command,
      argv: input.argv,
      cwd: input.cwd,
      kind: 'one-shot',
      timeoutMs: input.timeoutMs,
    });

    const parsed = parseTestOutput(`${result.stdout}\n${result.stderr}`);
    const durationMs = Date.now() - startedAt;
    // A non-zero exit code is authoritative: never report a pass the runner
    // itself called a failure, even if the summary line looked fine.
    const passed = result.exitCode === 0;
    const status = result.exitCode === null ? 'error' : passed ? 'passed' : 'failed';

    await db
      .update(schema.testRuns)
      .set({
        status,
        total: parsed.total,
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        failures: parsed.failures,
        output: tail(`${result.stdout}\n${result.stderr}`, 100000),
        durationMs,
        finishedAt: new Date(),
      })
      .where(eq(schema.testRuns.id, testRun!.id));

    const summary = parsed.total > 0
      ? `${parsed.passed}/${parsed.total} tests passed${parsed.failed > 0 ? `, ${parsed.failed} failed` : ''}`
      : `Test suite ${input.suite} ${status}${result.exitCode !== 0 ? ` (exit ${result.exitCode})` : ''}`;

    await ctx.emit({
      type: parsed.failed > 0 ? 'test.failed' : 'test.passed',
      level: parsed.failed > 0 || !passed ? 'error' : 'success',
      summary,
      payload: { testRunId: testRun!.id, ...parsed, exitCode: result.exitCode },
    });

    return {
      ok: passed,
      summary,
      data: {
        testRunId: testRun!.id,
        status,
        exitCode: result.exitCode,
        ...parsed,
        output: tail(result.stdout, 20000),
        stderr: tail(result.stderr, 8000),
      },
      error: passed ? undefined : summary,
    };
  },
});

/**
 * Parse pass/fail counts from common runners. Deliberately conservative: when a
 * runner's output cannot be understood, the counts stay zero and the exit code
 * decides the verdict, rather than inventing a number.
 */
export function parseTestOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ name: string; message: string }>;
} {
  const result = { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] as Array<{ name: string; message: string }> };

  // Vitest:  Tests  12 passed | 1 failed (13)
  const vitest = /Tests\s+([^\n]*)/i.exec(output);
  if (vitest?.[1]) {
    const line = vitest[1];
    const p = /(\d+)\s+passed/i.exec(line);
    const f = /(\d+)\s+failed/i.exec(line);
    const s = /(\d+)\s+skipped/i.exec(line);
    const t = /\((\d+)\)/.exec(line);
    if (p) result.passed = Number.parseInt(p[1]!, 10);
    if (f) result.failed = Number.parseInt(f[1]!, 10);
    if (s) result.skipped = Number.parseInt(s[1]!, 10);
    result.total = t ? Number.parseInt(t[1]!, 10) : result.passed + result.failed + result.skipped;
  }

  // Jest: Tests:       1 failed, 12 passed, 13 total
  if (result.total === 0) {
    const jestTotal = /Tests:\s+(.*)/i.exec(output);
    if (jestTotal?.[1]) {
      const line = jestTotal[1];
      const p = /(\d+)\s+passed/i.exec(line);
      const f = /(\d+)\s+failed/i.exec(line);
      const s = /(\d+)\s+skipped/i.exec(line);
      const t = /(\d+)\s+total/i.exec(line);
      if (p) result.passed = Number.parseInt(p[1]!, 10);
      if (f) result.failed = Number.parseInt(f[1]!, 10);
      if (s) result.skipped = Number.parseInt(s[1]!, 10);
      if (t) result.total = Number.parseInt(t[1]!, 10);
    }
  }

  // pytest: ===== 12 passed, 1 failed in 3.21s =====
  if (result.total === 0) {
    const pytest = /(\d+) passed(?:, (\d+) failed)?/.exec(output);
    if (pytest) {
      result.passed = Number.parseInt(pytest[1]!, 10);
      result.failed = pytest[2] ? Number.parseInt(pytest[2], 10) : 0;
      result.total = result.passed + result.failed;
    }
  }

  // Collect failure headlines from Vitest/Jest style output.
  const failureMatches = output.matchAll(/(?:FAIL|✕|×)\s+([^\n]{1,200})/g);
  for (const match of failureMatches) {
    if (result.failures.length >= 25) break;
    result.failures.push({ name: match[1]!.trim(), message: '' });
  }

  return result;
}

function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

export const COMMAND_TOOLS: ErasedTool[] = [runCommandTool, runTestsTool];

/**
 * Dev-server lifecycle helper used by the workbench preview panel.
 * Starts the server if it is not already running, and returns its URL.
 */
export async function ensureDevServer(
  ctx: ToolContext,
  opts: { command?: string; argv?: string[]; cwd?: string } = {},
): Promise<{ ok: boolean; url: string | null; commandId: string | null; message: string }> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.commands)
    .where(
      and(
        eq(schema.commands.projectId, ctx.projectId),
        eq(schema.commands.kind, 'dev-server'),
        eq(schema.commands.status, 'running'),
      ),
    )
    .limit(1);

  if (existing[0]?.previewUrl) {
    return { ok: true, url: existing[0].previewUrl, commandId: existing[0].id, message: 'Dev server already running' };
  }

  const pkg = await readPackageJson(ctx);
  const devScript = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null;
  const command = opts.command ?? 'npm';
  const argv = opts.argv ?? (devScript ? ['run', devScript] : ['run', 'dev']);

  if (!devScript && !opts.argv) {
    return {
      ok: false,
      url: null,
      commandId: null,
      message: 'No dev script found in package.json. Specify the command explicitly.',
    };
  }

  const result = await runCommand({
    projectId: ctx.projectId,
    runId: ctx.runId,
    toolCallId: null,
    command,
    argv,
    cwd: opts.cwd ?? '.',
    kind: 'dev-server',
    timeoutMs: 10 * 60 * 1000,
  });

  return {
    ok: Boolean(result.previewUrl),
    url: result.previewUrl ?? null,
    commandId: result.commandId,
    message: result.previewUrl ? 'Dev server started' : 'Dev server did not report a URL',
  };
}

async function readPackageJson(ctx: ToolContext): Promise<{ scripts?: Record<string, string> } | null> {
  try {
    const raw = await fs.readFile(path.join(ctx.sandboxRoot, 'package.json'), 'utf8');
    return JSON.parse(raw) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

export const SANDBOX_ROOT = env.sandbox.root;
