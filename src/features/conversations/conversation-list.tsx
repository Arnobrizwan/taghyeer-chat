'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import Link from 'next/link';
import { conversationTitle, isGroup, type Conversation, conversationAvatarId } from '@/lib/domain';
import { Avatar, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { formatListTimestamp } from '@/lib/utils/time';
import { cx } from '@/lib/utils';

export function ConversationList({
  conversations,
  activeId,
  selfId,
  isLoading,
  error,
  onRetry,
  onStartChat,
}: {
  conversations: Conversation[] | undefined;
  activeId: string | null;
  selfId: string;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onStartChat: () => void;
}) {
  if (isLoading) return <ConversationListSkeleton />;

  if (error) {
    return <ErrorState title="Couldn't load your chats" body={error} onRetry={onRetry} />;
  }

  if (!conversations || conversations.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Find someone by name or phone number to start your first chat."
        action={
          <button
            type="button"
            onClick={onStartChat}
            className="rounded-lg bg-vermilion px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-vermilion-bright"
          >
            Start a conversation
          </button>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col px-2 pb-2">
      {conversations.map((c) => (
        <li key={c.id} className="overflow-hidden rounded-lg">
          <ConversationRow conversation={c} active={c.id === activeId} selfId={selfId} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation,
  active,
  selfId,
}: {
  conversation: Conversation;
  active: boolean;
  selfId: string;
}) {
  const title = conversationTitle(conversation);
  const group = isGroup(conversation);
  const last = conversation.lastMessage;

  const preview = last
    ? `${last.senderId === selfId ? 'You: ' : group ? `${shortName(conversation, last.senderId)}: ` : ''}${last.text || '—'}`
    : group
      ? 'No messages yet'
      : 'Say hello';

  return (
    <Link
      href={`/app/c/${conversation.id}`}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150',
        // A left rule marks the active thread. A background tint alone reads as a hover
        // state, which is ambiguous when the pointer happens to be resting on a row.
        active
          ? 'bg-vermilion-soft before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r before:bg-vermilion before:content-[""]'
          : 'hover:bg-paper-sunken',
      )}
    >
      <Avatar name={title} id={conversationAvatarId(conversation)} isGroup={group} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cx(
              'truncate text-[15px] leading-tight',
              active ? 'font-semibold text-ink' : 'font-medium text-ink',
            )}
          >
            {title}
          </span>
          {last && (
            <time
              dateTime={new Date(last.createdAt).toISOString()}
              className="shrink-0 text-[11px] tabular-nums text-ink-faint"
            >
              {formatListTimestamp(last.createdAt)}
            </time>
          )}
        </span>
        <span
          className={cx(
            'truncate text-[13px] leading-snug',
            last ? 'text-ink-muted' : 'text-ink-faint italic',
          )}
        >
          {preview}
        </span>
      </span>
    </Link>
  );
}

function shortName(conversation: Conversation, senderId: string): string {
  if (conversation.type !== 'group') return '';
  const p = conversation.participants.find((x) => x.id === senderId);
  return p ? (p.name.split(/\s+/)[0] ?? p.name) : 'Former member';
}

export function ConversationListSkeleton() {
  return (
    <ul className="flex flex-col px-2 pt-1" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
