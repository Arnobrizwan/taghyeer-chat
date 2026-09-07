'use client';

import { use } from 'react';
import { useSession } from '@/features/auth/session';
import { useConversations } from '@/features/conversations/use-conversations';
import { ThreadView } from '@/features/chat/thread-view';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useSession((s) => s.user);
  const { data: conversations, isLoading } = useConversations();

  if (!user) return null;

  return (
    <ThreadView
      conversationId={id}
      conversation={conversations?.find((c) => c.id === id)}
      selfId={user.id}
      conversationsLoading={isLoading}
    />
  );
}
