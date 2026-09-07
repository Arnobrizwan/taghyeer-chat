// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

/*
 * One clock format for the whole product, pinned rather than inherited.
 *
 * `undefined` locale meant the seeded landing-page thread rendered 24-hour ("09:12") while
 * a message you sent yourself rendered 12-hour ("3:25 PM") on the same screen, because the
 * seeds are literals and only the live ones went through Intl. An explicit locale plus
 * `hourCycle` removes the split: every timestamp in the app and the demo is now zero-padded
 * 24-hour, which is also the format that stays the same width as it ticks over.
 */
export const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function formatTime(ts: number): string {
  return TIME_FORMAT.format(ts);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayKey(ts: number): number {
  return startOfDay(new Date(ts));
}

/** "Today" / "Yesterday" / "Tuesday" / "3 March 2026" — for message-list day separators. */
export function formatDaySeparator(ts: number): string {
  const today = startOfDay(new Date());
  const day = dayKey(ts);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return weekday.format(ts);
  return fullDate.format(ts);
}

/** Compact stamp for conversation-list rows. */
export function formatListTimestamp(ts: number): string {
  const today = startOfDay(new Date());
  const day = dayKey(ts);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return formatTime(ts);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return weekday.format(ts);
  return shortDate.format(ts);
}

export function isoLabel(ts: number): string {
  return new Date(ts).toISOString();
}
