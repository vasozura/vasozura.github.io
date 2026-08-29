/**
 * Typed client for the Zura Learning API.
 *
 * Dependency-free: it uses `fetch`, `AbortController` and the generated types
 * only, so it drops into a Vite app without pulling a runtime library in.
 *
 * Credentials are never embedded. The client asks for a token through the
 * `getAccessToken` callback at the moment of each request, so a rotated or
 * refreshed Supabase session is picked up without rebuilding the client, and
 * no token is ever stored on the instance or written to a log.
 */
import {
  ZuraAbortError,
  ZuraApiError,
  ZuraNetworkError,
  ZuraTimeoutError,
  ZuraUnexpectedResponseError,
  isApiErrorBody,
} from "./errors";
import type {
  AccordionCandidateResult,
  AccordionFingeringInput,
  AttemptEvaluateInput,
  AttemptResult,
  Exercise,
  ExerciseGenerateInput,
  GuitarFingeringInput,
  GuitarFingeringResponse,
  HealthResponse,
  PartsResponse,
  PianoFingeringInput,
  PianoFingeringResponse,
  ProcessResponse,
  ProgressRecordInput,
  ProgressSummary,
  ScoreManifest,
  ScoreProcessInput,
  ScoreReprocessInput,
  ScoreValidateInput,
  Timeline,
  ValidationReport,
  VersionResponse,
} from "./types";

export type TokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface RetryPolicy {
  /** Maximum retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  baseDelayMs?: number;
  /** Upper bound on any single delay. Default 4000. */
  maxDelayMs?: number;
  /**
   * Retry POST requests too. Off by default: every write in this API is
   * idempotent by contract (derived manifests, exercises, attempts and
   * progress rows are all keyed deterministically), but retrying a write
   * should still be an explicit decision by the caller.
   */
  retryWrites?: boolean;
}

export interface ZuraClientOptions {
  /** Absolute base URL of the deployment, e.g. `https://api.example.com`. */
  baseUrl: string;
  /** Called before each authenticated request. Return null to go anonymous. */
  getAccessToken?: TokenProvider;
  /** Injected for tests or a non-browser runtime. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Retry policy, or `false` to disable retries entirely. Default: GET only. */
  retry?: RetryPolicy | false;
  /** Extra headers sent with every request. Do not put credentials here. */
  defaultHeaders?: Record<string, string>;
  /** Optional correlation id prefix echoed back as `X-Request-ID`. */
  requestIdFactory?: () => string;
}

export interface RequestOptions {
  /** Caller's abort signal. Combined with the client timeout. */
  signal?: AbortSignal;
  /** Override the client timeout for this call. */
  timeoutMs?: number;
  /** Skip the token for this call - used for published, public reads. */
  anonymous?: boolean;
  /** Override the retry policy for this call. */
  retry?: RetryPolicy | false;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY: Required<RetryPolicy> = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  retryWrites: false,
};

/** Statuses worth retrying: transient by definition, never a client mistake. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ZuraAbortError());
      },
      { once: true },
    );
  });
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.append(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

/**
 * Combine the caller's signal with a timeout signal.
 * `AbortSignal.any` is used where available and hand-rolled where it is not,
 * so the client still works on older Safari.
 */
function combineSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export class ZuraLearningClient {
  private readonly baseUrl: string;
  private readonly getAccessToken?: TokenProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryPolicy> | false;
  private readonly defaultHeaders: Record<string, string>;
  private readonly requestIdFactory?: () => string;

  constructor(options: ZuraClientOptions) {
    if (!options.baseUrl || !/^https?:\/\//.test(options.baseUrl)) {
      throw new Error("baseUrl must be an absolute http(s) URL.");
    }
    this.baseUrl = options.baseUrl;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry =
      options.retry === false ? false : { ...DEFAULT_RETRY, ...(options.retry ?? {}) };
    this.defaultHeaders = { ...(options.defaultHeaders ?? {}) };
    this.requestIdFactory = options.requestIdFactory;
  }

  // --- meta -----------------------------------------------------------------

  /** Liveness. Public - no token required. */
  health(options: RequestOptions = {}): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health", { ...options, anonymous: true });
  }

  /**
   * Every algorithm version the deployment is running. Public.
   * Pin your generated types against `schema_version` and refuse to render a
   * manifest whose version you were not built for.
   */
  version(options: RequestOptions = {}): Promise<VersionResponse> {
    return this.request<VersionResponse>("GET", "/version", { ...options, anonymous: true });
  }

  // --- scores ---------------------------------------------------------------

  /** Dry run: warnings and blocking errors, nothing stored. */
  validateScore(
    body: ScoreValidateInput,
    options: RequestOptions = {},
  ): Promise<ValidationReport> {
    return this.request<ValidationReport>("POST", "/v1/scores/validate", options, body);
  }

  /** Owner only. Idempotent: an identical request reuses the stored version. */
  processScore(body: ScoreProcessInput, options: RequestOptions = {}): Promise<ProcessResponse> {
    return this.request<ProcessResponse>("POST", "/v1/scores/process", options, body);
  }

  /** Owner only. */
  reprocessScore(
    songId: string,
    body: ScoreReprocessInput = {},
    options: RequestOptions = {},
  ): Promise<ProcessResponse> {
    return this.request<ProcessResponse>(
      "POST",
      `/v1/scores/${encodeURIComponent(songId)}/reprocess`,
      options,
      body,
    );
  }

  /** Public for a published song; owner-only otherwise. */
  getManifest(
    songId: string,
    params: { manifestKey?: string } = {},
    options: RequestOptions = {},
  ): Promise<ScoreManifest> {
    return this.request<ScoreManifest>(
      "GET",
      `/v1/scores/${encodeURIComponent(songId)}/manifest${buildQuery({ manifest_key: params.manifestKey })}`,
      options,
    );
  }

  /** Public for a published song. Always the same Timeline shape, filtered or not. */
  getTimeline(
    songId: string,
    params: {
      manifestKey?: string;
      partId?: string;
      measureStart?: number;
      measureEnd?: number;
    } = {},
    options: RequestOptions = {},
  ): Promise<Timeline> {
    const query = buildQuery({
      manifest_key: params.manifestKey,
      part_id: params.partId,
      measure_start: params.measureStart,
      measure_end: params.measureEnd,
    });
    return this.request<Timeline>(
      "GET",
      `/v1/scores/${encodeURIComponent(songId)}/timeline${query}`,
      options,
    );
  }

  /** Public for a published song. */
  getParts(
    songId: string,
    params: { manifestKey?: string } = {},
    options: RequestOptions = {},
  ): Promise<PartsResponse> {
    return this.request<PartsResponse>(
      "GET",
      `/v1/scores/${encodeURIComponent(songId)}/parts${buildQuery({ manifest_key: params.manifestKey })}`,
      options,
    );
  }

  // --- practice -------------------------------------------------------------

  generateExercise(
    body: ExerciseGenerateInput,
    options: RequestOptions = {},
  ): Promise<Exercise> {
    return this.request<Exercise>("POST", "/v1/exercises/generate", options, body);
  }

  getExercise(exerciseId: string, options: RequestOptions = {}): Promise<Exercise> {
    return this.request<Exercise>(
      "GET",
      `/v1/exercises/${encodeURIComponent(exerciseId)}`,
      options,
    );
  }

  evaluateAttempt(
    body: AttemptEvaluateInput,
    options: RequestOptions = {},
  ): Promise<AttemptResult> {
    return this.request<AttemptResult>("POST", "/v1/attempts/evaluate", options, body);
  }

  recordProgress(
    body: ProgressRecordInput,
    options: RequestOptions = {},
  ): Promise<ProgressSummary> {
    return this.request<ProgressSummary>("POST", "/v1/progress", options, body);
  }

  getProgress(songId: string, options: RequestOptions = {}): Promise<ProgressSummary> {
    return this.request<ProgressSummary>(
      "GET",
      `/v1/progress/${encodeURIComponent(songId)}`,
      options,
    );
  }

  // --- fingering ------------------------------------------------------------

  /** Advisory. Explicit fingering you send is preserved and pinned. */
  pianoFingering(
    body: PianoFingeringInput,
    options: RequestOptions = {},
  ): Promise<PianoFingeringResponse> {
    return this.request<PianoFingeringResponse>("POST", "/v1/fingering/piano", options, body);
  }

  /** Ranked candidates, never a claim of uniqueness. */
  guitarCandidates(
    body: GuitarFingeringInput,
    options: RequestOptions = {},
  ): Promise<GuitarFingeringResponse> {
    return this.request<GuitarFingeringResponse>(
      "POST",
      "/v1/fingering/guitar/candidates",
      options,
      body,
    );
  }

  /** May legitimately answer `unsupported` or `unknown`. Check `support`. */
  accordionCandidates(
    body: AccordionFingeringInput,
    options: RequestOptions = {},
  ): Promise<AccordionCandidateResult> {
    return this.request<AccordionCandidateResult>(
      "POST",
      "/v1/fingering/accordion/candidates",
      options,
      body,
    );
  }

  // --- transport ------------------------------------------------------------

  private resolveRetry(method: string, options: RequestOptions): Required<RetryPolicy> | false {
    const policy = options.retry === undefined ? this.retry : options.retry;
    if (policy === false) return false;
    const resolved = { ...DEFAULT_RETRY, ...policy };
    if (method !== "GET" && !resolved.retryWrites) return false;
    return resolved;
  }

  private async buildHeaders(
    options: RequestOptions,
    hasBody: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.defaultHeaders };
    if (hasBody) headers["Content-Type"] = "application/json";
    if (this.requestIdFactory) headers["X-Request-ID"] = this.requestIdFactory();
    if (!options.anonymous && this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
    body?: unknown,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retry = this.resolveRetry(method, options);
    const maxAttempts = retry === false ? 1 : retry.maxRetries + 1;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.signal?.aborted) throw new ZuraAbortError();
      try {
        return await this.attempt<T>(method, path, options, body, timeoutMs);
      } catch (error) {
        lastError = error;
        const isLast = attempt === maxAttempts - 1;
        if (isLast || retry === false || !this.shouldRetry(error)) throw error;
        await sleep(this.backoffMs(error, attempt, retry), options.signal);
      }
    }
    throw lastError;
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof ZuraAbortError) return false;
    if (error instanceof ZuraNetworkError) return true;
    if (error instanceof ZuraApiError) return RETRYABLE_STATUSES.has(error.status);
    return false;
  }

  private backoffMs(error: unknown, attempt: number, retry: Required<RetryPolicy>): number {
    if (error instanceof ZuraApiError && error.retryAfterSeconds) {
      // The server told us when to come back; obey it rather than guessing.
      return Math.min(error.retryAfterSeconds * 1000, retry.maxDelayMs);
    }
    const exponential = retry.baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * retry.baseDelayMs;
    return Math.min(exponential + jitter, retry.maxDelayMs);
  }

  private async attempt<T>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const hasBody = body !== undefined;
    const headers = await this.buildHeaders(options, hasBody);
    const { signal, cleanup, didTimeout } = combineSignals(timeoutMs, options.signal);

    // The token lookup above is async, so the caller may have aborted while we
    // were waiting for it. Do not issue a request we already know is dead.
    if (signal.aborted) {
      cleanup();
      throw didTimeout() ? new ZuraTimeoutError(timeoutMs) : new ZuraAbortError();
    }

    let response: Response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal,
        // The API is stateless and token-authenticated; it does not accept
        // credentialed CORS, so cookies must never be attached.
        credentials: "omit",
        mode: "cors",
      });
    } catch (error) {
      if (didTimeout()) throw new ZuraTimeoutError(timeoutMs);
      if (options.signal?.aborted) throw new ZuraAbortError();
      throw new ZuraNetworkError("The Learning API could not be reached.", error);
    } finally {
      cleanup();
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new ZuraUnexpectedResponseError(response.status, text.slice(0, 512));
    }

    if (!response.ok) {
      if (isApiErrorBody(parsed)) throw new ZuraApiError(parsed, response.status);
      throw new ZuraUnexpectedResponseError(response.status, text.slice(0, 512));
    }
    return parsed as T;
  }
}

/** Convenience factory, so callers can avoid `new` in module scope. */
export function createZuraClient(options: ZuraClientOptions): ZuraLearningClient {
  return new ZuraLearningClient(options);
}
