'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useEffect, useState } from 'react';
import type { ConnectionState } from '@/lib/socket/provider';
import { cx } from '@/lib/utils';

/**
 * Live connection state.
 *
 * Shown because the socket silently drops nothing into the UI when it disconnects — and
 * because messages sent during a drop are never replayed (findings §1.6), so "am I
 * actually connected" is information the user genuinely needs.
 */
export function ConnectionIndicator({
  connection,
  queued,
  sendingHere = true,
}: {
  connection: ConnectionState;
  queued: number;
  /** False when another tab holds the outbox lock and is doing the sending. */
  sendingHere?: boolean;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const state = offline ? 'offline' : connection;

  const config = {
    connected: { dot: 'bg-teal', label: 'Connected', tone: 'text-ink-faint' },
    connecting: { dot: 'bg-amber', label: 'Connecting…', tone: 'text-amber' },
    disconnected: { dot: 'bg-amber', label: 'Reconnecting…', tone: 'text-amber' },
    offline: { dot: 'bg-ink-faint', label: 'Offline', tone: 'text-ink-muted' },
    unauthorised: { dot: 'bg-vermilion', label: 'Session rejected', tone: 'text-vermilion' },
  }[state];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cx('flex items-center gap-1.5 text-[11px] font-medium', config.tone)}
    >
      <span
        className={cx(
          'size-1.5 rounded-full',
          config.dot,
          state === 'connected' && 'animate-pulse-ring',
        )}
      />
      {config.label}
      {queued > 0 && (
        <span className="text-amber">
          · {queued} queued{!sendingHere && ' in another tab'}
        </span>
      )}
    </span>
  );
}
