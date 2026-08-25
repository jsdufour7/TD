import path from 'node:path';
import { mkdirSync, realpathSync, existsSync, statSync } from 'node:fs';
import { env } from './env';
import { AppError } from './errors';

/**
 * Project sandbox (§12, §41).
 *
 * Every project owns a directory under AI_CORE_SANDBOX_ROOT. File tools and
 * command execution are confined to it by resolving the requested path and
 * verifying it is still inside the root before anything touches the disk.
 *
 * IMPORTANT — honest scope statement. This is V1 path-confinement sandboxing.
 * It stops path traversal and accidental cross-project writes. It is NOT
 * container isolation: a process running inside the sandbox still shares the
 * host kernel, user and network. True isolation requires containers or a
 * sandboxing runtime, which is tracked in BACKLOG.md and SECURITY.md.
 */

export type Sandbox = {
  projectId: string;
  root: string;
  /** Absolute path of the linked repository working copy, if any. */
  repoPath?: string;
};

export function sandboxRootForProject(projectId: string): string {
  // projectId is a uuid from our own database; validated anyway so a malformed
  // value can never be used to build a path.
  if (!/^[a-f0-9-]{8,64}$/i.test(projectId)) {
    throw new AppError('validation', 'Invalid project id');
  }
  return path.join(env.sandbox.root, projectId);
}

export function ensureProjectSandbox(projectId: string): string {
  const root = sandboxRootForProject(projectId);
  mkdirSync(root, { recursive: true });
  return root;
}

export async function ensureProjectWorkspaceSandbox(projectId: string): Promise<string> {
  const root = sandboxRootForProject(projectId);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root, { recursive: true });
  return root;
}

/**
 * Resolve a caller-supplied relative path inside the sandbox.
 *
 * Rejects: absolute paths, `..` escapes, symlink escapes (resolved with
 * realpath when the target exists), and the null byte trick.
 */
export function resolveSandboxPath(root: string, requested: string): string {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new AppError('path_escape', 'Path is required');
  }
  if (requested.includes('\0')) {
    throw new AppError('path_escape', 'Path contains a null byte');
  }
  if (path.isAbsolute(requested)) {
    throw new AppError('path_escape', `Absolute paths are not allowed: ${requested}`);
  }

  const rootReal = safeRealpath(root);
  const joined = path.join(rootReal, requested);

  // Static containment check first — cheap and catches the obvious cases.
  if (joined !== rootReal && !joined.startsWith(rootReal + path.sep)) {
    throw new AppError('path_escape', `Path escapes the project sandbox: ${requested}`);
  }

  // If the target (or any existing ancestor) is a symlink pointing outside,
  // the realpath check catches it.
  const resolvedReal = safeRealpath(joined);
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(rootReal + path.sep)) {
    throw new AppError('path_escape', `Path escapes the project sandbox via symlink: ${requested}`);
  }

  return joined;
}

function safeRealpath(target: string): string {
  if (existsSync(target)) {
    try {
      return realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  }
  // Walk up to the nearest existing ancestor, realpath that, and re-append the
  // remainder. This keeps the symlink check meaningful for not-yet-created files.
  const segments = path.resolve(target).split(path.sep);
  for (let i = segments.length; i > 0; i -= 1) {
    const candidate = segments.slice(0, i).join(path.sep) || path.sep;
    if (existsSync(candidate)) {
      let real: string;
      try {
        real = realpathSync(candidate);
      } catch {
        real = candidate;
      }
      const rest = segments.slice(i);
      return rest.length > 0 ? path.join(real, ...rest) : real;
    }
  }
  return path.resolve(target);
}

/** Relative path of an absolute path within the sandbox, for display and storage. */
export function toRelativePath(root: string, absolute: string): string {
  const rel = path.relative(path.resolve(root), path.resolve(absolute));
  return rel.split(path.sep).join('/');
}

export function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Directories and files agents should never wander into. Applied by listing and
 * search tools so a repository scan does not drown in node_modules.
 */
export const IGNORED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.data',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.venv',
  '__pycache__',
  '.playwright',
  'test-results',
  'playwright-report',
]);

export function isIgnoredSegment(segment: string): boolean {
  return IGNORED_PATH_SEGMENTS.has(segment);
}
