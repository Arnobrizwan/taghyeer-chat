import { errorEnvelopeSchema } from '../schemas';

export type FieldError = { path: string; message: string };

export type ApiErrorKind =
  | 'network'      // never reached the server
  | 'timeout'      // gave up waiting
  | 'auth'         // session invalid or absent
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'bad_response' // 2xx whose body did not match the schema
  | 'server'
  | 'unknown';

/**
 * One error type for the whole app.
 *
 * The API surfaces three different error shapes — the REST envelope, the same envelope
 * with a *numeric* code from MongoDB, and a plain string in socket acks (findings §3.3) —
 * plus a handful of miscategorised status codes. Everything is normalised into this class
 * so UI code branches on `kind`, never on a status code or a message string.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly fieldErrors: FieldError[];

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    code?: string | null;
    fieldErrors?: FieldError[];
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.fieldErrors = init.fieldErrors ?? [];
  }

  /**
   * Whether this should end the session.
   *
   * A *missing* token returns 400 NO_TOKEN while an *invalid* one returns 401
   * (findings §3.1), so checking the status alone misses half of all auth failures.
   */
  get isAuthFailure(): boolean {
    return this.kind === 'auth';
  }

  /** Whether retrying unchanged could plausibly succeed. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }

  /** Copy safe to show a user. Never leaks a driver message or a model name. */
  get userMessage(): string {
    switch (this.kind) {
      case 'network':
        return "Can't reach the server. Check your connection.";
      case 'timeout':
        return 'The server took too long to respond.';
      case 'auth':
        return 'Your session has expired. Please sign in again.';
      case 'forbidden':
        return "You don't have access to this conversation.";
      case 'not_found':
        return "That conversation doesn't exist any more.";
      case 'validation':
        return this.fieldErrors[0]?.message ?? this.message;
      case 'bad_response':
        return 'The server sent an unexpected response.';
      case 'server':
        return 'Something went wrong on the server. Please try again.';
      default:
        return this.message || 'Something went wrong.';
    }
  }
}

const CAST_ERROR = /Cast to ObjectId failed/i;

/** Map an error response body onto an ApiError. */
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(body);

  if (!parsed.success) {
    return new ApiError({
      kind: status >= 500 ? 'server' : 'unknown',
      message: `Request failed with status ${status}`,
      status,
    });
  }

  const { message, code, details } = parsed.data.error;
  const codeStr = code === undefined ? null : String(code);
  const fieldErrors: FieldError[] = (details ?? []).map((d) => ({
    path: d.path ?? '',
    message: d.message,
  }));

  // A malformed ObjectId is a *client* error the API reports as a 500 while leaking the
  // internal model name (findings §3.2). Present it as "not found" and drop the detail.
  if (CAST_ERROR.test(message)) {
    return new ApiError({ kind: 'not_found', message: 'Not found', status, code: codeStr });
  }

  // 400 NO_TOKEN is an authentication failure wearing a validation status code.
  if (status === 401 || codeStr === 'NO_TOKEN' || codeStr === 'INVALID_TOKEN') {
    return new ApiError({ kind: 'auth', message, status, code: codeStr });
  }

  const kind: ApiErrorKind =
    status === 403 ? 'forbidden'
    : status === 404 ? 'not_found'
    : status === 400 ? 'validation'
    : status >= 500 ? 'server'
    : 'unknown';

  return new ApiError({ kind, message, status, code: codeStr, fieldErrors });
}
