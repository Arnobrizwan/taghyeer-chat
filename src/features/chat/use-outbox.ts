'use client';

import { useCallback, useEffect, useRef } from 'react';
import { sendMessage } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import { useChatStore } from './store';
import { useSocket } from '@/lib/socket/provider';

/**
 * The offline outbox.
 *
 * Recon established that this API loses messages across a connection drop: nothing is
 * replayed when a socket reconnects (findings §1.6), and warm latency is around a second
 * (findings §8), so the window in which a send can be interrupted is not small.
 *
 * Every send is therefore queued first and transmitted second. The queue is persisted to
 * localStorage, so a message survives a reload or a crash, and it is flushed strictly in
 * FIFO order — one in flight at a time — because sending concurrently would let a later
 * message land before an earlier one and reorder the conversation for everybody.
 *
 * Sends are never retried automatically after an ambiguous failure. `POST /messages` is
 * not idempotent and has no client-supplied key, so a retry that races a slow success
 * would post the message twice.
 */
export function useOutbox(): { flush: () => void } {
  const { connection } = useSocket();
  const outbox = useChatStore((s) => s.outbox);
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    flushing.current = true;
    const store = useChatStore.getState();

    try {
      // Re-read the queue each iteration: the user may add or discard while we work.
      for (;;) {
        const next = useChatStore.getState().outbox[0];
        if (!next) break;
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;

        store.markSending(next.tempId);
        try {
          const sent = await sendMessage(next.conversationId, next.text);
          useChatStore.getState().resolveSent(next.tempId, sent);
        } catch (err) {
          const apiErr = err instanceof ApiError ? err : null;

          if (apiErr?.isRetryable) {
            // Still offline or the server is down. Leave it queued, keep order, stop.
            useChatStore.getState().markQueued(next.tempId);
            break;
          }

          // Permanent: not a participant, conversation gone, session expired. Surface it
          // with a retry affordance rather than silently dropping the user's text.
          useChatStore.getState().markFailed(next.tempId);
          useChatStore.getState().dequeue(next.tempId);
        }
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  // Flush whenever a route back to the server opens, or new work arrives.
  useEffect(() => {
    if (outbox.length === 0) return;
    if (connection === 'connected') void flush();
  }, [outbox, connection, flush]);

  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  return { flush: () => void flush() };
}
