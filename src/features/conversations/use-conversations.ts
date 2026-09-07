'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations } from '@/lib/api/endpoints';
import type { Conversation, Message } from '@/lib/domain';
import { useSocket } from '@/lib/socket/provider';

export const conversationsKey = ['conversations'] as const;

/**
 * The conversation list, kept live.
 *
 * Two socket events feed it. `conversation:updated` covers group creation, renames and
 * membership changes; `message:new` updates the preview and re-orders the list. Direct
 * conversation *creation* emits nothing at all (findings §7), which is why the query also
 * refetches on window focus and reconnect — that is the only way a new incoming direct
 * chat appears without a manual refresh.
 */
export function useConversations() {
  const queryClient = useQueryClient();
  const { onMessage, onConversationUpdated, reconnectNonce } = useSocket();

  const query = useQuery({
    queryKey: conversationsKey,
    queryFn: ({ signal }) => listConversations(signal),
  });

  useEffect(() => {
    return onConversationUpdated((updated: Conversation) => {
      queryClient.setQueryData<Conversation[]>(conversationsKey, (prev) => {
        if (!prev) return prev;
        const existing = prev.find((c) => c.id === updated.id);
        if (!existing) {
          // A group we've just been added to. Preserve list ordering by updatedAt.
          return sortByRecency([updated, ...prev]);
        }
        // Keep the locally-known preview: conversation:updated carries no lastMessage.
        return sortByRecency(
          prev.map((c) =>
            c.id === updated.id
              ? { ...updated, lastMessage: updated.lastMessage ?? c.lastMessage }
              : c,
          ),
        );
      });
    });
  }, [onConversationUpdated, queryClient]);

  useEffect(() => {
    return onMessage((m: Message) => {
      queryClient.setQueryData<Conversation[]>(conversationsKey, (prev) => {
        if (!prev) return prev;
        const target = prev.find((c) => c.id === m.conversationId);
        // A message for a conversation we don't know about yet — most likely a brand-new
        // direct chat, which the server never announced. Refetch to learn about it.
        if (!target) {
          void queryClient.invalidateQueries({ queryKey: conversationsKey });
          return prev;
        }
        return sortByRecency(
          prev.map((c) =>
            c.id === m.conversationId
              ? {
                  ...c,
                  lastMessage: { text: m.text, senderId: m.senderId, createdAt: m.createdAt },
                  updatedAt: m.createdAt,
                }
              : c,
          ),
        );
      });
    });
  }, [onMessage, queryClient]);

  // Messages that arrived while the socket was down never reach us as events.
  useEffect(() => {
    if (reconnectNonce === 0) return;
    void queryClient.invalidateQueries({ queryKey: conversationsKey });
  }, [reconnectNonce, queryClient]);

  return query;
}

function sortByRecency(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Locally reflect a just-sent message so the list reorders before the server confirms. */
export function bumpConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  preview: { text: string; senderId: string; createdAt: number },
) {
  queryClient.setQueryData<Conversation[]>(conversationsKey, (prev) =>
    prev
      ? sortByRecency(
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: preview, updatedAt: preview.createdAt }
              : c,
          ),
        )
      : prev,
  );
}
