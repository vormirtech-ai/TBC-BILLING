import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** An error with an HTTP status the API is happy to show the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Please sign in again.') => new HttpError(401, message);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const conflict = (message: string) => new HttpError(409, message);

/** Wraps an async route so a rejected promise reaches the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req as T, res, next).catch(next);
  };
}

function isPrismaError(error: unknown): error is { code: string; meta?: Record<string, unknown> } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string';
}

/**
 * Turns anything thrown inside a route into a predictable JSON body. The app
 * must never crash on bad input, so unknown failures become a 500 with a plain
 * message rather than an unhandled rejection.
 */
export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: 'Please check the highlighted fields.',
      details: error.errors.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  if (isPrismaError(error)) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]).join(', ') : 'value';
      res.status(409).json({ error: `That ${target} is already in use.` });
      return;
    }
    if (error.code === 'P2003') {
      res.status(409).json({ error: 'This record is linked to other data and cannot be changed.' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
  }

  console.error('[api] unhandled error:', error);
  res.status(500).json({ error: 'Something went wrong on the server. The action was not saved.' });
}
