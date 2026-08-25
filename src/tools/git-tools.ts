import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCommand } from '@/engine/command-runner';
import { defineTool, ok, fail, type ErasedTool, type ToolContext } from './types';

/**
 * Git tools (§11, §45).
 *
 * Every git invocation goes through the command runner, so it is persisted with
 * its full output and is cancellable like any other command. `git push` and
 * destructive operations are not exposed as tools at all — they are gated behind
 * the approval flow, and pushing is disabled per repository by default.
 */

async function git(
  ctx: ToolContext,
  args: string[],
  opts?: { cwd?: string; label?: string },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await runCommand({
    projectId: ctx.projectId,
    runId: ctx.runId,
    toolCallId: null,
    command: 'git',
    argv: args,
    cwd: opts?.cwd ?? '.',
    label: opts?.label ?? `git ${args.join(' ')}`.slice(0, 200),
    kind: 'one-shot',
    timeoutMs: 60_000,
  });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

async function hasGitRepo(ctx: ToolContext): Promise<boolean> {
  try {
    await fs.stat(path.join(ctx.sandboxRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}

export const gitStatusTool = defineTool({
  name: 'git_status',
  description: 'Show git status of the project repository: current branch, staged, unstaged and untracked files.',
  permission: 'read',
  inputSchema: z.object({
    path: z.string().default('.').describe('Repository directory relative to the project root'),
  }),
  async execute(input, ctx) {
    if (!(await hasGitRepo(ctx))) {
      return fail('No git repository found at the project root. Connect or initialise one first.');
    }
    const status = await git(ctx, ['status', '--porcelain=v1', '-b'], { cwd: input.path });
    if (status.code !== 0) return fail(`git status failed: ${status.stderr || status.stdout}`);

    const lines = status.stdout.split('\n').filter(Boolean);
    const branchLine = lines.find((l) => l.startsWith('## '));
    const branch = branchLine?.replace(/^## /, '').split('...')[0] ?? 'unknown';
    const changed = lines
      .filter((l) => !l.startsWith('## '))
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));

    return ok(`On ${branch}: ${changed.length} changed file(s)`, {
      branch,
      changedFiles: changed,
      clean: changed.length === 0,
      raw: status.stdout,
    });
  },
});

export const gitDiffTool = defineTool({
  name: 'git_diff',
  description:
    'Show the diff of uncommitted changes, or the diff between two refs. Use this to review changes before committing.',
  permission: 'read',
  inputSchema: z.object({
    path: z.string().default('.').describe('Repository directory relative to the project root'),
    file: z.string().optional().describe('Limit the diff to one file'),
    staged: z.boolean().optional().describe('Diff the staged index instead of the working tree'),
    ref: z.string().optional().describe('Compare against a ref, e.g. HEAD~1'),
    maxBytes: z.number().int().min(1000).max(200000).default(50000),
  }),
  async execute(input, ctx) {
    if (!(await hasGitRepo(ctx))) return fail('No git repository found at the project root.');

    const args = ['diff'];
    if (input.staged) args.push('--staged');
    if (input.ref) args.push(input.ref);
    args.push('--no-color');
    if (input.file) args.push('--', input.file);

    const result = await git(ctx, args, { cwd: input.path });
    if (result.code !== 0) return fail(`git diff failed: ${result.stderr || result.stdout}`);

    const diff = result.stdout;
    const truncated = diff.length > input.maxBytes;
    const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((m) => m[2]!);

    return ok(
      diff.trim().length === 0 ? 'No differences' : `Diff covers ${files.length} file(s)`,
      {
        diff: truncated ? diff.slice(0, input.maxBytes) : diff,
        files,
        truncated,
        bytes: diff.length,
      },
    );
  },
});

export const gitBranchTool = defineTool({
  name: 'git_branch',
  description: 'List branches, show the current branch, or create a new branch for a unit of work.',
  permission: 'write',
  inputSchema: z.object({
    action: z.enum(['list', 'current', 'create', 'checkout']),
    name: z.string().optional().describe('Branch name for create/checkout'),
    path: z.string().default('.'),
  }),
  async execute(input, ctx) {
    if (!(await hasGitRepo(ctx))) return fail('No git repository found at the project root.');

    if (input.action === 'list' || input.action === 'current') {
      const result = await git(ctx, ['branch', '--all', '--format=%(refname:short)'], { cwd: input.path });
      if (result.code !== 0) return fail(`git branch failed: ${result.stderr}`);
      const branches = result.stdout.split('\n').map((b) => b.trim()).filter(Boolean);
      const current = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: input.path });
      return ok(`${branches.length} branch(es), current: ${current.stdout.trim()}`, {
        branches,
        current: current.stdout.trim(),
      });
    }

    if (!input.name) return fail(`Branch name is required for action '${input.action}'`);
    // Branch names are validated to stop anything that git would interpret
    // specially, and to keep the working copy in a predictable state.
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(input.name) || input.name.includes('..')) {
      return fail(`Invalid branch name: ${input.name}`);
    }

    const args = input.action === 'create' ? ['checkout', '-b', input.name] : ['checkout', input.name];
    const result = await git(ctx, args, { cwd: input.path });
    if (result.code !== 0) {
      return fail(`git ${input.action} ${input.name} failed: ${result.stderr || result.stdout}`);
    }
    return ok(`${input.action === 'create' ? 'Created and checked out' : 'Checked out'} ${input.name}`, {
      branch: input.name,
      action: input.action,
    });
  },
});

