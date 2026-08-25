import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Relative time that stays honest about the future and about "now". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function durationLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCost(usd: number | string | null | undefined): string {
  const value = typeof usd === 'string' ? Number.parseFloat(usd) : (usd ?? 0);
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export const STATUS_TONE: Record<string, string> = {
  // Runs
  running: 'accent',
  queued: 'idle',
  paused: 'warn',
  completed: 'ok',
  failed: 'danger',
  cancelled: 'idle',
  waiting_for_approval: 'warn',
  waiting_for_user: 'warn',
  // Tasks
  backlog: 'idle',
  planning: 'idle',
  ready: 'info',
  testing: 'info',
  reviewing: 'info',
  blocked: 'warn',
  // Agents
  idle: 'idle',
  working: 'accent',
  using_tool: 'accent',
  reviewing2: 'info',
  waiting: 'warn',
  // Providers
  online: 'ok',
  degraded: 'warn',
  offline: 'danger',
  unknown: 'idle',
  not_configured: 'idle',
  connected: 'ok',
  disconnected: 'idle',
  error: 'danger',
};

export function toneFor(status: string): string {
  return STATUS_TONE[status] ?? 'idle';
}
