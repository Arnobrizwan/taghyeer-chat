'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/utils';

/**
 * Reveals content once as it scrolls into view.
 *
 * Under `prefers-reduced-motion` the content is simply visible from the start — the
 * observer is never attached, so there is no transform and no transition to sit through.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Browsers without IntersectionObserver never get a hidden state to begin with.
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  /*
   * No reduced-motion branch here on purpose: the global stylesheet collapses transition
   * durations under `prefers-reduced-motion`, so this reveals instantly for those users
   * without a second code path — and without a setState during the effect body.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    /*
     * Anything already on screen at mount is revealed without waiting for the observer to
     * fire — that is what a deep link to an anchor lands on, and waiting a frame for it
     * shows a flash of empty ground.
     */
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(el);

    /*
     * A backstop, because the failure mode here is the worst one available: content that
     * starts at `opacity: 0` and never gets its event is a blank page, not a missing
     * animation. Three seconds is long past any legitimate reveal, and everything this
     * fires for is below the fold, so nobody watches it happen.
     */
    const failsafe = window.setTimeout(() => setShown(true), 3_000);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cx(
        'transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
