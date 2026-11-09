import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

/** Any URL that no route matched. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

/**
 * Central error handler. Express 5 forwards errors thrown in async route
 * handlers here automatically, so routes never need try/catch just to reply.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  // Body that is not valid JSON
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }

  logger.error('Unexpected error', error);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}
