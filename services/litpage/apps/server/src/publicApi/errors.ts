// public API error objects: { object: "error", status, code, message, request_id }.
// Status codes: invalid_json, invalid_request_url, invalid_request, validation_error,
// unauthorized, forbidden, object_not_found, conflict_error, rate_limited,
// internal_server_error, service_unavailable.
export type ApiErrorCode =
  | 'invalid_json' | 'invalid_request_url' | 'invalid_request' | 'validation_error' | 'unauthorized'
  | 'forbidden' | 'object_not_found' | 'conflict_error' | 'rate_limited' | 'internal_server_error' | 'service_unavailable';

const STATUS: Record<ApiErrorCode, number> = {
  invalid_json: 400, invalid_request_url: 400, invalid_request: 400, validation_error: 400, unauthorized: 401,
  forbidden: 403, object_not_found: 404, conflict_error: 409, rate_limited: 429, internal_server_error: 500, service_unavailable: 503,
};

export class PublicApiError extends Error {
  code: ApiErrorCode;
  status: number;
  /** seconds (rate_limited) */
  retryAfter?: number;
  constructor(code: ApiErrorCode, message: string, opts: { retryAfter?: number } = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.retryAfter = opts.retryAfter;
  }
}

export const notFound = (kind: string, id: string) =>
  new PublicApiError('object_not_found', `Not found: no ${kind} with id ${id} is available to this connection.`);

export const restricted = (what = 'Access denied: this connection cannot use this endpoint.') => new PublicApiError('forbidden', what.startsWith('Access denied:') ? what : `Access denied: ${what}`);

export const invalid = (message: string) => new PublicApiError('validation_error', message.startsWith('Invalid request:') ? message : `Invalid request: ${message}`);

export function errorBody(e: PublicApiError, requestId: string) {
  return { object: 'error', status: e.status, code: e.code, message: e.message, request_id: requestId };
}
