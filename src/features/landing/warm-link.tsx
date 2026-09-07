'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { warmUp } from '@/lib/api/client';

/**
 * Starts the API booting while the visitor is still reading.
 *
 * The API sleeps after ~15 minutes idle, so whoever arrives first pays a cold start of up
 * to a minute. Almost all of that can be spent on the landing page instead of on a
 * spinner: a health probe on mount begins the boot immediately, and aiming at a call to
 * action re-warms it in case they lingered past the cooldown.
 */
export function PrewarmApi() {
  useEffect(() => {
    // Idle callback so the probe never competes with first paint.
    const start = () => warmUp();
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(start, { timeout: 1_200 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(start, 400);
    return () => window.clearTimeout(handle);
  }, []);

  return null;
}

/**
 * A link into the app that re-warms the API on intent.
 *
 * Hover, focus and touch-start all fire well before the click lands, which on a sleeping
 * container is a meaningful head start.
 */
export function WarmLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const warm = () => warmUp();

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
    >
      {children}
    </Link>
  );
}
