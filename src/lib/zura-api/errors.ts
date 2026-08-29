/**
 * Typed errors.
 *
 * Every failure the API reports arrives as the same `ApiError` envelope, so a
 * caller can branch on `error.code` rather than parsing messages. Transport
 * problems are separate classes, because "the network died" and "the server
 * said 403" call for different handling.
 */
import type { ApiErrorBody, ValidationIssue } from "./types";

/** Base class, so `catch (e) { if (e instanceof ZuraError) ... }` works. */
export class ZuraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Keeps `instanceof` working when compiled down to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The server responded with a non-2xx status and an ApiError body. */
export class ZuraApiError extends ZuraError {
  readonly status: number;
  /** Stable machine-readable code, e.g. `checksum_mismatch`. */
  readonly code: string;
  /** Correlates with the server log; quote it in a bug report. */
  readonly requestId: string;
  readonly details: ValidationIssue[];
  readonly retryAfterSeconds: number | null;
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message || `Request failed with status ${status}`);
    this.status = status;
    this.code = body.error;
    this.requestId = body.request_id;
    this.details = (body.details ?? []) as ValidationIssue[];
    this.retryAfterSeconds = body.retry_after_seconds ?? null;
    this.body = body;
  }

  get isAuthProblem(): boolean {
    return this.status === 401;
  }

  get isNotFoundOrHidden(): boolean {
    // The API answers 404 for a private resource so ids cannot be enumerated;
    // treat "missing" and "not yours" identically in the UI.
    return this.status === 404;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** The server answered, but not with a JSON ApiError body. */
export class ZuraUnexpectedResponseError extends ZuraError {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, bodyText: string) {
    super(`The API returned an unexpected ${status} response.`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

/** The request never completed: DNS, TLS, offline, CORS rejection. */
export class ZuraNetworkError extends ZuraError {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** The request exceeded the configured timeout and was aborted. */
export class ZuraTimeoutError extends ZuraError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`The request timed out after ${timeoutMs} ms.`);
    this.timeoutMs = timeoutMs;
  }
}

/** The caller's own AbortSignal fired. */
export class ZuraAbortError extends ZuraError {
  constructor() {
    super("The request was aborted by the caller.");
  }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.error === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.status_code === "number" &&
    typeof candidate.request_id === "string"
  );
}
