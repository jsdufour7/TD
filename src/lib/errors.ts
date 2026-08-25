/**
 * Error taxonomy. Every error the platform raises carries a stable `code` so the
 * UI can render a specific state and tests can assert on behaviour rather than
 * on message strings.
 */

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'project_isolation'
  | 'tool_denied'
  | 'path_escape'
  | 'provider_unavailable'
  | 'provider_offline'
  | 'budget_exceeded'
  | 'cancelled'
  | 'blocked'
  | 'internal';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options?: { status?: number; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? defaultStatus(code);
    this.details = options?.details;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
    case 'project_isolation':
    case 'tool_denied':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'validation':
    case 'path_escape':
      return 400;
    case 'provider_unavailable':
    case 'provider_offline':
      return 503;
    case 'budget_exceeded':
    case 'blocked':
      return 422;
    case 'cancelled':
      return 499;
    case 'internal':
    default:
      return 500;
  }
}

export function unauthorized(message = 'Authentication required'): AppError {
  return new AppError('unauthorized', message);
}

export function forbidden(message = 'Not permitted'): AppError {
  return new AppError('forbidden', message);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError('not_found', message);
}

export function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('validation', message, { details });
}

/** Raised when a caller tries to reach another project's resources (§8, §55). */
export function projectIsolationViolation(projectId: string, attempted: string): AppError {
  return new AppError('project_isolation', `Access denied: ${attempted} does not belong to project ${projectId}`);
}
