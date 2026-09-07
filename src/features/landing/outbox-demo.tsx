'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cx, isSendableText } from '@/lib/utils';

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
};

const SCRIPTED_REPLIES = [
  'Ha — nice. Did that actually go through?',
  'Still with you.',
  'Right, so nothing got lost then.',
  'Neat.',
];

const SEED: DemoMessage[] = [
  { id: 's1', text: 'Are you on the train yet?', own: false, status: 'sent' },
  { id: 's2', text: 'Just got on. Signal is already terrible', own: true, status: 'sent' },
  { id: 's3', text: 'Classic. Try me when you hit the tunnel', own: false, status: 'sent' },
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
          { id: `r${Date.now()}`, text: reply, own: false, status: 'sent' },
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

    setMessages((prev) => [...prev, { id, text, own: true, status: 'queued' }]);

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
      <div ref={scrollRef} className="scroll-quiet h-72 space-y-2 overflow-y-auto bg-paper px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className={cx('flex', m.own ? 'justify-end' : 'justify-start')}>
            <div className={cx('flex max-w-[80%] flex-col', m.own ? 'items-end' : 'items-start')}>
              <div
                className={cx(
                  'animate-pop-in px-3.5 py-2 text-sm leading-relaxed break-words',
                  m.own
                    ? 'bubble-out bg-vermilion text-white'
                    : 'bubble-in border border-line bg-paper-raised text-ink',
                  m.status !== 'sent' && 'opacity-70',
                )}
              >
                {m.text}
              </div>
              {m.own && (
                <span className="mt-0.5 px-1 text-[10px] font-medium">
                  {m.status === 'sent' && <span className="text-teal">Sent</span>}
                  {m.status === 'sending' && <span className="text-ink-faint">Sending…</span>}
                  {m.status === 'queued' && (
                    <span className="text-amber">Queued — waiting for connection</span>
                  )}
                </span>
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
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3.5 py-2.5 text-sm placeholder:text-ink-faint"
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
