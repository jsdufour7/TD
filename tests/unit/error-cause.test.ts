import { describe, expect, it } from 'vitest';
import { describeCauseChain } from '@/lib/api';

/**
 * Wrapper libraries hide the real failure inside `cause`. Logging only the outer
 * message produced entries like `Failed query: select ... from "users"` with no
 * indication of whether the table was missing, the database was locked, or the
 * WASM instance had aborted. These tests lock in the fix.
 */
describe('describeCauseChain', () => {
  it('unwraps a nested database error to the real reason', () => {
    const root = new Error('relation "users" does not exist');
    const drizzle = new Error('Failed query: select ... from "users"', { cause: root });
    const outer = new Error('DrizzleQueryError', { cause: drizzle });

    const chain = describeCauseChain(outer);

    expect(chain).toEqual([
      'Error: Failed query: select ... from "users"',
      'Error: relation "users" does not exist',
    ]);
    // The whole point: the actionable detail is visible in the log.
    expect(chain.join(' ')).toContain('relation "users" does not exist');
  });

  it('returns an empty chain when there is no cause', () => {
    expect(describeCauseChain(new Error('plain failure'))).toEqual([]);
  });

  it('handles a non-Error cause', () => {
    const wrapped = new Error('outer', { cause: 'a string reason' });
    expect(describeCauseChain(wrapped)).toEqual(['a string reason']);
  });

  it('handles a non-Error input without throwing', () => {
    expect(describeCauseChain('not an error')).toEqual([]);
    expect(describeCauseChain(null)).toEqual([]);
    expect(describeCauseChain(undefined)).toEqual([]);
  });

  it('stops at the depth limit instead of looping forever', () => {
    // Build a chain longer than the limit.
    let error: Error = new Error('level-0');
    for (let i = 1; i <= 12; i += 1) {
      error = new Error(`level-${i}`, { cause: error });
    }

    const chain = describeCauseChain(error, 4);

    expect(chain).toHaveLength(4);
    expect(chain[0]).toContain('level-11');
  });

  it('survives a self-referential cause', () => {
    const cyclic = new Error('cyclic');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cyclic as any).cause = cyclic;

    // Must terminate rather than hang or throw.
    const chain = describeCauseChain(cyclic, 10);
    expect(chain.length).toBeLessThanOrEqual(10);
    expect(chain.every((entry) => entry.includes('cyclic'))).toBe(true);
  });
});
