'use client';

import { useCallback, useEffect, useRef } from 'react';
import { fetchMessages } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import { useChatStore, newTempId, type OutboxEntry } from './store';
import { publishCrossTab } from '@/lib/cross-tab';
import { useSocket } from '@/lib/socket/provider';
import { isSendableText } from '@/lib/utils';
import { checkSend, type SendVerdict } from './send-guard';

const PAGE_SIZE = 25;

/**
 * Loads and maintains one conversation's timeline.
 *
 * Every path in here funnels through the store's id-keyed upsert, which is what makes the
 * API's inclusive pagination cursor (findings §1.1) and any repeated socket delivery
 * harmless rather than duplicate-producing.
 */
export function useThread(conversationId: string | null, selfId: string | null) {
  const thread = useChatStore((s) =>
    conversationId ? s.threads[conversationId] : undefined,
  );
  const { onMessage, reconnectNonce, connection } = useSocket();
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'sync') => {
      if (!conversationId) return;
      const store = useChatStore.getState();
      if (mode === 'initial') store.setThreadStatus(conversationId, 'loading');
      try {
        const page = await fetchMessages(conversationId, { limit: PAGE_SIZE });
        useChatStore.getState().ingestPage(conversationId, page.messages, page.hasMore, mode);
      } catch (err) {
        const message = err instanceof ApiError ? err.userMessage : 'Failed to load messages';
        // A background re-sync must not blow away a thread the user is reading.
        if (mode === 'initial') {
          useChatStore.getState().setThreadStatus(conversationId, 'error', message);
        }
      }
    },
    [conversationId],
  );

  // Initial load, once per conversation.
  useEffect(() => {
    if (!conversationId) return;
    if (loadedFor.current === conversationId) return;
    loadedFor.current = conversationId;
    void load('initial');
  }, [conversationId, load]);

  /*
   * Re-sync after a reconnect.
   *
   * Mandatory, not defensive: the server replays nothing that was sent while the socket
   * was down (findings §1.6), so without this the thread silently omits them.
   */
  useEffect(() => {
    if (reconnectNonce === 0 || !conversationId) return;
    void load('sync');
  }, [reconnectNonce, conversationId, load]);

  // Live inbound messages.
  useEffect(() => {
    return onMessage((m) => {
      useChatStore.getState().ingestMessage(m);
    });
  }, [onMessage]);

  const loadOlder = useCallback(async () => {
    if (!conversationId) return;
    const current = useChatStore.getState().threads[conversationId];
    if (!current || current.loadingOlder || !current.hasMore || !current.oldestServerId) return;

    useChatStore.getState().setLoadingOlder(conversationId, true);
    try {
      const page = await fetchMessages(conversationId, {
        limit: PAGE_SIZE,
        before: current.oldestServerId,
      });
      // The cursor message comes back again as the first item; the id-keyed merge
      // collapses it instead of rendering a duplicate.
      useChatStore.getState().ingestPage(conversationId, page.messages, page.hasMore, 'older');
    } catch {
      useChatStore.getState().setLoadingOlder(conversationId, false);
    }
  }, [conversationId]);

  const send = useCallback(
    (text: string): SendVerdict => {
      if (!conversationId || !selfId) return { ok: true };
      // Guarded here as well as on the button: the server accepts empty and
      // whitespace-only text and broadcasts it (findings §5.1).
      if (!isSendableText(text)) return { ok: true };

      // The API has no rate limiting of its own, so flood and duplicate protection has to
      // live here. Checked at the point of enqueue, which covers the button, the Enter
      // key and any direct form submit alike.
      const verdict = checkSend(conversationId, text);
      if (!verdict.ok) return verdict;

      const entry: Omit<OutboxEntry, 'attempts'> = {
        tempId: newTempId(),
        conversationId,
        text: text.trim(),
        createdAt: Date.now(),
        senderId: selfId,
      };
      useChatStore.getState().enqueue(entry);
      // Show the pending message in every open tab, not only the one it was typed in.
      publishCrossTab({ type: 'outbox:enqueued', entry: { ...entry, attempts: 0 } });
      return { ok: true };
    },
    [conversationId, selfId],
  );

  const retry = useCallback(
    (tempId: string) => {
      const store = useChatStore.getState();
      const thread = conversationId ? store.threads[conversationId] : undefined;
      const failed = thread?.messages[tempId];
      if (!failed || !conversationId || !selfId) return;
      store.discard(conversationId, tempId);
      publishCrossTab({ type: 'outbox:discarded', conversationId, tempId });

      const entry: Omit<OutboxEntry, 'attempts'> = {
        tempId: newTempId(),
        conversationId,
        text: failed.text,
        createdAt: Date.now(),
        senderId: selfId,
      };
      store.enqueue(entry);
      publishCrossTab({ type: 'outbox:enqueued', entry: { ...entry, attempts: 0 } });
    },
    [conversationId, selfId],
  );

  return {
    thread,
    loadOlder,
    send,
    retry,
    reload: () => void load('initial'),
    connection,
  };
}
