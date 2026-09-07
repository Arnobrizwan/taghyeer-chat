// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

/**
 * Client-side flood and duplicate protection for sending.
 *
 * Recon established that the API applies **no rate limiting whatsoever** — 30 concurrent
 * requests all returned 200 (findings §8) — and `POST /messages` accepts empty text, has
 * no length cap and is not idempotent. On a shared demo backend that means one person
 * holding Enter can fill everybody's history, and there is nothing server-side to stop it.
 *
 * Two independent guards, because they catch different mistakes:
 *
 *  - a **token bucket** for sustained flooding: a short burst is fine, a held key is not;
 *  - a **duplicate window** for the accidental double-send — a double click, or Enter
 *    pressed twice while the ~1s round trip is still in flight.
 *
 * Deliberately advisory rather than silent: a rejected send tells the user why and when
 * they can try again. Dropping their text quietly would be worse than the spam.
 */

/** Messages that may be sent back-to-back before throttling begins. */
const BURST_CAPACITY = 5;
/** One token is restored this often, so the sustained rate is ~40 messages/minute. */
const REFILL_INTERVAL_MS = 1_500;
/** Identical text to the same conversation inside this window is treated as a mis-send. */
const DUPLICATE_WINDOW_MS = 4_000;

export type SendVerdict =
  | { ok: true }
  | { ok: false; reason: 'flood'; retryInMs: number }
  | { ok: false; reason: 'duplicate'; retryInMs: number };

type GuardState = {
  tokens: number;
  lastRefillAt: number;
  recent: Map<string, number>;
};

function createState(): GuardState {
  return { tokens: BURST_CAPACITY, lastRefillAt: Date.now(), recent: new Map() };
}

const state: GuardState = createState();

function refill(now: number): void {
  const elapsed = now - state.lastRefillAt;
  if (elapsed < REFILL_INTERVAL_MS) return;
  const earned = Math.floor(elapsed / REFILL_INTERVAL_MS);
  state.tokens = Math.min(BURST_CAPACITY, state.tokens + earned);
  state.lastRefillAt += earned * REFILL_INTERVAL_MS;
}

/** Drop duplicate-window entries that can no longer match, so the map can't grow forever. */
function prune(now: number): void {
  for (const [key, at] of state.recent) {
    if (now - at > DUPLICATE_WINDOW_MS) state.recent.delete(key);
  }
}

/**
 * Decide whether this send may proceed. Consumes a token only when it returns `ok`, so a
 * rejected attempt never makes the next one harder.
 */
export function checkSend(conversationId: string, text: string, now = Date.now()): SendVerdict {
  refill(now);
  prune(now);

  const key = `${conversationId}::${text.trim()}`;
  const lastSentAt = state.recent.get(key);
  if (lastSentAt !== undefined && now - lastSentAt < DUPLICATE_WINDOW_MS) {
    return { ok: false, reason: 'duplicate', retryInMs: DUPLICATE_WINDOW_MS - (now - lastSentAt) };
  }

  if (state.tokens < 1) {
    return {
      ok: false,
      reason: 'flood',
      retryInMs: Math.max(0, state.lastRefillAt + REFILL_INTERVAL_MS - now),
    };
  }

  state.tokens -= 1;
  state.recent.set(key, now);
  return { ok: true };
}

/** Test seam — the guard is module state, so suites need a way back to a known start. */
export function resetSendGuard(): void {
  const fresh = createState();
  state.tokens = fresh.tokens;
  state.lastRefillAt = fresh.lastRefillAt;
  state.recent.clear();
}

export const SEND_GUARD = { BURST_CAPACITY, REFILL_INTERVAL_MS, DUPLICATE_WINDOW_MS } as const;
