// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

/**
 * Avatar identity: how a person becomes a colour and a pair of letters.
 *
 * Lives in `lib` rather than beside the component because none of it is React and all of
 * it is the kind of thing that breaks silently. The tint bug this file now guards against
 * shipped twice and was invisible in review both times — it only showed up as "those two
 * people are the same colour", which nobody reports as a bug.
 */

const TINT_COUNT = 12;

/**
 * FNV-1a with a MurmurHash3 finalizer.
 *
 * Two separate bugs got fixed here, and the second is the one that actually mattered.
 *
 * The original was the textbook `h * 31 + c` against a six-colour palette, and 31 ≡ 1
 * (mod 6). That makes `h * 31 ≡ h`, so the bucket degenerated into a plain sum of
 * character codes mod 6 and any two ids that were permutations of each other collided
 * outright. (The congruence is specific to 6 — 31 mod 12 is 7 — so widening the palette
 * alone would have hidden this rather than fixed it.)
 *
 * Swapping in FNV-1a was not enough on its own, which is worth spelling out because it
 * looks like it should be. Selecting a bucket with `% 12` reads the *low* bits, and low
 * bits are exactly where a multiplicative hash avalanches worst: they depend only on the
 * low bits of the input, so ids sharing a tail keep sharing a bucket. Measured on this
 * app's real data, four group members produced only two distinct tints. The finalizer
 * below is MurmurHash3's `fmix32`, whose entire job is to fold high-order entropy down into
 * the low bits; with it the same four ids produce four distinct tints.
 *
 * `>>> 0` keeps the result unsigned — `Math.abs` on an overflowed int32 would fold two
 * distinct hashes onto one value.
 */
export function hashCode(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}


/**
 * Which of the 12 tint classes this id maps to.
 *
 * The id must identify the *person*, not the conversation — see `conversationAvatarId`.
 */
export function avatarTint(id: string): string {
  return `tint-${(hashCode(id) % TINT_COUNT) + 1}`;
}

export { TINT_COUNT };
