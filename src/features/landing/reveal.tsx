'use client';

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
  const [shown, setShown] = useState(false);

  /*
   * No reduced-motion branch here on purpose: the global stylesheet collapses transition
   * durations under `prefers-reduced-motion`, so this reveals instantly for those users
   * without a second code path — and without a setState during the effect body.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

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
    return () => observer.disconnect();
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
