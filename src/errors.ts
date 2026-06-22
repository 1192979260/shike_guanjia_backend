export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Array<{ field: string; message: string }>) =>
  new HttpError(400, 'BAD_REQUEST', message, fields);
export const businessError = (code: string, message: string, fields?: Array<{ field: string; message: string }>) =>
  new HttpError(400, code, message, fields);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict') => new HttpError(409, 'CONFLICT', message);
export const rateLimited = (message = 'Too many requests') => new HttpError(429, 'RATE_LIMITED', message);

export function errorBody(error: unknown) {
  if (error instanceof HttpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        fields: error.fields,
      },
    };
  }
  return { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
}
