import { AppError } from '../../utils/errors.js';

/** 404 for unknown /api routes. */
export function notFoundHandler(request, response) {
  response.status(404).json({
    error: { message: 'That endpoint does not exist.', code: 'not_found' }
  });
}

/**
 * Central error handler.
 *
 * Users get a short, actionable sentence plus a list of specific problems.
 * Stack traces and filesystem paths stay in the server log.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity.
export function errorHandler(error, request, response, next) {
  const isAppError = error instanceof AppError;
  const status = isAppError ? error.status : 500;

  const logLine = `[${new Date().toISOString()}] ${request.method} ${request.originalUrl} -> ${status}`;
  if (status >= 500) {
    console.error(logLine, error.stack ?? error);
  } else {
    console.warn(logLine, isAppError ? (error.detail ?? error.message) : error.message);
  }

  if (response.headersSent) return;

  response.status(status).json({
    error: {
      message: isAppError ? error.message : 'Something went wrong while handling that request. Please try again.',
      code: isAppError ? error.code : 'server_error',
      problems: isAppError ? error.errors : []
    }
  });
}
