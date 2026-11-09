import type { z } from 'zod';
import { badRequest } from '../utils/httpError';

/**
 * Checks incoming data against a zod schema.
 * Returns the cleaned, correctly-typed data, or throws a 400 error that
 * tells the user exactly which field is wrong.
 */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${field}${issue.message}`);
  }
  return result.data;
}
