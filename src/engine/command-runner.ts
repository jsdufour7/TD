import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import crossSpawn from 'cross-spawn';import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { AppError } from '@/lib/errors';
import { resolveSandboxPath } from '@/lib/sandbox';
import { createLogger } from '@/lib/logger';
import { env } from '@/lib/env';
import { emitAndNotify } from './events';

const log = createLogger('command-runner');

/**
 * Safe command execution (§12).
 *
 * Security posture, stated plainly:
 *  - Commands are executed with `spawn(cmd, argv, { shell: false })`. The argv
 *    array is passed straight to execve, so shell metacharacters in an argument
 *    are literal text and cannot inject a second command. Agent-generated shell
 *    strings are never handed to a shell.
 *  - `cwd` is resolved through the sandbox guard, so a command cannot be run
 *    with a working directory outside the project.
 *  - Every command is persisted (argv, cwd, stdout, stderr, exit code, timing)
 *    so the UI can show history after a refresh.
 *  - Cancellation kills the whole process group.
 *
 * This is host-process execution, not container isolation. See SECURITY.md.
 */

const MAX_CAPTURED_BYTES = 512 * 1024;

/** Commands that are refused outright, even with an approval request. */
const FORBIDDEN_BINARIES = new Set(['rm', 'mkfs', 'dd', 'shutdown', 'reboot', 'halt', 'poweroff', ':(){']);

