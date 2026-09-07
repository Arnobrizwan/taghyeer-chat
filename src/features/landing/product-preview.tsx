import { Avatar } from '@/components/ui';
import { cx } from '@/lib/utils';

/**
 * A still of the actual app: sidebar, open group thread, queued message, and the
 * "new messages" pill.
 *
 * Built in markup rather than pasted in as a screenshot on purpose. A PNG would be fixed
 * to one theme on a page whose whole palette inverts, would go stale the moment the app
 * moved, and would ship a few hundred kilobytes to say what a few hundred bytes of reused
 * classes can. This uses the same tokens, radii and bubble geometry as the real thread, so
 * it stays honest by construction — if the product's look changes, this changes with it.
 *
 * Purely decorative and inert: no controls, no state, and `aria-hidden`, because the
 * surrounding prose already says everything it shows.
 */
export function ProductPreview() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-xl shadow-ink/10 select-none"
    >
      <div className="flex h-[340px] sm:h-[380px]">
        {/*
          The sidebar is the first thing to go on a narrow screen — which is exactly what
          the real app does at the same breakpoint, where `/app` is the list and
          `/app/c/:id` is the thread rather than a squeezed two-pane.
        */}
        <aside className="hidden w-[38%] max-w-[260px] shrink-0 flex-col border-r border-line bg-paper sm:flex">
          <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
            <Avatar name="Nadia Rahman" id="self-preview" size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold text-ink">Nadia Rahman</span>
              <span className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                <span className="size-1.5 rounded-full bg-teal" />
                Connected
              </span>
            </span>
          </header>

          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="font-display text-base text-ink">Chats</span>
            <span className="rounded-md bg-vermilion px-2 py-1 text-[10px] font-semibold text-white">
              + New
            </span>
          </div>

          <ul className="flex flex-col gap-0.5 px-2">
            <PreviewRow
              name="Release Crew Q4"
              preview="Imran: Sent from the deployed build"
              time="13:01"
              isGroup
              active
              unread={3}
            />
            <PreviewRow name="Imran Hossain" preview="You: On the train now" time="12:32" />
            <PreviewRow name="Sam Mercer" preview="Try me when you hit the tunnel" time="09:13" />
          </ul>
        </aside>

        {/* Thread */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-paper">
          <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
            <Avatar name="Release Crew Q4" id="group-preview" size="sm" isGroup />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold text-ink">Release Crew Q4</span>
              <span className="text-[10px] text-ink-faint">4 members · you are admin</span>
            </span>
          </header>

          <div className="flex flex-1 flex-col justify-end gap-[3px] overflow-hidden px-3.5 py-3">
            <p className="mb-1 self-center rounded-full border border-line bg-paper px-2.5 py-0.5 text-[9px] font-semibold tracking-wide text-ink-muted uppercase">
              Today
            </p>

            <PreviewBubble sender="Imran">Deploy is green, tests all passed</PreviewBubble>
            <PreviewBubble sender="Priya">Nice. Shipping the changelog now</PreviewBubble>
            <PreviewBubble own time="12:58">
              On the train — will review from the tunnel
            </PreviewBubble>
            {/*
              The one bubble that carries the pitch: queued, not delivered, and visibly so.
            */}
            <PreviewBubble own queued time="13:01">
              Merging as soon as I get signal
            </PreviewBubble>
          </div>

          {/* The pill: the thing that never yanks you to the bottom. */}
          <span className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[10px] font-semibold text-paper shadow-lg">
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path d="M8 3v10M4 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            3 new messages
          </span>

          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-paper-raised px-3 py-2.5">
            <span className="flex-1 rounded-xl border border-line-strong bg-paper px-3 py-2 text-[11px] text-ink-faint">
              Type a message…
            </span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-vermilion text-white">
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({
  name,
  preview,
  time,
  isGroup = false,
  active = false,
  unread = 0,
}: {
  name: string;
  preview: string;
  time: string;
  isGroup?: boolean;
  active?: boolean;
  unread?: number;
}) {
  return (
    <li
      className={cx(
        'flex items-center gap-2.5 rounded-lg px-2 py-2',
        active && 'bg-vermilion-soft',
      )}
    >
      <Avatar name={name} id={name} size="sm" isGroup={isGroup} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-semibold text-ink">{name}</span>
        <span className="truncate text-[10px] text-ink-muted">{preview}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[9px] tabular-nums text-ink-faint">{time}</span>
        {unread > 0 && (
          <span className="flex size-3.5 items-center justify-center rounded-full bg-vermilion text-[8px] font-bold text-white">
            {unread}
          </span>
        )}
      </span>
    </li>
  );
}

function PreviewBubble({
  children,
  sender,
  own = false,
  queued = false,
  time,
}: {
  children: React.ReactNode;
  sender?: string;
  own?: boolean;
  queued?: boolean;
  time?: string;
}) {
  return (
    <div className={cx('flex flex-col', own ? 'items-end' : 'items-start')}>
      {sender && (
        <span className="mb-0.5 px-1 text-[9px] font-semibold text-ink-muted">{sender}</span>
      )}
      <span
        className={cx(
          'max-w-[80%] px-2.5 py-1.5 text-[11px] leading-[1.45]',
          own ? 'bubble-out' : 'bubble-in',
          queued
            ? 'border border-dashed border-amber/60 bg-amber-soft text-ink'
            : own
              ? 'bg-vermilion text-white'
              : 'border border-line bg-paper-raised text-ink',
        )}
      >
        {children}
        {time && (
          <span
            className={cx(
              'ml-2 inline-flex items-center gap-1 align-bottom text-[9px] tabular-nums',
              queued ? 'text-amber' : 'text-white/90',
            )}
          >
            {time}
            {queued ? (
              <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" />
                <path d="M8 4.8V8l2.2 1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        )}
      </span>
      {queued && (
        <span className="mt-0.5 px-1 text-[9px] font-medium text-amber">
          Waiting for connection
        </span>
      )}
    </div>
  );
}
