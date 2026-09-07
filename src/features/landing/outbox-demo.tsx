'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cx, isSendableText } from '@/lib/utils';
import { formatTime } from '@/lib/utils/time';

/**
 * The landing page's original interaction: a working model of the offline outbox.
 *
 * Rather than assert that messages survive a dropped connection, this lets you cut the
 * connection yourself, keep typing, and watch the queue drain in order when you restore
 * it. It runs the same state machine as the real composer — queued → sending → sent — so
 * what you see here is what the app does, not a video of it.
 *
 * It is explicitly labelled a demo. No network is involved.
 */

type DemoStatus = 'queued' | 'sending' | 'sent';

type DemoMessage = {
  id: string;
  text: string;
  own: boolean;
  status: DemoStatus;
  at: string;
};

// The same pinned formatter the app uses, so a message you send here cannot come out in a
// different clock format from the seeded ones sitting directly above it.
const now = () => formatTime(Date.now());

const SCRIPTED_REPLIES = [
  'Ha — nice. Did that actually go through?',
  'Still with you.',
  'Right, so nothing got lost then.',
  'Neat.',
];

/*
 * Seven messages rather than three. The thread is bottom-anchored, so a short seed left
 * roughly 230px of empty panel above the first bubble on desktop and the demo read as
 * something that had failed to load rather than as a conversation in progress.
 */
const SEED: DemoMessage[] = [
  { id: 's1', text: 'Are you heading in today?', own: false, status: 'sent', at: '09:08' },
  { id: 's2', text: 'Yeah, on the 09:15. Should be at the office by ten', own: true, status: 'sent', at: '09:09' },
  { id: 's3', text: 'Perfect — I will grab you a coffee', own: false, status: 'sent', at: '09:10' },
  { id: 's4', text: 'Are you on the train yet?', own: false, status: 'sent', at: '09:12' },
  { id: 's5', text: 'Just got on. Signal is already terrible', own: true, status: 'sent', at: '09:12' },
  { id: 's6', text: 'Classic. Try me when you hit the tunnel', own: false, status: 'sent', at: '09:13' },
  { id: 's7', text: 'Will do. Going under in a minute', own: true, status: 'sent', at: '09:13' },
];

