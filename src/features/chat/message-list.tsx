'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Conversation, Message } from '@/lib/domain';
import { senderName } from '@/lib/domain';
import { Avatar, Skeleton, Spinner } from '@/components/ui';
import { cx } from '@/lib/utils';
import { dayKey, formatDaySeparator, formatTime } from '@/lib/utils/time';

/** Distance from the bottom still counted as "pinned to newest". */
const AT_BOTTOM_PX = 80;
/** Distance from the top that triggers loading the previous page. */
const LOAD_OLDER_PX = 220;

type Row =
  | { kind: 'day'; key: string; ts: number }
  | { kind: 'message'; key: string; message: Message; showSender: boolean; tail: boolean };

/**
 * Groups messages into render rows: day separators, plus per-message flags for whether to
 * show the sender's name/avatar (first of a run in a group chat) and whether the bubble
 * gets a tail (last of a run).
 */
function buildRows(messages: Message[], isGroupChat: boolean): Row[] {
  const rows: Row[] = [];
  let lastDay: number | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `day-${day}`, ts: m.createdAt });
      lastDay = day;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const startsRun = !prev || prev.senderId !== m.senderId || dayKey(prev.createdAt) !== day;
    const endsRun = !next || next.senderId !== m.senderId || dayKey(next.createdAt) !== day;

    rows.push({
      kind: 'message',
      key: m.id,
      message: m,
      showSender: isGroupChat && startsRun,
      tail: endsRun,
    });
  }
  return rows;
}

export function MessageList({
  messages,
  conversation,
  selfId,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onRetry,
  initialLoading,
}: {
  messages: Message[];
  conversation: Conversation | undefined;
  selfId: string;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (tempId: string) => void;
  initialLoading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [unread, setUnread] = useState(0);

  const prevCount = useRef(0);
  const prevLastId = useRef<string | null>(null);
  // Height before a "load older" render, used to keep the viewport visually still.
  const restoreHeight = useRef<number | null>(null);
  /*
   * "Is the user pinned to the newest message" is a ref, not state: nothing renders from
   * it, it changes on every scroll frame, and the layout effect needs the current value
   * without re-running. Making it state would re-render the whole list on every scroll.
   */
  const pinnedRef = useRef(true);

  const isGroupChat = conversation?.type === 'group';
  const rows = buildRows(messages, isGroupChat);

  /*
   * Jump to the newest message, without animation, always.
   *
   * Animated scrolling was tried twice here and abandoned both times: a smooth
   * `scrollIntoView` was cancelled by the re-render that clears the unread badge, and a
   * smooth `scrollTop` assignment silently stopped part-way, leaving the pill dismissed
   * but the user still stranded in the history. Landing reliably matters far more than
   * animating on the way — this is the one scroll behaviour the brief names explicitly —
   * so the position is assigned outright with `scroll-behavior` pinned to `auto` for the
   * assignment. It is also exactly what a reduced-motion user should get.
   */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const previous = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    el.style.scrollBehavior = previous;
  }, []);

  const scrollToBottom = useCallback(() => {
    setUnread(0);
    pinnedRef.current = true;
    jumpToBottom();
  }, [jumpToBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= AT_BOTTOM_PX;
    pinnedRef.current = atBottom;
    if (atBottom) setUnread(0);

    if (el.scrollTop <= LOAD_OLDER_PX && hasMore && !loadingOlder) {
      restoreHeight.current = el.scrollHeight;
      onLoadOlder();
    }
  }, [hasMore, loadingOlder, onLoadOlder]);

  /*
   * Scroll reconciliation, run before paint so nothing visibly jumps.
   *
   * Three distinct cases, and conflating them is what produces the usual bugs:
   *   1. Older page prepended  → hold the viewport still by restoring the height delta.
   *   2. New message, pinned   → follow it down.
   *   3. New message, scrolled → do NOT move; count it for the pill instead.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const count = messages.length;
    const lastId = messages.at(-1)?.id ?? null;
    const grew = count > prevCount.current;
    const appended = lastId !== prevLastId.current;

    if (restoreHeight.current !== null) {
      const delta = el.scrollHeight - restoreHeight.current;
      restoreHeight.current = null;
      if (delta > 0) el.scrollTop += delta;
      prevCount.current = count;
      prevLastId.current = lastId;
      return;
    }

    if (prevCount.current === 0 && count > 0) {
      // First render of a thread: land on the newest message without animating.
      jumpToBottom();
    } else if (grew && appended) {
      if (pinnedRef.current) {
        jumpToBottom();
      } else {
        const added = count - prevCount.current;
        const own = messages.at(-1)?.senderId === selfId;
        // Your own message always pulls you down; someone else's must not.
        if (own) jumpToBottom();
        else setUnread((n) => n + added);
      }
    }

    prevCount.current = count;
    prevLastId.current = lastId;
  }, [messages, selfId, jumpToBottom]);

  if (initialLoading) return <MessageListSkeleton />;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-quiet h-full overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
      >
        {/*
          A chat column that fills a 1400px window is unreadable — the eye has to travel
          the full width to pair a message with its timestamp. Capped and centred.
        */}
        {/*
          `min-h-full` + `justify-end` keeps a short conversation pinned to the bottom of
          the viewport, the way every messaging app does it. Left top-aligned, three
          messages sat marooned above a large empty panel and read as a loading failure.
        */}
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end">
        {hasMore && (
          <div className="flex justify-center pb-5">
            {loadingOlder ? (
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                <Spinner className="size-3.5" /> Loading earlier messages…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const el = scrollRef.current;
                  if (el) restoreHeight.current = el.scrollHeight;
                  onLoadOlder();
                }}
                className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-muted transition-colors hover:bg-paper-sunken"
              >
                Load earlier messages
              </button>
            )}
          </div>
        )}

        {/*
          The live region announces only new arrivals. `relevant="additions"` keeps screen
          readers from re-reading the whole history when an older page is prepended.
        */}
        <ol
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Messages"
          className="flex flex-col gap-0.5"
        >
          {rows.map((row) =>
            row.kind === 'day' ? (
              <li key={row.key} className="relative flex justify-center py-4">
                <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line" />
                <span className="relative rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  {formatDaySeparator(row.ts)}
                </span>
              </li>
            ) : (
              <MessageRow
                key={row.key}
                message={row.message}
                showSender={row.showSender}
                tail={row.tail}
                isGroupChat={isGroupChat}
                conversation={conversation}
                selfId={selfId}
                onRetry={onRetry}
              />
            ),
          )}
        </ol>
        </div>
      </div>

      <NewMessagesPill count={unread} onClick={scrollToBottom} />
    </div>
  );
}

