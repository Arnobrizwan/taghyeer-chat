// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayKey, formatDaySeparator, formatListTimestamp, formatTime } from './time';

afterEach(() => vi.useRealTimers());

const at = (iso: string) => Date.parse(iso);

describe('formatTime', () => {
  /*
   * Pinned to en-GB / h23 on purpose. Left to the runtime locale, the landing page's
   * literal seed timestamps rendered 24-hour while live ones rendered 12-hour on the same
   * screen. These assertions are exact strings precisely so that regressing the locale
   * fails here instead of in a screenshot.
   */
  it('is 24-hour and zero-padded', () => {
    expect(formatTime(at('2026-09-07T09:05:00Z'))).toMatch(/^\d{2}:\d{2}$/);
  });

  it('never emits AM or PM', () => {
    for (const h of [0, 1, 9, 12, 13, 23]) {
      const s = formatTime(at(`2026-09-07T${String(h).padStart(2, '0')}:30:00Z`));
      expect(s).not.toMatch(/[AaPp][Mm]/);
    }
  });

  it('renders midnight as 00:xx rather than 24:xx or 12:xx', () => {
    // h23 vs h24 vs h12 differ exactly here, which is why the option is spelled out.
    const s = formatTime(at('2026-09-07T00:30:00Z'));
    expect(s.startsWith('24')).toBe(false);
    expect(s.startsWith('12')).toBe(false);
  });

  it('is fixed width, so a column of timestamps does not jitter', () => {
    const widths = new Set(
      ['2026-09-07T09:05:00Z', '2026-09-07T19:45:00Z', '2026-09-07T00:00:00Z']
        .map((d) => formatTime(at(d)).length),
    );
    expect(widths.size).toBe(1);
  });
});

describe('dayKey', () => {
  it('collapses every instant in a local day onto one key', () => {
    const morning = new Date(2026, 8, 7, 0, 0, 1).getTime();
    const night = new Date(2026, 8, 7, 23, 59, 59).getTime();
    expect(dayKey(morning)).toBe(dayKey(night));
  });

  it('separates adjacent days', () => {
    expect(dayKey(new Date(2026, 8, 7, 12).getTime()))
      .not.toBe(dayKey(new Date(2026, 8, 8, 12).getTime()));
  });
});

describe('formatDaySeparator', () => {
  it('says Today and Yesterday rather than a date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 12, 0, 0));
    expect(formatDaySeparator(new Date(2026, 8, 7, 9).getTime())).toBe('Today');
    expect(formatDaySeparator(new Date(2026, 8, 6, 9).getTime())).toBe('Yesterday');
  });

  it('uses a weekday inside the last week and a full date beyond it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 12, 0, 0));
    expect(formatDaySeparator(new Date(2026, 8, 3, 9).getTime())).toMatch(/day$/);
    expect(formatDaySeparator(new Date(2026, 0, 3, 9).getTime())).toMatch(/2026/);
  });
});

describe('formatListTimestamp', () => {
  it('shows a clock time only for today, and a label beyond it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 12, 0, 0));
    expect(formatListTimestamp(new Date(2026, 8, 7, 9, 5).getTime())).toMatch(/^\d{2}:\d{2}$/);
    expect(formatListTimestamp(new Date(2026, 8, 6, 9).getTime())).toBe('Yesterday');
    expect(formatListTimestamp(new Date(2026, 0, 3).getTime())).not.toMatch(/^\d{2}:\d{2}$/);
  });
});
