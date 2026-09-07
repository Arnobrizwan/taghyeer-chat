'use client';

import { forwardRef, useId } from 'react';
import { cx } from '@/lib/utils';

// --- Button -----------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

/*
 * Disabled states are spelled out per variant rather than left to a blanket `opacity`.
 * The primary variant used to fall back to `ink-faint` — a cold blue-grey — which on this
 * warm paper ground read as a dead slab rather than a waiting button. Every disabled
 * control now settles onto `paper-sunken`, the same surface the rest of the UI recesses
 * into, so an unavailable action looks quiet instead of broken.
 */
const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-vermilion text-white hover:bg-vermilion-bright active:translate-y-px ' +
    'disabled:bg-paper-sunken disabled:text-ink-faint',
  secondary:
    'bg-paper-raised text-ink border border-line-strong hover:border-ink-muted active:translate-y-px ' +
    'disabled:bg-paper-sunken disabled:text-ink-faint disabled:border-line',
  ghost:
    'text-ink-soft hover:bg-paper-sunken active:translate-y-px ' +
    'disabled:text-ink-faint disabled:hover:bg-transparent',
  danger:
    'bg-white text-vermilion border border-vermilion/40 hover:bg-vermilion-soft ' +
    'disabled:bg-paper-sunken disabled:text-ink-faint disabled:border-line',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button stays focusable but inert, so focus isn't lost mid-action.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-[background-color,border-color,transform] duration-150',
        'disabled:cursor-not-allowed disabled:active:translate-y-0',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-[15px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

// --- Spinner ----------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- Text field -------------------------------------------------------------

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(error ? errorId : null, hint ? hintId : null) || undefined}
        className={cx(
          // 16px, not 15: iOS Safari zooms the whole page when a font-size under 16px is focused.
          'w-full rounded-lg border bg-paper-raised px-3.5 py-2.5 text-base text-ink',
          'placeholder:text-ink-faint transition-colors duration-150',
          error ? 'border-vermilion' : 'border-line-strong focus:border-ink-muted',
          className,
        )}
        {...rest}
      />
      {/*
         The hint stays put when validation fires. It used to be swapped out for the error,
         which removed the explanation ("no password — your number is your account") at
         exactly the moment someone had got the field wrong and most needed it.
       */}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-vermilion">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
});

// --- Avatar -----------------------------------------------------------------

/** Deterministic tint from the user id, so a person looks the same everywhere. */
const AVATAR_TINTS = [
  'bg-vermilion-soft text-vermilion-on-soft',
  'bg-teal-soft text-teal',
  'bg-amber-soft text-amber',
  'bg-[#e6e9f5] text-[#3d4a7a]',
  'bg-[#e8f0e3] text-[#4a6b38]',
  'bg-[#f3e6f0] text-[#7a3d6b]',
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

export function Avatar({
  name,
  id,
  size = 'md',
  isGroup = false,
}: {
  name: string;
  id: string;
  size?: 'sm' | 'md' | 'lg';
  isGroup?: boolean;
}) {
  const tint = AVATAR_TINTS[hashCode(id) % AVATAR_TINTS.length] ?? AVATAR_TINTS[0];
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold',
        isGroup ? 'rounded-lg' : 'rounded-full',
        size === 'sm' ? 'size-7 text-[10px]' : size === 'lg' ? 'size-12 text-sm' : 'size-10 text-xs',
        tint,
      )}
    >
      {isGroup ? <GroupGlyph /> : initials(name)}
    </span>
  );
}

function GroupGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-1/2" fill="currentColor">
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="16.5" cy="9.5" r="2.4" opacity="0.65" />
      <path d="M3 19c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4z" />
      <path d="M16.5 13.5c2.6 0 4.5 1.6 4.5 3.9v1.6h-4.2v-1.6c0-1.5-.5-2.8-1.4-3.8z" opacity="0.65" />
    </svg>
  );
}

// --- States -----------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded', className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <h3 className="font-display text-2xl text-ink">{title}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
  retrying = false,
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-vermilion-soft text-vermilion">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{body}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}

// --- Modal ------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const generated = useId();
  const titleId = labelledBy ?? generated;
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="animate-slide-up-fade flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-paper-raised shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="font-display text-xl text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">{children}</div>
      </div>
    </div>
  );
}
