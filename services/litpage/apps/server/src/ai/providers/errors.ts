// Errors shared by every model provider (re-exported by ../client.ts, which callers import). Lives here so the
// provider modules can use it without an import cycle through client.ts.

export type AiErrorCode =
  | 'no_key' | 'invalid_key' | 'permission' | 'not_found' | 'rate_limited' | 'overloaded' | 'bad_request' | 'network'
  | 'refusal' | 'aborted' | 'forbidden' | 'unknown';

export class AiError extends Error {
  code: AiErrorCode;
  status: number;
  constructor(code: AiErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * An error reported by a provider's HTTP API. `httpStatus` / `requestId` / `detail` (the provider's own message,
 * already scrubbed of keys) are for server logs only; `message` is the user-facing text.
 */
export class ProviderError extends AiError {
  httpStatus?: number;
  requestId?: string;
  detail?: string;
  /** provider's Retry-After (ms); Infinity = too long to wait inside a request */
  retryAfterMs?: number;
  constructor(code: AiErrorCode, message: string, status: number, extra: { httpStatus?: number; requestId?: string; detail?: string } = {}) {
    super(code, message, status);
    this.httpStatus = extra.httpStatus;
    this.requestId = extra.requestId;
    this.detail = extra.detail;
  }
}

/** The error a cancelled request ends with (runStream treats any error after the signal fired as "stopped"). */
export function abortError(): AiError {
  return new AiError('aborted', 'Stopped.', 499);
}
