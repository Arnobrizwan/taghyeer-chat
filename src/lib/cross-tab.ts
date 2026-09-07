'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from './domain';
import type { OutboxEntry } from '@/features/chat/store';

/**
 * Coordination between tabs of the same signed-in user.
 *
 * Two problems make this necessary, and both come straight out of the API's behaviour
 * rather than from theory:
 *
 *  1. **The sender receives no `message:new` echo** (findings §1.3). Each tab holds its own
 *     socket, so inbound messages from *other people* reach every tab — but a message you
 *     send yourself reaches none of them. Open two tabs, send from one, and the other's
 *     thread silently goes stale until it refetches.
 *
 *  2. **The outbox is persisted to `localStorage`**, so two tabs that hydrate the same
 *     queue will both flush it. `POST /messages` is not idempotent and takes no client
 *     key, so that sends every queued message twice.
 *
 * The fix is a single elected leader for sending, plus an event bus so every tab sees the
 * same timeline. Leadership uses the Web Locks API: the lock is held for the lifetime of
 * the tab and released by the browser automatically when it closes or crashes, so a
 * successor is promoted with no heartbeat and no stale-lock timeout to tune.
 */

const CHANNEL = 'taghyeer-chat:tabs:v1';
const LEADER_LOCK = 'taghyeer-chat:outbox-leader:v1';

/**
 * Identifies this tab so it can ignore its own broadcasts.
 *
 * `BroadcastChannel` only withholds a message from the exact object that posted it — not
 * from other channel objects in the same tab. Since the publisher and the listener here
 * are separate instances (one is usable outside React, one is a hook), a tab does receive
 * its own events and would apply every optimistic message twice. Tagging by origin is the
 * reliable fix; comparing channel instances is not.
 */
const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

type Envelope = { from: string; event: CrossTabEvent };

export type CrossTabEvent =
  /** A tab optimistically queued a message; mirror it so every tab shows it as pending. */
  | { type: 'outbox:enqueued'; entry: OutboxEntry }
  /** The leader delivered a message; swap the placeholder for the server copy everywhere. */
  | { type: 'outbox:sent'; tempId: string; message: Message }
  /** Delivery failed permanently; show the retry affordance in every tab. */
  | { type: 'outbox:failed'; tempId: string }
  /** A pending message was dropped or retried; remove the old placeholder. */
  | { type: 'outbox:discarded'; conversationId: string; tempId: string }
  /** Something changed that the conversation list can only learn about by refetching. */
  | { type: 'conversations:stale' };

function createChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Subscribe to events from other tabs and get a publisher for this one.
 *
 * `BroadcastChannel` never delivers a message back to the tab that posted it, so there is
 * no echo to filter and no risk of a rebroadcast loop.
 */
export function useCrossTab(onEvent: (event: CrossTabEvent) => void) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlerRef = useRef(onEvent);

  // Keep the latest handler without re-subscribing the channel on every render.
  useEffect(() => {
    handlerRef.current = onEvent;
  });

  useEffect(() => {
    const channel = createChannel();
    channelRef.current = channel;
    if (!channel) return;

    const listener = (e: MessageEvent<Envelope>) => {
      // Content is written by our own code in a sibling tab, but it has still crossed a
      // boundary, so treat it as untrusted input and check the shape before applying it.
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.from === TAB_ID) return; // our own broadcast, echoed back via a sibling channel
      const event = data.event;
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
      handlerRef.current(event);
    };

    channel.addEventListener('message', listener);
    return () => {
      channel.removeEventListener('message', listener);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  return useCallback((event: CrossTabEvent) => {
    channelRef.current?.postMessage({ from: TAB_ID, event } satisfies Envelope);
  }, []);
}

/** Module-level publisher, for code paths that run outside a component. */
let standaloneChannel: BroadcastChannel | null = null;
export function publishCrossTab(event: CrossTabEvent): void {
  if (typeof window === 'undefined') return;
  standaloneChannel ??= createChannel();
  standaloneChannel?.postMessage({ from: TAB_ID, event } satisfies Envelope);
}

/**
 * True in exactly one tab at a time — the one allowed to transmit the outbox.
 *
 * Where the Web Locks API is unavailable we return `true` everywhere, which restores the
 * previous single-tab behaviour rather than disabling sending altogether. Duplicate sends
 * across tabs are bad; not sending at all is worse.
 */
export function useIsOutboxLeader(): boolean {
  const supported = typeof navigator !== 'undefined' && 'locks' in navigator;
  const [hasLock, setHasLock] = useState(false);

  useEffect(() => {
    if (!supported) return;

    let releaseLock: (() => void) | null = null;
    let cancelled = false;
    const pending = new AbortController();

    void navigator.locks
      .request(LEADER_LOCK, { signal: pending.signal }, () => {
        // Holding the lock for as long as this promise is unresolved makes leadership
        // last exactly as long as the tab does.
        return new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }
          setHasLock(true);
          releaseLock = resolve;
        });
      })
      .catch(() => {
        // AbortError on unmount while still queued behind another tab. Not an error.
      });

    return () => {
      cancelled = true;
      if (releaseLock) releaseLock();
      else pending.abort();
    };
  }, [supported]);

  return supported ? hasLock : true;
}
