import { describe, expect, it } from 'vitest';
import { parseTestOutput } from '@/tools/command-tools';
import { detectPreviewUrl } from '@/engine/command-runner';
import { estimateCostUsd } from '@/ai/provider';
import { redactSecrets } from '@/lib/env';

/**
 * Verification must never invent a number (§50). These tests pin the parser to
 * real runner output and confirm it stays silent when it cannot understand the
 * format, so the exit code remains the authority.
 */
describe('test output parsing', () => {
  it('parses Vitest summary lines', () => {
    const output = `
 Test Files  3 passed (3)
      Tests  12 passed | 1 failed (13)
   Start at  10:00:00
`;
    const result = parseTestOutput(output);
    expect(result.passed).toBe(12);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(13);
  });

  it('parses Vitest output with no failures', () => {
    const result = parseTestOutput('      Tests  2 passed (2)');
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
  });

  it('parses Jest summary lines', () => {
    const output = 'Tests:       1 failed, 12 passed, 13 total';
    const result = parseTestOutput(output);
    expect(result.passed).toBe(12);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(13);
  });

  it('parses pytest summary lines', () => {
    const result = parseTestOutput('===== 12 passed, 1 failed in 3.21s =====');
    expect(result.passed).toBe(12);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(13);
  });

  it('collects failure headlines', () => {
    const output = 'FAIL  src/a.test.ts > greets\n✕ handles empty input';
    const result = parseTestOutput(output);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]!.name).toContain('greets');
  });

  it('returns zero counts for an unrecognised format rather than guessing', () => {
    const result = parseTestOutput('some completely unfamiliar runner output');
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe('dev server URL detection', () => {
  it('finds a localhost URL', () => {
    expect(detectPreviewUrl('  ➜  Local:   http://localhost:3000/  ')).toBe('http://localhost:3000/');
  });

  it('rewrites a 0.0.0.0 bind address to localhost', () => {
    expect(detectPreviewUrl('Server listening on http://0.0.0.0:8080')).toBe('http://localhost:8080');
  });

  it('returns null when no URL is present', () => {
    expect(detectPreviewUrl('compiling...\ndone.')).toBeNull();
  });
});

describe('cost estimation', () => {
  it('computes cost from per-million-token prices', () => {
    // 1M input at $3 + 1M output at $15 = $18
    expect(estimateCostUsd(1_000_000, 1_000_000, '3.00', '15.00')).toBe('18.000000');
  });

  it('returns zero for local models', () => {
    expect(estimateCostUsd(50_000, 20_000, '0', '0')).toBe('0.000000');
  });

  it('treats unparseable prices as zero rather than NaN', () => {
    const cost = estimateCostUsd(1000, 1000, 'not-a-number', 'also-bad');
    expect(cost).toBe('0.000000');
    expect(Number.isNaN(Number.parseFloat(cost))).toBe(false);
  });
});

describe('secret redaction', () => {
  it('redacts OpenAI-style keys', () => {
    expect(redactSecrets('key is sk-abcdefgh12345678')).not.toContain('sk-abcdefgh12345678');
    expect(redactSecrets('key is sk-abcdefgh12345678')).toContain('[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    const out = redactSecrets('Authorization: Bearer abcdefghijklmnop1234');
    expect(out).not.toContain('abcdefghijklmnop1234');
  });

  it('redacts passwords inside database URLs', () => {
    const out = redactSecrets('postgres://user:hunter2secret@localhost:5432/db');
    expect(out).not.toContain('hunter2secret');
    expect(out).toContain('localhost');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'The build completed in 12.4 seconds.';
    expect(redactSecrets(text)).toBe(text);
  });
});
