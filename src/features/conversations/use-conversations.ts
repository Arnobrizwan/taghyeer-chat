'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations } from '@/lib/api/endpoints';
import type { Conversation, Message } from '@/lib/domain';
import { useSocket } from '@/lib/socket/provider';
import { useSession } from '@/features/auth/session';

export const conversationsKey = ['conversations'] as const;

/**
 * The conversation list, kept live.
 *
 * Two socket events feed it. `conversation:updated` covers group creation, renames and
 * membership changes; `message:new` updates the preview and re-orders the list. Direct
 * conversation *creation* emits nothing at all (findings §7), which is why the query also
 * refetches on window focus and reconnect — that is the only way a new incoming direct
 * chat appears without a manual refresh.
 *
 * Gated on an authenticated session. `AppShell` calls this above its own session guard —
 * hooks can't be called conditionally — and the store starts at `status: 'loading'` with a
 * null token until `Providers` hydrates it from localStorage. React runs child effects
 * before parent ones, so without this gate the query fires on mount, *before* that
 * hydration, and the request goes out with no Authorization header. This API answers a
 * missing token with `400 NO_TOKEN` rather than 401 (findings §3.1), so the symptom was a
 * 400 in the console on every cold load of /app. The gate also stops a refetch being
 * issued in the moment between signing out and the redirect landing.
 */
export function useConversations() {
  const queryClient = useQueryClient();
  const { onMessage, onConversationUpdated, reconnectNonce } = useSocket();
  const status = useSession((s) => s.status);

  const query = useQuery({
    queryKey: conversationsKey,
    queryFn: ({ signal }) => listConversations(signal),
    enabled: status === 'authenticated',
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
