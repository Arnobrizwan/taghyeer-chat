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

/**
 * Group a stored phone number for reading.
 *
 * The API stores whatever string it was registered with, so what comes back is an
 * undelimited run of digits — `8801711002200` in the thread header, the member list and
 * every search result.
 *
 * Grouped in threes from the *left*, not the right. Right-grouping is the reflex, and it
 * orphans the leading digit on any length that is not a multiple of three: 13 digits came
 * out as `8 801 711 002 200`, which is worse than leaving it alone. From the left the first
 * group lands on the country code for the 3-digit codes this app actually sees, and a tail
 * of one digit is merged back so no group is ever stranded.
 *
 * A leading `+` is preserved, never invented. Numbers here are stored exactly as they were
 * registered, and plenty are local rather than E.164 — printing `+015 215 747 41` for a
 * number stored as `01521574741` would assert a country code that is not there.
 *
 * This is presentational grouping, not parsing. Getting it properly right per country means
 * libphonenumber and a region hint, which is a 150kB dependency and a user setting this
 * take-home does not have — so it aims to be readable and never wrong-looking rather than
 * canonical. Anything that is not an optional `+` and 7-15 digits is returned untouched,
 * because a number we cannot read is better shown as stored than mangled.
 */
export function formatPhone(raw: string): string {
  const v = raw.trim();
  const m = /^(\+?)(\d{7,15})$/.exec(v);
  if (!m?.[2]) return v;
  const [, plus, digits] = m;
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3));
  const last = groups.at(-1);
  if (groups.length > 1 && last !== undefined && last.length < 2) {
    groups.pop();
    groups[groups.length - 1] = `${groups.at(-1) ?? ''}${last}`;
  }
  return `${plus}${groups.join(' ')}`;
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
