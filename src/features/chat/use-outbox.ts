'use client';

import { useCallback, useEffect, useRef } from 'react';
import { sendMessage } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import { publishCrossTab, useIsOutboxLeader } from '@/lib/cross-tab';
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
 *
 * For the same reason only the **leader tab** transmits. The queue is shared through
 * localStorage, so without an election every open tab would flush the same entries and
 * every queued message would be sent once per tab. Results are broadcast so the follower
 * tabs still show delivery immediately.
 */
export function useOutbox(): { flush: () => void; isLeader: boolean } {
  const { connection } = useSocket();
  const outbox = useChatStore((s) => s.outbox);
  const isLeader = useIsOutboxLeader();
  const flushing = useRef(false);
  /*
   * Leadership is mirrored into a ref so the long-running flush loop can re-check it on
   * every iteration and stop immediately if this tab is demoted mid-drain, without
   * `flush` itself being re-created and losing its in-flight guard.
   */
  const leaderRef = useRef(isLeader);
  useEffect(() => {
    leaderRef.current = isLeader;
  }, [isLeader]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    // Followers hold the same queue but must never transmit it.
    if (!leaderRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    flushing.current = true;
    const store = useChatStore.getState();

    try {
      // Re-read the queue each iteration: the user may add or discard while we work.
      for (;;) {
        const next = useChatStore.getState().outbox[0];
        if (!next) break;
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        if (!leaderRef.current) break;

        store.markSending(next.tempId);
        try {
          const sent = await sendMessage(next.conversationId, next.text);
          useChatStore.getState().resolveSent(next.tempId, sent);
          // The sender gets no socket echo, so sibling tabs would never learn about this.
          publishCrossTab({ type: 'outbox:sent', tempId: next.tempId, message: sent });
          publishCrossTab({ type: 'conversations:stale' });
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
          publishCrossTab({ type: 'outbox:failed', tempId: next.tempId });
        }
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  // Flush whenever a route back to the server opens, new work arrives, or this tab is
  // promoted to leader because the previous one closed.
  useEffect(() => {
    if (outbox.length === 0) return;
    if (isLeader && connection === 'connected') void flush();
  }, [outbox, connection, isLeader, flush]);

  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  return { flush: () => void flush(), isLeader };
}
