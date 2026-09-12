/**
 * Express 4 does not forward rejected promises from async handlers, so every
 * async route is wrapped here. Without this a thrown AppError would hang the
 * request instead of reaching the error handler.
 */
export const asyncHandler = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};
