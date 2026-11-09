/**
 * An error that carries an HTTP status code and a message that is safe to
 * show to the user. Throw it anywhere; the error handler turns it into a
 * proper JSON response.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Please log in to continue.') => new HttpError(401, message);
export const forbidden = (message = 'You do not have permission to do this.') => new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
