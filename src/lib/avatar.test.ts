// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { describe, expect, it } from 'vitest';
import { avatarTint, hashCode, initials, TINT_COUNT } from './avatar';

/*
 * These exist because the tint hash shipped broken twice and both times review missed it.
 * It is not the kind of bug that throws — it renders two people in the same colour, which
 * nobody files a ticket for. The ids below are the real ObjectIds from the seeded demo
 * group, kept verbatim: they are the exact input that defeated the second attempt.
 */
const REAL_GROUP_IDS = [
  '6a9e838cdb386e2dcaba3ac6', // Nadia Rahman
  '6a9e904adb386e2dcaba4306', // Sam Mercer
  '6a9e904bdb386e2dcaba4309', // Grace Hopper
  '6a9e904bdb386e2dcaba430c', // Omar Faruk
];

describe('hashCode', () => {
  it('is deterministic', () => {
    expect(hashCode('abc')).toBe(hashCode('abc'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', REAL_GROUP_IDS[0]!, 'x'.repeat(500)]) {
      const h = hashCode(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is order-sensitive, so permutations of an id do not collide', () => {
    /*
     * The original `h * 31 + c` collapsed to a character-code sum modulo the old
     * six-colour palette, because 31 ≡ 1 (mod 6) — so anagrams landed in the same bucket.
     * Asserting on the bucket, not just the raw hash, is the part that matters: the raw
     * values differed even in the broken version.
     */
    expect(hashCode('ab') % 6).not.toBe(hashCode('ba') % 6);
    expect(avatarTint('listen')).not.toBe(avatarTint('silent'));
  });

  it('avalanches in the low bits, which is what bucket selection reads', () => {
    // Plain FNV-1a passes the anagram test above and still fails here: `% 12` only sees
    // the low bits, and those depended solely on the low bits of the input. Ids that share
    // a tail kept sharing a bucket.
    const near = ['id-0000', 'id-0001', 'id-0002', 'id-0003'];
    const buckets = new Set(near.map((s) => hashCode(s) % TINT_COUNT));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('avatarTint', () => {
  it('gives every member of the real seeded group a different tint', () => {
    // The regression test proper. Before the finalizer these four produced two tints.
    const tints = REAL_GROUP_IDS.map(avatarTint);
    expect(new Set(tints).size).toBe(REAL_GROUP_IDS.length);
  });

  it('always returns a class that exists in the stylesheet', () => {
    for (const id of REAL_GROUP_IDS) {
      expect(avatarTint(id)).toMatch(/^tint-([1-9]|1[0-2])$/);
    }
  });

  it('is stable for the same id, which is the whole contract', () => {
    // A person must look the same in the sidebar, the thread header and the member list.
    expect(avatarTint(REAL_GROUP_IDS[1]!)).toBe(avatarTint(REAL_GROUP_IDS[1]!));
  });

  it('spreads sequential ObjectIds across most of the palette', () => {
    // ObjectIds minted seconds apart differ only in a trailing counter, so this is the
    // realistic worst case for a chat app: a group created in one sitting.
    const base = '6a9e904ddb386e2dcaba43';
    const ids = Array.from({ length: 24 }, (_, i) =>
      base + (0x10 + i).toString(16).padStart(2, '0'),
    );
    const used = new Set(ids.map(avatarTint));
    expect(used.size).toBeGreaterThanOrEqual(8);
  });

  it('keeps collisions near the theoretical rate over many ids', () => {
    const ids = Array.from({ length: 6000 }, (_, i) => `6a9e904ddb386e2dcaba${i.toString(16).padStart(4, '0')}`);
    const counts = new Map<string, number>();
    for (const id of ids) {
      const t = avatarTint(id);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    expect(counts.size).toBe(TINT_COUNT);
    // No bucket should take more than double its fair share.
    const fair = ids.length / TINT_COUNT;
    for (const n of counts.values()) expect(n).toBeLessThan(fair * 2);
  });
});

describe('initials', () => {
  it('takes first and last initial for a full name', () => {
    expect(initials('Grace Hopper')).toBe('GH');
    expect(initials('Nadia Rahman')).toBe('NR');
  });

  it('uses the first two letters of a single name', () => {
    expect(initials('Sabbir')).toBe('SA');
  });

  it('skips middle names rather than running out of room', () => {
    expect(initials('Ada Byron King Lovelace')).toBe('AL');
  });

  it('collapses irregular whitespace', () => {
    expect(initials('  Grace   Hopper  ')).toBe('GH');
  });

  it('degrades to a placeholder rather than throwing on empty input', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});
