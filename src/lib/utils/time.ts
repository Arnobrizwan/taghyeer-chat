const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function formatTime(ts: number): string {
  return time.format(ts);
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
