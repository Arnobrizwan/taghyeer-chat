'use client';

import { useEffect, useState } from 'react';
import { useServerStatus } from '@/lib/api/server-status';

/**
 * The cold-start explainer.
 *
 * The API is on Render's free tier and spins down after ~15 minutes idle, so the first
 * request after a quiet period blocks while a container boots. An unexplained 40-second
 * spinner is indistinguishable from a hung app, so once a request has been outstanding
 * long enough to mean a cold start we say what is happening and keep a live counter
 * running — a visibly progressing wait reads as working, where a static one reads as broken.
 */
export function ServerStatusBanner() {
  const status = useServerStatus((s) => s.status);
  const wakingSince = useServerStatus((s) => s.wakingSince);
  const [now, setNow] = useState(() => Date.now());

  // Tick only while waking; elapsed is derived, so there is no state to reset afterwards.
  useEffect(() => {
    if (status !== 'waking' || !wakingSince) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, wakingSince]);

  const elapsed = wakingSince ? Math.max(0, Math.floor((now - wakingSince) / 1000)) : 0;

  if (status !== 'waking' && status !== 'unreachable') return null;

  const unreachable = status === 'unreachable';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`animate-slide-up-fade flex items-center gap-3 border-b px-4 py-2.5 text-sm ${
        unreachable
          ? 'border-vermilion/25 bg-vermilion-soft text-vermilion'
          : 'border-amber/20 bg-amber-soft text-amber'
      }`}
    >
      {!unreachable && (
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-amber" />
        </span>
      )}
      <p className="min-w-0 flex-1">
        {unreachable ? (
          <>Can&apos;t reach the server right now. We&apos;ll keep trying.</>
        ) : (
          <>
            <span className="font-medium">Waking the server up.</span>{' '}
            <span className="text-amber/80">
              It sleeps after 15 minutes idle and takes up to a minute to start
              {elapsed > 0 ? ` — ${elapsed}s` : ''}.
            </span>
          </>
        )}
      </p>
    </div>
  );
}