/** Argument patterns that indicate an attempt to escape the sandbox. */
const SUSPICIOUS_ARGS = [/&&/, /\|\|/, /`/, /\$\(/, /;\s*rm/, />\s*\/etc/];

export type RunCommandInput = {
  projectId: string;
  runId: string | null;
  toolCallId: string | null;
  /** Executable, e.g. 'npm' */
  command: string;
  argv: string[];
  /** Relative to the sandbox root. Defaults to the sandbox root. */
  cwd?: string;
  label?: string;
  kind?: 'one-shot' | 'dev-server';
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type CommandResult = {
  commandId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  status: string;
  durationMs: number;
  previewUrl?: string | null;
};

/** Live processes, keyed by command id, for cancellation and dev servers. */
const live = new Map<string, { child: ChildProcessWithoutNullStreams; killed: boolean }>();

export function liveCommandCount(): number {
  return live.size;
}

function assertSafeArgv(command: string, argv: string[]): void {
  if (FORBIDDEN_BINARIES.has(command)) {
    throw new AppError('tool_denied', `Refusing to execute forbidden command: ${command}`);
  }
  for (const arg of argv) {
    if (arg.includes('\0')) {
      throw new AppError('tool_denied', 'Command arguments may not contain null bytes');
    }
    for (const pattern of SUSPICIOUS_ARGS) {
      // These are only meaningful to a shell. Since we never use a shell they
      // are harmless, but rejecting them stops an agent from smuggling a shell
      // invocation through an argument list that later gets re-interpreted.
      if (pattern.test(arg)) {
        throw new AppError(
          'tool_denied',
          `Command argument contains shell control characters and was refused: ${JSON.stringify(arg)}`,
        );
      }
    }
  }
}

/** Extract the first http(s) URL from output — used for dev-server preview. */
export function detectPreviewUrl(output: string): string | null {
  const patterns = [
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s"'<>)]*/g,
    /Local:\s+(https?:\/\/[^\s]+)/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[0]) {
      const url = match[0].replace(/[.,;)]+$/, '');
      // 0.0.0.0 is a bind address, not a browsable one.
      return url.replace('0.0.0.0', 'localhost');
    }
  }
  return null;
}

export async function runCommand(input: RunCommandInput): Promise<CommandResult> {
  assertSafeArgv(input.command, input.argv);

  const sandboxRoot = resolveSandboxPath(env.sandbox.root, input.projectId);
  const cwd = resolveSandboxPath(sandboxRoot, input.cwd ?? '.');

  const db = await getDb();
  const [record] = await db
    .insert(schema.commands)
    .values({
      projectId: input.projectId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      label: input.label ?? [input.command, ...input.argv].join(' ').slice(0, 200),
      argv: [input.command, ...input.argv],
      cwd,
      kind: input.kind ?? 'one-shot',
      status: 'running',
      timeoutMs: input.timeoutMs ?? env.runEngine.commandTimeoutMs,
    })
    .returning();

  const commandId = record!.id;
  const startedAt = Date.now();

  if (input.runId) {
    await emitAndNotify({
      runId: input.runId,
      projectId: input.projectId,
      type: 'command.started',
      actor: 'command-runner',
      summary: `Running ${record!.label}`,
      payload: { commandId },
    });
  }

  return new Promise<CommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let previewUrl: string | null = null;

    const child = crossSpawn(input.command, input.argv, {
      cwd,
      shell: false,
      detached: true, // own process group so we can kill the whole tree
      env: {
        ...process.env,
        // Never let a child inherit a credential it does not need.
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
        GITHUB_TOKEN: undefined,
        AI_CORE_MASTER_KEY: undefined,
        CI: '1',
        FORCE_COLOR: '0',
        ...(input.env ?? {}),
      },
    }) as unknown as ChildProcessWithoutNullStreams;

    live.set(commandId, { child, killed: false });

    const timeoutMs = input.timeoutMs ?? env.runEngine.commandTimeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (input.kind === 'dev-server') return; // dev servers are meant to run
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        if (stdout.length < MAX_CAPTURED_BYTES) stdout += text;
        else stdoutTruncated = true;
      } else if (stderr.length < MAX_CAPTURED_BYTES) stderr += text;
      else stderrTruncated = true;

      const detected = detectPreviewUrl(text);
      if (detected && !previewUrl) previewUrl = detected;
    };

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));

    const finish = async (exitCode: number | null, status: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(commandId);

      const durationMs = Date.now() - startedAt;
      const stdoutFinal = stdoutTruncated
        ? `${stdout}\n\n[output truncated at ${MAX_CAPTURED_BYTES} bytes]`
        : stdout;
      const stderrFinal = stderrTruncated
        ? `${stderr}\n\n[output truncated at ${MAX_CAPTURED_BYTES} bytes]`
        : stderr;

      await db
        .update(schema.commands)
        .set({
          status,
          exitCode,
          stdout: stdoutFinal,
          stderr: stderrFinal,
          pid: child.pid ?? null,
          previewUrl,
          durationMs,
          finishedAt: new Date(),
        })
        .where(eq(schema.commands.id, commandId));

      if (input.runId) {
        const eventType =
          status === 'succeeded'
            ? 'command.completed'
            : status === 'cancelled'
              ? 'command.completed'
              : 'command.failed';
        await emitAndNotify({
          runId: input.runId,
          projectId: input.projectId,
          type: eventType,
          level: status === 'succeeded' ? 'success' : 'warning',
          actor: 'command-runner',
          summary:
            status === 'timeout'
              ? `${record!.label} timed out after ${Math.round(timeoutMs / 1000)}s`
              : `${record!.label} exited with code ${exitCode ?? 'unknown'}`,
          payload: {
            commandId,
            exitCode,
            status,
            durationMs,
            stderrTail: stderrFinal.slice(-2000),
            previewUrl,
          },
        });
      }

      resolve({
        commandId,
        exitCode,
        stdout: stdoutFinal,
        stderr: stderrFinal,
        status,
        durationMs,
        previewUrl,
      });
    };

    child.on('error', (error) => {
      log.warn('command spawn failed', { command: input.command, error: error.message });
      stderr += `\nFailed to start process: ${error.message}`;
      void finish(null, 'failed');
    });

    child.on('close', (code) => {
      if (timedOut) void finish(code, 'timeout');
      else if (live.get(commandId)?.killed) void finish(code, 'cancelled');
      else void finish(code, code === 0 ? 'succeeded' : 'failed');
    });

    // Dev servers: resolve as soon as a preview URL is seen, leaving the process
    // running under lifecycle management.
    if (input.kind === 'dev-server') {
      const startedWaiting = Date.now();
      const poll = setInterval(async () => {
        if (settled) {
          clearInterval(poll);
          return;
        }
        if (previewUrl || Date.now() - startedWaiting > 120_000) {
          clearInterval(poll);
          await db
            .update(schema.commands)
            .set({
              status: previewUrl ? 'running' : 'failed',
              previewUrl,
              stdout,
              stderr,
              pid: child.pid ?? null,
            })
            .where(eq(schema.commands.id, commandId));
          // NOTE: deliberately NOT removed from `live`. A dev server keeps
          // running after this promise resolves, and stopProjectDevServers /
          // cancelCommand must still be able to reach it to kill it.
          settled = true;
          clearTimeout(timer);
          if (input.runId) {
            await emitAndNotify({
              runId: input.runId,
              projectId: input.projectId,
              type: previewUrl ? 'preview.started' : 'preview.error',
              level: previewUrl ? 'success' : 'warning',
              actor: 'command-runner',
              summary: previewUrl
                ? `Dev server is up at ${previewUrl}`
                : 'Dev server did not report a URL within 120s',
              payload: { commandId, previewUrl },
            });
          }
          resolve({
            commandId,
            exitCode: null,
            stdout,
            stderr,
            status: previewUrl ? 'running' : 'failed',
            durationMs: Date.now() - startedAt,
            previewUrl,
          });
        }
      }, 500);
    }
  });
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, 3000);
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Cancel a live command. Used by run cancellation and the UI stop button. */
export async function cancelCommand(commandId: string): Promise<boolean> {
  const entry = live.get(commandId);
  const db = await getDb();

  if (!entry) {
    // Not live in this process (e.g. after a server restart): mark the row so
    // the UI does not show a command as running forever.
    await db
      .update(schema.commands)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.commands.id, commandId));
    return false;
  }

  entry.killed = true;
  killTree(entry.child);
  live.delete(commandId);
  // For one-shot commands the close handler writes the final row, but for dev
  // servers the promise has already resolved, so nothing else would update it.
  await db
    .update(schema.commands)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(eq(schema.commands.id, commandId));
  return true;
}

/** Stop every dev server belonging to a project. */
export async function stopProjectDevServers(projectId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.commands)
    .where(eq(schema.commands.projectId, projectId));
  let stopped = 0;
  for (const row of rows) {
    if (row.kind !== 'dev-server' || row.status !== 'running') continue;
    const entry = live.get(row.id);
    if (entry) {
      entry.killed = true;
      killTree(entry.child);
      stopped += 1;
    }
    await db
      .update(schema.commands)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.commands.id, row.id));
  }
  return stopped;
}
