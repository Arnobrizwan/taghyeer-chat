'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCrossTab, type CrossTabEvent } from '@/lib/cross-tab';
import { conversationsKey } from '@/features/conversations/use-conversations';
import { useChatStore } from './store';

/**
 * Applies events published by sibling tabs. Mounted once, in the app shell.
 *
 * This is what makes a second tab of the same user stay truthful. Inbound messages from
 * other people already reach every tab (each holds its own socket), but the API sends the
 * author no echo of their own message (findings §1.3) — so without this, sending from one
 * tab leaves every other tab's copy of the thread silently out of date.
 *
 * Store actions are called directly and never re-published: `BroadcastChannel` does not
 * deliver a message back to the tab that posted it, so there is no loop to guard against.
 */
export function useCrossTabSync(): void {
  const queryClient = useQueryClient();

  useCrossTab((event: CrossTabEvent) => {
    const store = useChatStore.getState();

    switch (event.type) {
      case 'outbox:enqueued':
        // Mirror the pending message so it is visible in every tab, not just the one it
        // was typed in. Only the leader will actually transmit it.
        store.enqueue(event.entry);
        break;

      case 'outbox:sent':
        // Swap the placeholder for the server copy. Safe even in a tab that never held
        // the placeholder — the delete is a no-op and the insert is keyed by server id.
        store.resolveSent(event.tempId, event.message);
        break;

      case 'outbox:failed':
        store.markFailed(event.tempId);
        store.dequeue(event.tempId);
        break;

      case 'outbox:discarded':
        store.discard(event.conversationId, event.tempId);
        break;

      case 'conversations:stale':
        void queryClient.invalidateQueries({ queryKey: conversationsKey });
        break;
    }
  });
}
