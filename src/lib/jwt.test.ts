// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTokenExpired, isTokenUsable } from './jwt';

/*
 * These decide whether a stored session is worth restoring and whether a socket handshake
 * is worth attempting. Getting them wrong in either direction is bad: too strict signs
 * people out who are fine, too loose produces a shell for someone who is not signed in and
 * a reconnect loop behind it.
 */

/** Build a JWT with the given payload. Only the payload segment is ever read. */
function token(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature-not-checked`;
}

afterEach(() => vi.useRealTimers());

describe('isTokenExpired', () => {
  it('accepts a token whose exp is in the future', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(token({ sub: 'u1', exp }))).toBe(false);
  });

  it('rejects a token whose exp has passed', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    expect(isTokenExpired(token({ sub: 'u1', exp }))).toBe(true);
  });

  it('treats the exact expiry second as expired, not as still valid', () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    expect(isTokenExpired(token({ exp: now / 1000 }))).toBe(true);
  });

  it('treats a token with no exp as live — absence of a deadline is not a missed one', () => {
    expect(isTokenExpired(token({ sub: 'u1' }))).toBe(false);
  });

  it('treats anything unparseable as expired rather than trusting it', () => {
    // Failing closed matters here: a token we cannot read is one we cannot rely on.
    expect(isTokenExpired('')).toBe(true);
    expect(isTokenExpired('not-a-jwt')).toBe(true);
    expect(isTokenExpired('only.two')).toBe(true);
    expect(isTokenExpired('a.!!!not-base64!!!.c')).toBe(true);
  });

  it('handles base64url payloads containing - and _', () => {
    // Real JWTs are base64url, not base64; decoding without the substitution throws and
    // would have signed every affected user out.
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = token({ sub: 'u1', exp, note: 'a?b>c~d' });
    expect(t.split('.')[1]).toMatch(/[-_]/);
    expect(isTokenExpired(t)).toBe(false);
  });
});

describe('isTokenUsable', () => {
  it('requires a token that is present, non-empty and unspent', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenUsable(token({ exp }))).toBe(true);
    expect(isTokenUsable(null)).toBe(false);
    expect(isTokenUsable(undefined)).toBe(false);
    expect(isTokenUsable('')).toBe(false);
    expect(isTokenUsable(token({ exp: Math.floor(Date.now() / 1000) - 1 }))).toBe(false);
  });
});
