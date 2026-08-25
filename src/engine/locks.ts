import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('locks');

/**
 * Concurrency safeguards (§26, §27).
 *
 * File locks and idempotency markers are implemented on the filesystem so they
 * work across processes (multiple workers), not just in memory. A lock is a
 * directory created atomically with `mkdir`; a stale lock (older than the TTL,
 * e.g. a crashed worker) is taken over rather than respected forever, which is
 * what makes a zombie run recoverable instead of permanently stuck.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function locksRoot(projectId: string): string {
  return path.join(env.sandbox.root, '..', 'locks', projectId);
}

function lockPath(projectId: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(locksRoot(projectId), `${safe}.lock`);
}

function isStale(lockPath: string, ttlMs: number): boolean {
  try {
    const info = statSync(lockPath);
    return Date.now() - info.mtimeMs > ttlMs;
  } catch {
    return true;
  }
}

/**
 * Try to acquire an exclusive lock. Returns true on success.
 * Atomic: `mkdir` fails if the directory already exists.
 */
export function tryAcquireLock(projectId: string, name: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const target = lockPath(projectId, name);
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    mkdirSync(target); // atomic exclusive create
    writeFileSync(path.join(target, 'meta.json'), JSON.stringify({ pid: process.pid, at: Date.now(), name }));
    return true;
  } catch {
    if (isStale(target, ttlMs)) {
      // Take over a stale (crashed-holder) lock.
      try {
        rmRecursive(target);
        mkdirSync(target);
        writeFileSync(path.join(target, 'meta.json'), JSON.stringify({ pid: process.pid, at: Date.now(), name, tookOver: true }));
        log.warn('took over stale lock', { projectId, name });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function releaseLock(projectId: string, name: string): void {
  try {
    rmRecursive(lockPath(projectId, name));
  } catch {
    /* already released */
  }
}

/**
 * Run `fn` while holding an exclusive lock on (projectId, name). Throws if the
 * lock cannot be acquired (another worker owns it).
 */
export async function withLock<T>(projectId: string, name: string, fn: () => Promise<T>): Promise<T> {
  if (!tryAcquireLock(projectId, name)) {
    throw new Error(`Resource busy (locked): ${name}`);
  }
  try {
    return await fn();
  } finally {
    releaseLock(projectId, name);
  }
}

/**
 * Idempotency: run `fn` at most once per (projectId, key). If it already ran,
 * return the stored marker instead of re-executing — preventing two workers from
 * executing the same task/run twice.
 */
export async function withIdempotency<T>(
  projectId: string,
  key: string,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; value?: T }> {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const marker = path.join(locksRoot(projectId), `done-${safe}.json`);
  mkdirSync(path.dirname(marker), { recursive: true });

  if (existsSync(marker)) {
    try {
      return { ran: false, value: JSON.parse(readFileSync(marker, 'utf8')) as T };
    } catch {
      return { ran: false };
    }
  }

  const value = await fn();
  try {
    writeFileSync(marker, JSON.stringify(value ?? {}));
  } catch {
    /* marker is best-effort; the lock already prevented concurrent runs */
  }
  return { ran: true, value };
}

function rmRecursive(target: string): void {
  rmSync(target, { recursive: true, force: true });
}

