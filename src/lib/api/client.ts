import type { ZodType } from 'zod';
import { ApiError, toApiError } from './errors';
import { serverStatus } from './server-status';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://frontend-task-chatapp.onrender.com/api';

export const SOCKET_ORIGIN =
  process.env.NEXT_PUBLIC_SOCKET_ORIGIN ?? 'https://frontend-task-chatapp.onrender.com';

/** A request outstanding longer than this is treated as a cold start, and announced. */
const WAKE_THRESHOLD_MS = 3_500;
/** Per-attempt ceiling. Render cold starts are documented at up to ~60s. */
const ATTEMPT_TIMEOUT_MS = 75_000;
/** Attempts for idempotent reads. Writes are never retried automatically. */
const MAX_ATTEMPTS = 3;

type TokenProvider = () => string | null;

let getToken: TokenProvider = () => null;
export function setTokenProvider(fn: TokenProvider): void {
  getToken = fn;
}

let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: () => void): void {
  onAuthFailure = fn;
}

export type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Parsed with this before the caller sees it. A 2xx that fails is an error. */
  schema: ZodType<T>;
  /** Reads may be retried; writes must not be, to avoid duplicate sends. */
  retry?: boolean;
  signal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function attempt<T>(
  path: string,
  { method = 'GET', body, schema, signal }: RequestOptions<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);

  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  // If it hasn't answered by now, a container is almost certainly booting.
  const wakeTimer = setTimeout(() => serverStatus.set('waking'), WAKE_THRESHOLD_MS);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    // A caller-initiated abort is not a server problem; don't report the server as down.
    if (aborted && signal?.aborted) {
      throw new ApiError({ kind: 'network', message: 'Request cancelled' });
    }
    throw new ApiError({
      kind: aborted ? 'timeout' : 'network',
      message: aborted ? 'The request timed out' : 'Network request failed',
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(wakeTimer);
    signal?.removeEventListener('abort', abort);
  }

  const raw = await res.text();
  let json: unknown = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }

  if (!res.ok) throw toApiError(res.status, json);

  serverStatus.set('ready');

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    /*
     * A 2xx whose body doesn't match is a real failure, not a formality.
     *
     * `POST /messages` returns 200 with a literal `null` body when the conversation
     * doesn't exist (findings §1.5) — the socket path reports the same case as an error.
     * Without this check a message sent into a deleted conversation would be reported to
     * the user as delivered.
     */
    throw new ApiError({
      kind: 'bad_response',
      message: `Unexpected response shape from ${method} ${path}`,
      status: res.status,
    });
  }

  return parsed.data;
}

export async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const retries = options.retry === false ? 1 : MAX_ATTEMPTS;
  let lastError: ApiError | undefined;

  for (let i = 0; i < retries; i++) {
    try {
      const result = await attempt(path, options);
      return result;
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError({ kind: 'unknown', message: String(err) });

      if (apiErr.isAuthFailure) {
        onAuthFailure?.();
        throw apiErr;
      }
      // Only network/timeout/5xx are worth another attempt; a 400 will fail identically.
      if (!apiErr.isRetryable || i === retries - 1) {
        if (apiErr.isRetryable) serverStatus.set('unreachable');
        throw apiErr;
      }
      lastError = apiErr;
      await sleep(1_000 * 2 ** i);
    }
  }

  throw lastError ?? new ApiError({ kind: 'unknown', message: 'Request failed' });
}

/**
 * Root-origin health probe, used to warm the service before the first real call.
 *
 * `/health` is at the root, not under `/api` — the published spec's server URL makes the
 * documented path `/api/health`, which 404s (findings §8).
 */
export async function ping(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${SOCKET_ORIGIN}/health`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}
