'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { conversationTitle, isGroup, type Conversation, conversationAvatarId } from '@/lib/domain';
import { Avatar, ErrorState } from '@/components/ui';
import { MembersPanel } from '@/features/groups/members-panel';
import { bumpConversation } from '@/features/conversations/use-conversations';
import { MessageList } from './message-list';
import { Composer } from './composer';
import { orderedMessages, useChatStore } from './store';
import { useThread } from './use-thread';
import { formatPhone } from '@/lib/utils';

export function ThreadView({
  conversationId,
  conversation,
  selfId,
  conversationsLoading,
}: {
  conversationId: string;
  conversation: Conversation | undefined;
  selfId: string;
  conversationsLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { thread, loadOlder, send, retry, reload, connection } = useThread(conversationId, selfId);
  const outboxCount = useChatStore((s) =>
    s.outbox.filter((e) => e.conversationId === conversationId).length,
  );

  const messages = useMemo(() => (thread ? orderedMessages(thread) : []), [thread]);

  // There is no GET /conversations/{id} (findings §8), so a thread's metadata can only
  // come from the list. Until that resolves we can't tell "loading" from "not yours".
  if (!conversation && conversationsLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="sr-only">Loading conversation</span>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="Conversation not found"
          body="This conversation doesn't exist, or you're no longer a member of it."
        />
      </div>
    );
  }

  const title = conversationTitle(conversation);
  const group = isGroup(conversation);
  const offline = connection !== 'connected';

  return (
    <div className="flex min-h-0 w-full flex-col bg-paper">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-paper-raised px-3 sm:px-5">
        <Link
          href="/app"
          aria-label="Back to conversations"
          className="-ml-1 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-paper-sunken md:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <Avatar name={title} id={conversationAvatarId(conversation)} isGroup={group} />

        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[15px] leading-tight font-semibold text-ink">{title}</h2>
          <p className="truncate text-xs text-ink-muted">
            {group
              ? `${conversation.participants.length} ${conversation.participants.length === 1 ? 'member' : 'members'}`
              : formatPhone(conversation.peer.phone)}
          </p>
        </div>

        {group && (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink-faint hover:bg-paper-sunken"
          >
            Details
          </button>
        )}
      </header>

      {thread?.status === 'error' ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState
            title="Couldn't load messages"
            body={thread.error ?? 'Something went wrong.'}
            onRetry={reload}
          />
        </div>
      ) : messages.length === 0 && thread?.status === 'ready' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Avatar name={title} id={conversationAvatarId(conversation)} isGroup={group} size="lg" />
          <h3 className="pt-2 font-display text-2xl text-ink">{title}</h3>
          <p className="max-w-sm text-sm leading-relaxed text-ink-muted">
            {group
              ? 'This group is quiet so far. Send the first message.'
              : `No messages yet with ${title}. Say hello.`}
          </p>
        </div>
      ) : (
        <MessageList
          // Remounting per conversation resets scroll/unread state without an effect.
          key={conversationId}
          messages={messages}
          conversation={conversation}
          selfId={selfId}
          hasMore={thread?.hasMore ?? false}
          loadingOlder={thread?.loadingOlder ?? false}
          onLoadOlder={() => void loadOlder()}
          onRetry={retry}
          initialLoading={!thread || thread.status === 'loading' || thread.status === 'idle'}
        />
      )}

      <Composer
        offline={offline && outboxCount > 0}
        onSend={(text) => {
          const verdict = send(text);
          if (!verdict.ok) return verdict;
          // Reorder the sidebar immediately rather than waiting on the round trip.
          bumpConversation(queryClient, conversationId, {
            text: text.trim(),
            senderId: selfId,
            createdAt: Date.now(),
          });
          return verdict;
        }}
      />

      {group && (
        <MembersPanel
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          group={conversation}
          selfId={selfId}
        />
      )}
    </div>
  );
}
