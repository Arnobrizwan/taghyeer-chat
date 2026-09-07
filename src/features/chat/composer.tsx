'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cx, isSendableText, MAX_MESSAGE_LENGTH } from '@/lib/utils';

const MAX_ROWS_PX = 160;

export function Composer({
  onSend,
  disabled = false,
  placeholder = 'Write a message…',
  offline = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  offline?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

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
    onSend(value);
    setValue('');
    ref.current?.focus();
  }

  const overLimit = value.length > MAX_MESSAGE_LENGTH;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-line bg-paper-raised px-3 py-3 sm:px-4"
    >
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
          aria-describedby={overLimit ? 'composer-limit' : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={cx(
            'w-full resize-none rounded-xl border bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed',
            'placeholder:text-ink-faint focus:outline-none',
            overLimit ? 'border-vermilion' : 'border-line-strong',
          )}
        />
        {overLimit && (
          <p id="composer-limit" role="alert" className="px-1 pt-1 text-xs text-vermilion">
            {value.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} characters
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={cx(
          'mb-px flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-150',
          canSend
            ? 'bg-vermilion text-white hover:bg-vermilion-bright active:translate-y-px'
            : 'cursor-not-allowed bg-paper-sunken text-ink-faint',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
