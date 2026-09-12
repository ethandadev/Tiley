/**
 * Application error type.
 *
 * `message` is always safe to show a user; internal detail goes in `detail`
 * and is only ever written to the server log.
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', detail = null, errors = [] } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
  }
}

export const badRequest = (message, errors = []) =>
  new AppError(message, { status: 400, code: 'bad_request', errors });

export const notFound = (message = 'The item could not be found.') =>
  new AppError(message, { status: 404, code: 'not_found' });

export const conflict = (message) =>
  new AppError(message, { status: 409, code: 'conflict' });

export const tooLarge = (message) =>
  new AppError(message, { status: 413, code: 'too_large' });

export const serverError = (message, detail) =>
  new AppError(message, { status: 500, code: 'server_error', detail });
