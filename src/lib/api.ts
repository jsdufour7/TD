import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError } from './errors';
import { createLogger } from './logger';
import { redactSecrets } from './env';

const log = createLogger('api');

/**
 * Route handler wrapper.
 *
 * Every error leaves as a structured JSON body with a stable code. Internal
 * errors are logged in full but return only a generic message, and everything is
 * passed through redactSecrets so a credential can never leak through an error.
 */

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  // Wrapper libraries (Drizzle, PGlite) put the real reason in `cause`. Logging
  // only the outer message produced entries like
  //   Failed query: select ... from "users" ...
  // with no indication of whether the table was missing, the database was
  // locked, or the WASM instance had aborted — which made a reproducible
  // failure impossible to diagnose from the log alone.
  log.error('unhandled route error', {
    error: message,
    ...(describeCauseChain(error) ? { cause: describeCauseChain(error) } : {}),
  });
  return NextResponse.json(
    { error: { code: 'internal', message: redactSecrets('An unexpected error occurred. It has been logged.') } },
    { status: 500 },
  );
}

/**
 * Walk an error's `cause` chain and return it as readable strings.
 *
 * Bounded, because a cyclic or absurdly deep chain must not blow up the log.
 */
export function describeCauseChain(error: unknown, limit = 5): string[] {
  const chain: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  let depth = 0;

  while (current && depth < limit) {
    if (current instanceof Error) {
      chain.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      chain.push(String(current));
      break;
    }
    depth += 1;
  }

  return chain;
}

/** Parse and validate a JSON request body. */
export async function parseBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('validation', 'Request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      'validation',
      `Invalid request: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

/** Parse and validate query parameters. */
export function parseQuery<Schema extends z.ZodType>(
  url: URL,
  schema: Schema,
): z.infer<Schema> {
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      'validation',
      `Invalid query: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
