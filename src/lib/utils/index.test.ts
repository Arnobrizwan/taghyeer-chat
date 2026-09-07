// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { describe, expect, it } from 'vitest';
import {
  cx,
  escapeRegex,
  formatPhone,
  isObjectId,
  isSendableText,
  MAX_MESSAGE_LENGTH,
  normalisePhone,
  validateName,
  validatePhone,
} from './index';

describe('escapeRegex', () => {
  /*
   * This is not cosmetic. `/users/search` interpolates `q` into a MongoDB regex without
   * escaping it, so an unescaped `+` — i.e. any E.164 number, the format the API's own
   * spec uses as its example — returns a 500 (findings §2.1).
   */
  it('escapes the metacharacter that crashes the search endpoint', () => {
    expect(escapeRegex('+8801700000000')).toBe('\\+8801700000000');
  });

  it('escapes every metacharacter that could reach the server', () => {
    expect(escapeRegex('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('leaves ordinary names untouched, so name search is unaffected', () => {
    expect(escapeRegex('Grace Hopper')).toBe('Grace Hopper');
  });
});

describe('isObjectId', () => {
  // A malformed id in a URL produces a 500 with a leaked driver message (findings §3.2),
  // so nothing may reach the wire without passing this.
  it('accepts a 24-character hex id in either case', () => {
    expect(isObjectId('6a9e904adb386e2dcaba4306')).toBe(true);
    expect(isObjectId('6A9E904ADB386E2DCABA4306')).toBe(true);
  });

  it('rejects wrong lengths, non-hex, and our own temporary ids', () => {
    expect(isObjectId('6a9e904adb386e2dcaba430')).toBe(false);
    expect(isObjectId('6a9e904adb386e2dcaba43066')).toBe(false);
    expect(isObjectId('zzze904adb386e2dcaba4306')).toBe(false);
    expect(isObjectId('tmp_abc123_x9f2')).toBe(false);
    expect(isObjectId('')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('groups from the left so the leading digit is never orphaned', () => {
    // Right-grouping is the reflex and it produced "8 801 711 002 200" for 13 digits,
    // which is worse than showing the raw number.
    expect(formatPhone('8801711002200')).toBe('880 171 100 2200');
  });

  it('preserves a leading + when it is stored', () => {
    expect(formatPhone('+8801711002200')).toBe('+880 171 100 2200');
  });

  it('never invents a + that was not stored', () => {
    // Numbers here are stored exactly as registered and plenty are local, not E.164.
    // Printing "+015 215 747 41" would assert a country code that is not there.
    expect(formatPhone('01521574741')).toBe('015 215 747 41');
    expect(formatPhone('01521574741').startsWith('+')).toBe(false);
  });

  it('never leaves a single-digit group stranded at the end', () => {
    for (let len = 7; len <= 15; len += 1) {
      const out = formatPhone('9'.repeat(len));
      for (const group of out.split(' ')) expect(group.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns anything it cannot read untouched rather than mangling it', () => {
    expect(formatPhone('88017039759802344')).toBe('88017039759802344'); // 17 digits
    expect(formatPhone('not a phone')).toBe('not a phone');
    expect(formatPhone('')).toBe('');
    expect(formatPhone('+880 171 100 2200')).toBe('+880 171 100 2200'); // already spaced
  });

  it('only ever adds separators, never changes the digits', () => {
    const digitsOf = (s: string) => s.replace(/\D/g, '');
    for (const n of ['8801711002200', '+15551234567', '01521574741']) {
      expect(digitsOf(formatPhone(n))).toBe(digitsOf(n));
    }
  });
});

describe('normalisePhone', () => {
  it('strips the separators a human types but keeps the country code', () => {
    expect(normalisePhone('+880 (171) 100-2200')).toBe('+8801711002200');
  });
});

describe('validatePhone', () => {
  it('accepts international and local forms', () => {
    expect(validatePhone('+8801700000000')).toBeNull();
    expect(validatePhone('8801700000000')).toBeNull();
    expect(validatePhone('+880 171 100 2200')).toBeNull(); // separators are normalised first
  });

  it('rejects empty, too short, too long, and non-numeric', () => {
    expect(validatePhone('')).toBe('Phone number is required');
    expect(validatePhone('   ')).toBe('Phone number is required');
    expect(validatePhone('12345')).not.toBeNull();
    expect(validatePhone('1'.repeat(16))).not.toBeNull();
    expect(validatePhone('not-a-number')).not.toBeNull();
  });
});

describe('validateName', () => {
  it('accepts an ordinary name', () => {
    expect(validateName('Ada Lovelace')).toBeNull();
  });

  it('rejects empty, whitespace-only, one character, and over-long', () => {
    expect(validateName('')).toBe('Name is required');
    expect(validateName('   ')).toBe('Name is required');
    expect(validateName('A')).not.toBeNull();
    expect(validateName('a'.repeat(61))).not.toBeNull();
  });
});

describe('isSendableText', () => {
  /*
   * The server accepts empty and whitespace-only text and broadcasts it (findings §5.1),
   * so this rule exists only on the client. It backs both the disabled state and the
   * submit guard, which is why it has to be one function and not two conditions.
   */
  it('refuses what the server would wrongly accept', () => {
    expect(isSendableText('')).toBe(false);
    expect(isSendableText('   ')).toBe(false);
    expect(isSendableText('\n\t ')).toBe(false);
  });

  it('accepts real text and trims before measuring', () => {
    expect(isSendableText('hello')).toBe(true);
    expect(isSendableText('  hi  ')).toBe(true);
  });

  it('enforces the length cap on the trimmed value', () => {
    expect(isSendableText('a'.repeat(MAX_MESSAGE_LENGTH))).toBe(true);
    expect(isSendableText('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false);
    expect(isSendableText(`  ${'a'.repeat(MAX_MESSAGE_LENGTH)}  `)).toBe(true);
  });
});

describe('cx', () => {
  it('drops falsy branches so conditional classes stay readable at call sites', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});
