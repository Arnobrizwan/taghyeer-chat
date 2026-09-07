// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Escape regex metacharacters before they reach `/users/search`.
 *
 * `q` is interpolated into a MongoDB regex without escaping, so a leading `+` — i.e. any
 * E.164 phone number, the format the API's own spec uses as its example — returns a 500
 * (findings §2.1). Escaping client-side is the only way to make phone search work at all.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ObjectId guard. A malformed id sent to the API produces a 500, so we never send one. */
export function isObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

const PHONE_RE = /^\+?[0-9]{7,15}$/;

export function normalisePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, '');
}

export function validatePhone(raw: string): string | null {
  const v = normalisePhone(raw.trim());
  if (!v) return 'Phone number is required';
  if (!PHONE_RE.test(v)) return 'Enter a valid phone number, e.g. +8801700000000';
  return null;
}

export function validateName(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Name is required';
  if (v.length < 2) return 'Name must be at least 2 characters';
  if (v.length > 60) return 'Name must be 60 characters or fewer';
  return null;
}

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * The single source of truth for "can this be sent".
 *
 * The server accepts empty and whitespace-only text and broadcasts it (findings §5.1), so
 * this rule exists only on the client. It backs both the disabled state and the submit
 * guard so the two can never disagree.
 */
export function isSendableText(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && t.length <= MAX_MESSAGE_LENGTH;
}