function MessageRow({
  message,
  showSender,
  tail,
  isGroupChat,
  conversation,
  selfId,
  onRetry,
}: {
  message: Message;
  showSender: boolean;
  tail: boolean;
  isGroupChat: boolean;
  conversation: Conversation | undefined;
  selfId: string;
  onRetry: (tempId: string) => void;
}) {
  const own = message.senderId === selfId;
  const name = senderName(conversation, message.senderId, selfId);
  const failed = message.status === 'failed';

  const queued = message.status === 'queued';
  const sending = message.status === 'sending';

  /*
   * The timestamp sits inside the bubble rather than on its own row underneath. A row of
   * its own — the obvious first approach — added ~18px between every pair of messages,
   * which stopped consecutive messages grouping and left the thread looking like a list of
   * cards rather than a conversation.
   *
   * It is floated rather than absolutely positioned over a fixed-width spacer: the spacer
   * has to guess the rendered width of the time, and when it guesses low the text runs
   * underneath it. A float sizes itself and the text simply wraps around it.
   *
   * Below `sm` the float is dropped and the meta takes its own right-aligned line. On a
   * narrow bubble a short last line left the time stranded at the far edge with a visible
   * gap punched through the middle of the sentence; there isn't room for both on one line.
   */

  return (
    <li
      className={cx(
        'flex gap-2',
        own ? 'justify-end' : 'justify-start',
        tail ? 'mb-3' : 'mb-[3px]',
      )}
    >
      {!own && isGroupChat && (
        <span className="w-7 shrink-0 self-end">
          {tail && <Avatar name={name} id={message.senderId} size="sm" />}
        </span>
      )}

      <div className={cx('flex max-w-[min(74%,32rem)] flex-col', own ? 'items-end' : 'items-start')}>
        {showSender && !own && (
          <span className="mb-1 px-1 text-xs font-semibold text-ink-muted">{name}</span>
        )}

        <div
          className={cx(
            'animate-pop-in px-3 py-[7px] text-[15px] leading-[1.45] break-words',
            'shadow-[0_1px_1px_rgb(20_23_31_/_5%)]',
            // Contains the floated timestamp so the bubble always wraps it.
            "after:block after:clear-both after:content-['']",
            own
              ? tail ? 'bubble-out' : 'bubble-mid-out'
              : tail ? 'bubble-in' : 'bubble-mid-in',
            /*
             * A queued message must not be able to pass for a delivered one — that is the
             * single claim this whole product makes. It drops the solid accent fill for a
             * dashed amber outline, which is the palette's own "queued / waking" colour, so
             * an undelivered message reads as visibly in-waiting rather than as sent.
             */
            own && !queued && !failed
              ? 'bg-vermilion text-white'
              : null,
            !own && !failed ? 'border border-line bg-paper-raised text-ink' : null,
            own && queued && 'border border-dashed border-amber/60 bg-amber-soft text-ink shadow-none',
            sending && 'opacity-75',
            failed && 'border-vermilion-line bg-vermilion-soft text-ink shadow-none',
          )}
        >
          <span className="whitespace-pre-wrap">{message.text}</span>

          <span
            className={cx(
              'mt-[7px] flex items-center gap-1 text-[11px] leading-none tabular-nums',
              'justify-end max-sm:mt-1.5 sm:float-right sm:ml-2.5',
              own && queued
                ? 'text-amber'
                : own && !failed
                  ? 'text-white/90'
                  : 'text-ink-faint',
            )}
          >
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt)}
            </time>
            {own && <DeliveryState status={message.status} />}
          </span>
        </div>

        {failed && (
          <span className="mt-1 flex items-center gap-2 px-1 text-[11px]">
            <span className="font-medium text-vermilion">Not sent</span>
            <button
              type="button"
              onClick={() => onRetry(message.tempId ?? message.id)}
              className="font-semibold text-vermilion underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </span>
        )}
        {message.status === 'queued' && (
          <span className="mt-1 px-1 text-[11px] text-amber">Waiting for connection</span>
        )}
      </div>
    </li>
  );
}