export const gitCommitTool = defineTool({
  name: 'git_commit',
  description:
    'Stage all changes in the project repository and create a commit. Requires human approval when the repository is configured to require it.',
  permission: 'write',
  mutatesRepository: true,
  inputSchema: z.object({
    message: z.string().min(3).describe('Commit message'),
    paths: z.array(z.string()).optional().describe('Limit staging to these paths (default: all)'),
    requireApproval: z.boolean().default(true),
  }),
  async execute(input, ctx) {
    if (!(await hasGitRepo(ctx))) return fail('No git repository found at the project root.');

    if (input.requireApproval) {
      const decision = await ctx.requestApproval({
        category: 'git_commit',
        title: `Commit: ${input.message.split('\n')[0]}`,
        description:
          'AI Core will stage the listed changes and create a commit in the project repository. Nothing is pushed.',
        risk: 'medium',
        action: { tool: 'git_commit', message: input.message, paths: input.paths ?? 'all' },
      });
      if (decision.status !== 'approved') {
        return fail(`Commit was ${decision.status} by the user`);
      }
    }

    const stageArgs = ['add', ...(input.paths && input.paths.length > 0 ? input.paths : ['-A'])];
    const staged = await git(ctx, stageArgs);
    if (staged.code !== 0) return fail(`git add failed: ${staged.stderr}`);

    const status = await git(ctx, ['diff', '--cached', '--name-only']);
    const files = status.stdout.split('\n').filter(Boolean);
    if (files.length === 0) return fail('Nothing staged to commit — the working tree is clean.');

    const commit = await git(ctx, [
      '-c',
      'user.name=TwoDots AI Core',
      '-c',
      'user.email=ai-core@twodots.local',
      'commit',
      '-m',
      input.message,
    ]);
    if (commit.code !== 0) return fail(`git commit failed: ${commit.stderr || commit.stdout}`);

    const sha = await git(ctx, ['rev-parse', 'HEAD']);
    const shaValue = sha.stdout.trim();

    return ok(`Committed ${files.length} file(s) as ${shaValue.slice(0, 7)}`, {
      sha: shaValue,
      files,
      message: input.message,
    });
  },
});

export const GIT_TOOLS: ErasedTool[] = [
  gitStatusTool,
  gitDiffTool,
  gitBranchTool,
  gitCommitTool,
];
