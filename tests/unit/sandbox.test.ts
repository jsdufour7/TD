import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSandboxPath, toRelativePath, isIgnoredSegment } from '@/lib/sandbox';
import { AppError } from '@/lib/errors';

/**
 * The sandbox path guard is the primary isolation boundary for file tools (§41).
 * These cases are the ones that matter: if any of them regresses, an agent can
 * read or write outside its project.
 */
describe('sandbox path confinement', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sandbox-'));

  it('resolves a normal relative path inside the root', () => {
    const resolved = resolveSandboxPath(root, 'src/index.ts');
    expect(resolved).toBe(path.join(root, 'src/index.ts'));
  });

  it('accepts "." as the root itself', () => {
    expect(resolveSandboxPath(root, '.')).toBe(path.resolve(root));
  });

  it('rejects parent-directory traversal', () => {
    expect(() => resolveSandboxPath(root, '../outside.txt')).toThrowError(AppError);
    expect(() => resolveSandboxPath(root, 'a/../../outside.txt')).toThrowError(AppError);
    expect(() => resolveSandboxPath(root, '../../../../etc/passwd')).toThrowError(AppError);
  });

  it('rejects absolute paths', () => {
    expect(() => resolveSandboxPath(root, '/etc/passwd')).toThrowError(/Absolute paths are not allowed/);
    expect(() => resolveSandboxPath(root, '/tmp/anything')).toThrowError(/Absolute paths are not allowed/);
  });

  it('rejects null bytes', () => {
    expect(() => resolveSandboxPath(root, 'ok.txt\0.png')).toThrowError(/null byte/);
  });

  it('rejects an empty path', () => {
    expect(() => resolveSandboxPath(root, '')).toThrowError(/Path is required/);
  });

  it('rejects a symlink that points outside the sandbox', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'top secret');

    const linkDir = path.join(root, 'links');
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(
  outside,
  path.join(linkDir, 'escape'),
  process.platform === 'win32' ? 'junction' : 'dir',
);

    // The static containment check passes (the path is textually inside the
    // root); only realpath resolution catches this.
    expect(() => resolveSandboxPath(root, 'links/escape/secret.txt')).toThrowError(/symlink/);
  });

  it('allows a symlink that stays inside the sandbox', () => {
    const target = path.join(root, 'real');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'a.txt'), 'fine');

    const linkDir = path.join(root, 'internal-links');
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(
  target,
  path.join(linkDir, 'to-real'),
  process.platform === 'win32' ? 'junction' : 'dir',
);

    expect(() => resolveSandboxPath(root, 'internal-links/to-real/a.txt')).not.toThrow();
  });

  it('uses the path_escape error code so callers can respond consistently', () => {
    try {
      resolveSandboxPath(root, '../escape');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('path_escape');
      expect((error as AppError).status).toBe(400);
    }
  });
});

describe('relative path rendering', () => {
  it('renders forward slashes regardless of platform', () => {
    const root = '/tmp/project';
    expect(toRelativePath(root, path.join(root, 'src', 'a', 'b.ts'))).toBe('src/a/b.ts');
  });
});

describe('ignored segments', () => {
  it('hides dependency and build directories from listing and search', () => {
    for (const segment of ['node_modules', '.git', '.next', 'dist', 'coverage', '__pycache__']) {
      expect(isIgnoredSegment(segment)).toBe(true);
    }
  });

  it('does not hide ordinary source directories', () => {
    for (const segment of ['src', 'app', 'lib', 'public', 'tests']) {
      expect(isIgnoredSegment(segment)).toBe(false);
    }
  });
});
