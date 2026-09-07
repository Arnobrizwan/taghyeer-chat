'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createGroup, startDirectConversation } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import type { Conversation, UserRef } from '@/lib/domain';
import { Field, Modal } from '@/components/ui';
import { cx } from '@/lib/utils';
import { conversationsKey } from './use-conversations';
import { UserSearchPicker } from './user-search-picker';

type Tab = 'direct' | 'group';

export function NewChatDialog({
  open,
  onClose,
  selfId,
  conversations,
}: {
  open: boolean;
  onClose: () => void;
  selfId: string;
  conversations: Conversation[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('direct');
  const [groupName, setGroupName] = useState('');
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    setGroupName('');
    setGroupNameError(null);
    setTab('direct');
    onClose();
  }

  /**
   * Start a direct chat.
   *
   * `POST /conversations` is idempotent for an existing pair (findings §7), so this is
   * safe to call blind — but we check the local list first anyway and route straight
   * there, which avoids a ~1s round trip and makes "you already have this chat" feel
   * instant rather than like a new chat was created.
   */
  const startDirect = useMutation({
    mutationFn: async (user: UserRef) => {
      const existing = conversations.find(
        (c) => c.type === 'direct' && c.peer.id === user.id,
      );
      if (existing) return existing.id;
      const id = await startDirectConversation(user.id);
      await queryClient.invalidateQueries({ queryKey: conversationsKey });
      return id;
    },
    onSuccess: (id) => {
      close();
      router.push(`/app/c/${id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.userMessage : 'Could not start that chat.'),
  });

  const makeGroup = useMutation({
    mutationFn: async ({ name, users }: { name: string; users: UserRef[] }) => {
      const group = await createGroup(name, users.map((u) => u.id));
      await queryClient.invalidateQueries({ queryKey: conversationsKey });
      return group.id;
    },
    onSuccess: (id) => {
      close();
      router.push(`/app/c/${id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.userMessage : 'Could not create that group.'),
  });

  return (
    <Modal open={open} onClose={close} title="New conversation">
      <div className="flex flex-col gap-4 p-5">
        <div
          role="tablist"
          aria-label="Conversation type"
          className="flex gap-1 rounded-xl border border-line bg-paper-sunken p-1"
        >
          {(['direct', 'group'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={cx(
                'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-paper-raised text-ink shadow-sm'
                  : 'text-ink-muted hover:bg-paper-raised/50 hover:text-ink',
              )}
            >
              {t === 'direct' ? 'Direct message' : 'New group'}
            </button>
          ))}
        </div>

        {tab === 'group' && (
          <Field
            label="Group name"
            placeholder="Project Team"
            value={groupName}
            error={groupNameError}
            maxLength={80}
            onChange={(e) => {
              setGroupName(e.target.value);
              if (groupNameError) setGroupNameError(null);
            }}
          />
        )}

        <UserSearchPicker
          key={tab}
          selfId={selfId}
          multiple={tab === 'group'}
          busy={startDirect.isPending || makeGroup.isPending}
          confirmLabel={tab === 'direct' ? 'Start chat' : 'Create group'}
          onConfirm={(users) => {
            setError(null);
            if (tab === 'direct') {
              const user = users[0];
              if (user) startDirect.mutate(user);
              return;
            }
            const trimmed = groupName.trim();
            if (!trimmed) {
              setGroupNameError('Group name is required');
              return;
            }
            // The API needs 2 others (3 members including you) and rejects fewer with a
            // validation error; catching it here is a clearer message than the server's.
            if (users.length < 2) {
              setError('A group needs at least two other people.');
              return;
            }
            makeGroup.mutate({ name: trimmed, users });
          }}
        />

        {error && (
          <p role="alert" className="text-sm font-medium text-vermilion">
            {error}
          </p>
        )}

        {tab === 'group' && (
          <p className="text-xs text-ink-muted">
            Groups need at least three members including you. You&apos;ll be the admin.
          </p>
        )}
      </div>
    </Modal>
  );
}
