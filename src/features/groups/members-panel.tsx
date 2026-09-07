'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addParticipants,
  promoteToAdmin,
  removeParticipant,
  renameGroup,
} from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/errors';
import type { Conversation, GroupConversation, UserRef } from '@/lib/domain';
import { Avatar, Button, Field, Modal, Spinner } from '@/components/ui';
import { conversationsKey } from '@/features/conversations/use-conversations';
import { UserSearchPicker } from '@/features/conversations/user-search-picker';
import { cx, formatPhone } from '@/lib/utils';

/**
 * Group administration.
 *
 * Admin-only controls are not rendered at all for non-admins rather than rendered and
 * rejected: the API enforces this correctly with clear 403s (findings §7), but a button
 * that always fails is a worse experience than no button.
 */
export function MembersPanel({
  open,
  onClose,
  group,
  selfId,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupConversation;
  selfId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const isAdmin = group.adminIds.includes(selfId);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [addingMembers, setAddingMembers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  function applyUpdate(updated: GroupConversation) {
    queryClient.setQueryData<Conversation[]>(conversationsKey, (prev) =>
      prev?.map((c) => (c.id === updated.id ? { ...updated, lastMessage: c.lastMessage } : c)),
    );
  }

  function onError(err: unknown) {
    setActionError(err instanceof ApiError ? err.userMessage : 'That action failed.');
  }

  const rename = useMutation({
    mutationFn: (name: string) => renameGroup(group.id, name),
    onSuccess: (updated) => {
      applyUpdate(updated);
      setRenaming(false);
      setActionError(null);
    },
    onError,
  });

  const add = useMutation({
    mutationFn: (userIds: string[]) => addParticipants(group.id, userIds),
    onSuccess: (updated) => {
      applyUpdate(updated);
      setAddingMembers(false);
      setActionError(null);
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeParticipant(group.id, userId),
    onSuccess: applyUpdate,
    onError,
  });

  const promote = useMutation({
    mutationFn: (userId: string) => promoteToAdmin(group.id, userId),
    onSuccess: applyUpdate,
    onError,
  });

  const leave = useMutation({
    mutationFn: () => removeParticipant(group.id, selfId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
      onClose();
      // Client navigation: a hard reload would drop the socket and the in-memory outbox.
      router.push('/app');
    },
    onError,
  });

  function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    // The API rejects whitespace-only names with a differently-shaped error than empty
    // ones (findings §3.4), so both are caught here instead.
    if (!trimmed) {
      setNameError('Group name is required');
      return;
    }
    setNameError(null);
    rename.mutate(trimmed);
  }

  const existingIds = group.participants.map((p) => p.id);

  return (
    <Modal open={open} onClose={onClose} title="Group details">
      <div className="flex flex-col gap-6 p-5">
        {/* Name -------------------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Name</h3>
          {renaming ? (
            <form onSubmit={submitRename} className="flex flex-col gap-3">
              <Field
                label="Group name"
                value={nameDraft}
                error={nameError}
                autoFocus
                maxLength={80}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={rename.isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenaming(false);
                    setNameDraft(group.name);
                    setNameError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate font-display text-xl text-ink">{group.name}</p>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => setRenaming(true)}>
                  Rename
                </Button>
              )}
            </div>
          )}
        </section>

        {/* Members ----------------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {group.participants.length}{' '}
              {group.participants.length === 1 ? 'member' : 'members'}
            </h3>
            {isAdmin && !addingMembers && (
              <Button size="sm" variant="secondary" onClick={() => setAddingMembers(true)}>
                Add people
              </Button>
            )}
          </div>

          {addingMembers && (
            <div className="rounded-xl border border-line bg-paper p-3">
              <UserSearchPicker
                selfId={selfId}
                excludeIds={existingIds}
                busy={add.isPending}
                confirmLabel="Add to group"
                onCancel={() => setAddingMembers(false)}
                onConfirm={(users) => add.mutate(users.map((u) => u.id))}
              />
            </div>
          )}

          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-paper-raised">
            {group.participants.map((p) => (
              <MemberRow
                key={p.id}
                user={p}
                isSelf={p.id === selfId}
                isMemberAdmin={group.adminIds.includes(p.id)}
                viewerIsAdmin={isAdmin}
                onPromote={() => promote.mutate(p.id)}
                onRemove={() => remove.mutate(p.id)}
                busy={
                  (promote.isPending && promote.variables === p.id) ||
                  (remove.isPending && remove.variables === p.id)
                }
              />
            ))}
          </ul>
        </section>

        {actionError && (
          <p role="alert" className="text-sm font-medium text-vermilion">
            {actionError}
          </p>
        )}

        {/* Leave ------------------------------------------------------- */}
        <section className="border-t border-line pt-4">
          {/* Also previously a single click, and this one cannot be undone from the client. */}
          {confirmingLeave ? (
            <div className="flex flex-col gap-2 rounded-xl border border-vermilion/30 bg-vermilion-soft p-3">
              <p className="text-sm font-medium text-ink">
                Leave {group.name}? You&apos;ll need an admin to add you back.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => leave.mutate()}
                  loading={leave.isPending}
                  className="flex-1"
                >
                  Leave group
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingLeave(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingLeave(true)} className="w-full">
              Leave group
            </Button>
          )}
          {isAdmin && group.adminIds.length === 1 && group.participants.length > 1 && (
            <p className="pt-2 text-center text-xs text-ink-muted">
              You&apos;re the only admin — another member will be promoted automatically.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function MemberRow({
  user,
  isSelf,
  isMemberAdmin,
  viewerIsAdmin,
  onPromote,
  onRemove,
  busy,
}: {
  user: UserRef;
  isSelf: boolean;
  isMemberAdmin: boolean;
  viewerIsAdmin: boolean;
  onPromote: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    /*
      `flex-wrap` with the actions on their own full-width row below `sm`: at panel widths
      a long name and two inline controls had nowhere to go but into each other.
    */
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <Avatar name={user.name} id={user.id} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">
          {user.name}
          {isSelf && <span className="ml-1 font-normal text-ink-faint">(you)</span>}
        </span>
        <span className="truncate text-xs text-ink-muted">{formatPhone(user.phone)}</span>
      </span>

      {isMemberAdmin && (
        <span className="shrink-0 rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-teal uppercase">
          Admin
        </span>
      )}

      {busy && <Spinner className="size-4 text-ink-faint" />}

      {/* Admin-only actions are omitted entirely for non-admins. */}
      {viewerIsAdmin && !busy && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {confirmingRemove ? (
            /*
              Removing someone was a single unguarded click. The confirm is inline rather
              than a second modal on top of this one: it keeps the name you are acting on
              visible, which a stacked "Are you sure?" dialog does not.
            */
            <>
              <span className="text-xs text-ink-muted">Remove?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemove();
                }}
                className="rounded-md border border-vermilion/40 bg-vermilion-soft px-2.5 py-1 text-xs font-semibold text-vermilion-on-soft transition-colors hover:bg-vermilion hover:text-white"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-ink-muted"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {!isMemberAdmin && (
                /*
                  Bordered, not bare text. As plain grey type this was indistinguishable
                  from the phone number two lines up and gave no sign it could be clicked.
                */
                <button
                  type="button"
                  onClick={onPromote}
                  className={cx(
                    'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft',
                    'transition-colors hover:border-ink-muted hover:text-ink',
                  )}
                >
                  Make admin
                </button>
              )}
              {!isSelf && (
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  aria-label={`Remove ${user.name}`}
                  className="rounded-md border border-vermilion/30 px-2.5 py-1 text-xs font-medium text-vermilion transition-colors hover:bg-vermilion-soft"
                >
                  Remove
                </button>
              )}
            </>
          )}
        </span>
      )}
    </li>
  );
}