function DeliveryState({ status }: { status: Message['status'] }) {
  if (status === 'sent') {
    return (
      <>
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
          <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Sent</span>
      </>
    );
  }
  if (status === 'sending') {
    return (
      <>
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Sending</span>
      </>
    );
  }
  if (status === 'queued') {
    /*
     * A clock, not a blank. Queued used to render no glyph at all, which meant the only
     * thing separating "waiting" from "delivered" was the absence of a tick — a difference
     * nobody notices. It is also spelled out beneath the bubble.
     */
    return (
      <>
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" />
          <path d="M8 4.8V8l2.2 1.3" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Waiting to send</span>
      </>
    );
  }
  // Failed is spelled out beneath the bubble instead of encoded in a glyph.
  return null;
}

/**
 * The "new messages" pill.
 *
 * Appears only when a message arrives while the user is scrolled away from the bottom —
 * the brief calls this behaviour out specifically, so the rule is strict: incoming
 * messages never move the viewport, and the only thing that scrolls the user down is
 * their own action (this pill, or sending a message).
 */
function NewMessagesPill({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="animate-slide-up-fade pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper shadow-lg transition-transform hover:-translate-y-0.5"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3v10M4 9.5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {count} new {count === 1 ? 'message' : 'messages'}
      </button>
    </div>
  );
}

export function MessageListSkeleton() {
  const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-24'];
  return (
    <div className="flex-1 space-y-3 px-4 py-6 sm:px-6" aria-hidden="true">
      {widths.map((w, i) => (
        <div key={i} className={cx('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cx('h-9 rounded-xl', w)} />
        </div>
      ))}
    </div>
  );
}