export function OutboxDemo() {
  const [online, setOnline] = useState(true);
  const [messages, setMessages] = useState<DemoMessage[]>(SEED);
  const [draft, setDraft] = useState('');
  const replyIndex = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /*
   * A mirror of `messages` that `flush` can read synchronously.
   *
   * Reading the queue inside a setState updater instead would make that updater impure —
   * and React deliberately double-invokes updaters in development, which fired every
   * scheduled follow-up twice. Updaters stay pure; scheduling happens out here.
   */
  const messagesRef = useRef<DemoMessage[]>(SEED);

  const queuedCount = messages.filter((m) => m.status === 'queued').length;

  useEffect(() => {
    messagesRef.current = messages;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Clear pending timers on unmount so the demo can't update after teardown.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);

  /** Drain the queue strictly in order, one at a time — the real flush semantics. */
  const flush = useCallback(() => {
    const queued = messagesRef.current.filter((m) => m.status === 'queued');
    if (queued.length === 0) return;

    queued.forEach((msg, i) => {
      schedule(() => {
        setMessages((cur) => cur.map((m) => (m.id === msg.id ? { ...m, status: 'sending' } : m)));
      }, i * 420);
      schedule(() => {
        setMessages((cur) => cur.map((m) => (m.id === msg.id ? { ...m, status: 'sent' } : m)));
      }, i * 420 + 320);
    });

    // One reply once the whole queue has landed, so the thread feels alive.
    schedule(() => {
      const reply = SCRIPTED_REPLIES[replyIndex.current % SCRIPTED_REPLIES.length];
      replyIndex.current += 1;
      if (reply) {
        setMessages((cur) => [
          ...cur,
          { id: `r${Date.now()}`, text: reply, own: false, status: 'sent', at: now() },
        ]);
      }
    }, queued.length * 420 + 700);
  }, [schedule]);

  function toggleNetwork() {
    // Computed out here, not inside the updater: scheduling is a side effect, and React
    // double-invokes updaters in development — which queued two flushes for one click.
    const next = !online;
    setOnline(next);
    if (next) schedule(flush, 250);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!isSendableText(draft)) return;
    const id = `m${Date.now()}`;
    const text = draft.trim();
    setDraft('');

    setMessages((prev) => [...prev, { id, text, own: true, status: 'queued', at: now() }]);

    if (online) {
      schedule(() => {
        setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, status: 'sending' } : m)));
      }, 120);
      schedule(() => {
        setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, status: 'sent' } : m)));
      }, 520);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-2xl shadow-ink/20">
      {/* Demo chrome */}
      <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal">
            SM
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-ink">Sam Mercer</span>
            <span
              className={cx(
                'flex items-center gap-1.5 text-[11px] font-medium',
                online ? 'text-ink-faint' : 'text-amber',
              )}
            >
              <span className={cx('size-1.5 rounded-full', online ? 'bg-teal' : 'bg-amber')} />
              {online ? 'Connected' : 'Offline'}
              {queuedCount > 0 && <span className="text-amber">· {queuedCount} queued</span>}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleNetwork}
          aria-pressed={!online}
          className={cx(
            'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-200',
            online
              ? 'border-line-strong text-ink-soft hover:border-vermilion hover:text-vermilion'
              : 'border-amber bg-amber-soft text-amber',
          )}
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            {online ? (
              <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" strokeLinecap="round" />
            ) : (
              <path d="M3 3l18 18M8.5 16a5 5 0 0 1 6-.8M5 12.5a10 10 0 0 1 4-2.4M12 19.5h.01" strokeLinecap="round" />
            )}
          </svg>
          {online ? 'Cut the connection' : 'Reconnect'}
        </button>
      </div>

      {/* Thread */}
      {/*
        Bottom-anchored and only as tall as it needs to be. Top-aligned in a fixed 288px
        panel, the three opening messages sat above a large empty area and the whole demo
        read as something that had failed to load.
      */}
      <div
        ref={scrollRef}
        className="scroll-quiet flex h-[248px] flex-col justify-end gap-2 overflow-y-auto bg-paper px-4 py-4 sm:h-[276px]"
      >
        {messages.map((m) => (
          <div key={m.id} className={cx('flex shrink-0', m.own ? 'justify-end' : 'justify-start')}>
            <div className={cx('flex max-w-[82%] flex-col', m.own ? 'items-end' : 'items-start')}>
              <div
                className={cx(
                  "animate-pop-in px-3 py-[7px] text-sm leading-[1.45] break-words after:block after:clear-both after:content-['']",
                  'shadow-[0_1px_1px_rgb(20_23_31_/_5%)]',
                  m.own && m.status !== 'queued'
                    ? 'bubble-out bg-vermilion text-white'
                    : null,
                  !m.own ? 'bubble-in border border-line bg-paper-raised text-ink' : null,
                  // Queued must not read as delivered — see the app's message list.
                  m.own && m.status === 'queued' &&
                    'bubble-out border border-dashed border-amber/60 bg-amber-soft text-ink shadow-none',
                  m.status === 'sending' && 'opacity-80',
                )}
              >
                <span className="whitespace-pre-wrap">{m.text}</span>
                <span
                  className={cx(
                    'mt-[7px] flex items-center gap-1 text-[11px] leading-none tabular-nums',
                    'justify-end max-sm:mt-1.5 sm:float-right sm:ml-2.5',
                    m.own && m.status === 'queued'
                      ? 'text-amber'
                      : m.own
                        ? 'text-white/90'
                        : 'text-ink-faint',
                  )}
                >
                  {m.at}
                  {m.own && m.status === 'sent' && (
                    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
                      <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {m.own && m.status === 'queued' && (
                    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" />
                      <path d="M8 4.8V8l2.2 1.3" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
              </div>
              {m.own && m.status === 'queued' && (
                <span className="mt-1 px-1 text-[11px] text-amber">Waiting for connection</span>
              )}
              {m.own && m.status === 'sending' && (
                <span className="mt-1 px-1 text-[11px] text-ink-faint">Sending…</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-line bg-paper-raised px-3 py-3">
        <label htmlFor="demo-composer" className="sr-only">
          Try the demo — type a message
        </label>
        <input
          id="demo-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={online ? 'Type a message…' : 'Still typing? Go ahead — it will queue'}
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3.5 py-2.5 text-base placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={!isSendableText(draft)}
          aria-label="Send demo message"
          className={cx(
            'flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors',
            isSendableText(draft)
              ? 'bg-vermilion text-white hover:bg-vermilion-bright'
              : 'cursor-not-allowed bg-paper-sunken text-ink-faint',
          )}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
