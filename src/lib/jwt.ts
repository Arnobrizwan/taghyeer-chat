/**
 * JWT helpers.
 *
 * Lives in `lib` rather than in the session store because two unrelated callers need the
 * same rule: the session decides whether a stored token is worth restoring, and the socket
 * decides whether a handshake is worth attempting. Duplicating the check in both is how
 * they drift.
 *
 * Decoding here is *not* trust. The signature is never verified client-side — only the
 * server can do that — so this answers "is it already spent?", never "is it genuine?".
 * `/auth/me` on boot remains the real check.
 */

/**
 * True when the token is unusable: malformed, or past its `exp`.
 *
 * The API's tokens are valid for 7 days and carry `exp` (findings §8), so a spent token can
 * be caught locally instead of burning a round trip on a request that is going to fail. A
 * token with no `exp` is treated as live — absence of a deadline is not a missed one.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    if (typeof json.exp !== 'number') return false;
    return json.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

/** True when a token exists and has not expired — the bar for attempting any authed call. */
export function isTokenUsable(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.length > 0 && !isTokenExpired(token);
}
