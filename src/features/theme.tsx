'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { cx } from '@/lib/utils';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'taghyeer-chat:theme';

/**
 * Applied before first paint by an inline script in the document head.
 *
 * Reading localStorage in an effect would mean the light palette paints first and then
 * snaps to dark — the flash every themed site gets wrong. This runs synchronously, ahead
 * of the stylesheet resolving, so the correct palette is the only one ever rendered.
 * Kept deliberately tiny and dependency-free because it blocks parsing.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

function readStored(): Theme {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/*
 * The theme is external state — it lives in localStorage and on the <html> element, both
 * of which are outside React and can change from another tab. `useSyncExternalStore` is
 * the correct primitive for that: it avoids the "read it in an effect and setState"
 * pattern that causes a cascading render, and it makes the `storage` event a first-class
 * source, so switching theme in one tab updates every other tab immediately.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    applyTheme(readStored());
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const getSnapshot = (): Theme => readStored();
// The server cannot know the preference; the inline script fixes it up before paint.
const getServerSnapshot = (): Theme => 'system';

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode — the choice applies to this page only.
    }
    applyTheme(next);
    emit();
  }, []);

  return { theme, setTheme };
}

/**
 * Three-state control: light, system, dark.
 *
 * A two-state toggle can't express "follow my OS", which is the setting most people
 * actually want and the one a binary switch silently overwrites the moment it is touched.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <SunIcon /> },
    { value: 'system', label: 'Match system', icon: <SystemIcon /> },
    { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cx(
        'inline-flex items-center gap-0.5 rounded-full border border-line bg-paper-raised p-0.5 text-ink',
        className,
      )}
    >
      {options.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setTheme(o.value)}
            className={cx(
              'flex size-6 items-center justify-center rounded-full transition-colors duration-150',
              active
                ? 'bg-vermilion text-white'
                : 'text-current opacity-55 hover:opacity-100',
            )}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" strokeLinejoin="round" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="2.75" y="4.75" width="18.5" height="12.5" rx="2" />
      <path d="M8.5 20.5h7" strokeLinecap="round" />
    </svg>
  );
}
