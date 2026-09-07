'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx, isSendableText, MAX_MESSAGE_LENGTH } from '@/lib/utils';
import type { SendVerdict } from './send-guard';

const MAX_ROWS_PX = 160;

export function Composer({
  onSend,
  disabled = false,
  // Matches the landing demo verbatim; the two used to differ ('Write' vs 'Type').
  placeholder = 'Type a message…',
  offline = false,
}: {
  onSend: (text: string) => SendVerdict;
  disabled?: boolean;
  placeholder?: string;
  offline?: boolean;
}) {
  const [value, setValue] = useState('');
  const [throttle, setThrottle] = useState<{ reason: 'flood' | 'duplicate'; until: number } | null>(
    null,
  );
  const ref = useRef<HTMLTextAreaElement>(null);

  // Clear the notice once the cooldown has actually elapsed.
  useEffect(() => {
    if (!throttle) return;
    const id = setTimeout(() => setThrottle(null), Math.max(0, throttle.until - Date.now()));
    return () => clearTimeout(id);
  }, [throttle]);

  // Grow with content up to a cap, then scroll internally.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  /*
   * The single guard for empty sends.
   *
   * The server accepts empty and whitespace-only text and broadcasts it (findings §5.1),
   * so this is the only thing preventing it. `isSendableText` also backs the button's
   * disabled state, so the two can't drift apart, and it runs on submit as well — a
   * disabled button alone would still let an Enter keypress or a form submit through.
   */
  const canSend = isSendableText(value) && !disabled;

  function submit() {
    if (!canSend) return;
    const verdict = onSend(value);
    if (!verdict.ok) {
      // The text is deliberately kept in the box — the send was refused, not delivered,
      // and silently clearing what someone typed is worse than the spam being prevented.
      setThrottle({ reason: verdict.reason, until: Date.now() + verdict.retryInMs });
      return;
    }
    setThrottle(null);
    setValue('');
    ref.current?.focus();
  }

  const overLimit = value.length > MAX_MESSAGE_LENGTH;
  // The effect below clears this the moment the cooldown ends, so the presence of the
  // state is the whole answer — no clock read during render, which would be impure.
  const throttled = throttle !== null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border-t border-line bg-paper-raised px-3 py-3 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={offline ? 'Offline — messages will send when you reconnect' : placeholder}
          aria-describedby={
            overLimit ? 'composer-limit' : throttled ? 'composer-throttle' : undefined
          }
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={cx(
            // 16px: below that, focusing the composer makes iOS Safari zoom the whole thread.
            'w-full resize-none rounded-2xl border bg-paper px-4 py-2.5 text-base leading-relaxed',
            'transition-colors duration-150 placeholder:text-ink-faint focus:outline-none',
            overLimit
              ? 'border-vermilion'
              : 'border-line-strong hover:border-ink-faint focus:border-ink-muted',
          )}
        />
        {overLimit && (
          <p id="composer-limit" role="alert" className="px-1 pt-1 text-xs text-vermilion">
            {value.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} characters
          </p>
        )}
        {throttled && !overLimit && (
          <p id="composer-throttle" role="status" className="px-1 pt-1 text-xs text-amber">
            {throttle.reason === 'duplicate'
              ? 'You just sent that. Give it a second before sending it again.'
              : 'Slow down a moment — sending too quickly.'}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={cx(
          'mb-px flex size-11 shrink-0 items-center justify-center rounded-full transition-all duration-150',
          canSend
            ? 'bg-vermilion text-white shadow-sm hover:bg-vermilion-bright active:translate-y-px'
            : 'cursor-not-allowed bg-paper-sunken text-ink-faint',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      </div>
    </form>
  );
}
