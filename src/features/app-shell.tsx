'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from './auth/session';
import { useConversations } from './conversations/use-conversations';
import { ConversationList } from './conversations/conversation-list';
import { NewChatDialog } from './conversations/new-chat-dialog';
import { ConnectionIndicator } from './chat/connection-indicator';
import { useOutbox } from './chat/use-outbox';
import { useCrossTabSync } from './chat/use-cross-tab-sync';
import { useChatStore } from './chat/store';
import { useSocket } from '@/lib/socket/provider';
import { ServerStatusBanner } from '@/components/ui/server-status-banner';
import { ThemeToggle } from './theme';
import { Avatar, Button, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api/errors';
import { me } from '@/lib/api/endpoints';
import { cx } from '@/lib/utils';

/**
 * The application shell: session guard, sidebar, and the split-view layout.
 *
 * On desktop the list and the thread are both visible. On mobile only one is — `/app` is
 * the list and `/app/c/:id` is the thread — which is the standard messaging pattern and
 * avoids a cramped two-pane squeeze.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const setUser = useSession((s) => s.setUser);
  const { connection } = useSocket();
  const outboxCount = useChatStore((s) => s.outbox.length);

  // Keeps every open tab of this user showing the same timeline, and elects the single
  // tab allowed to transmit the outbox.
  useCrossTabSync();
  const { isLeader } = useOutbox();

  const [newChatOpen, setNewChatOpen] = useState(false);

  const activeId = pathname.startsWith('/app/c/') ? (pathname.split('/')[3] ?? null) : null;
  const showListOnMobile = activeId === null;

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  /*
   * Verify the stored token against the server on boot.
   *
   * The local expiry check in `hydrate()` only proves the token hasn't run out; it can
   * still be invalid. If it is, the client's auth handler signs out and the effect above
   * redirects — so an expired session lands on the login screen rather than a broken shell.
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    void me()
      .then((fresh) => {
        if (!cancelled) setUser(fresh);
      })
      .catch((err: unknown) => {
        /*
         * The `cancelled` guard matters as much here as on the success path. `/auth/me`
         * against a cold API can take most of a minute; without this, navigating away
         * mid-flight and then having it fail still ran `signOut('expired')` against the
         * shared session store, so a visitor who had already wandered back to the
         * marketing page was signed out by a screen they had left.
         */
        if (cancelled) return;
        if (err instanceof ApiError && err.isAuthFailure) signOut('expired');
      });
    return () => {
      cancelled = true;
    };
  }, [status, setUser, signOut]);

  const conversationsQuery = useConversations();
  const conversations = conversationsQuery.data ?? [];

  if (status === 'loading' || (status === 'authenticated' && !user)) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-6 text-ink-faint" />
        <span className="sr-only">Loading your session</span>
      </div>
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-6 text-ink-faint" />
        <span className="sr-only">Redirecting to sign in</span>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <ServerStatusBanner />

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={cx(
            'flex min-h-0 w-full flex-col border-r border-line bg-paper md:w-80 lg:w-96',
            showListOnMobile ? 'flex' : 'hidden md:flex',
          )}
        >
          {/* Both headers are h-16 so the sidebar and thread rules meet exactly. */}
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
            <Avatar name={user.name} id={user.id} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-ink">{user.name}</span>
              <ConnectionIndicator
                connection={connection}
                queued={outboxCount}
                sendingHere={isLeader}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                signOut('manual');
                router.replace('/login');
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink"
            >
              Sign out
            </button>
          </header>

          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h1 className="font-display text-[26px] leading-none text-ink">Chats</h1>
            <Button size="sm" onClick={() => setNewChatOpen(true)}>
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M10 4v12M4 10h12" strokeLinecap="round" />
              </svg>
              New
            </Button>
          </div>

          <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              selfId={user.id}
              isLoading={conversationsQuery.isLoading}
              error={
                conversationsQuery.error instanceof ApiError
                  ? conversationsQuery.error.userMessage
                  : conversationsQuery.error
                    ? 'Something went wrong.'
                    : null
              }
              onRetry={() => void conversationsQuery.refetch()}
              onStartChat={() => setNewChatOpen(true)}
            />
          </nav>

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-3">
            <Link
              href="/"
              className="group inline-flex items-center gap-1.5 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-3 transition-transform duration-200 group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 3.5L5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              About Relay
            </Link>
            <ThemeToggle />
          </footer>
        </aside>

        {/* Thread */}
        <main
          id="main-content"
          tabIndex={-1}
          className={cx('min-h-0 flex-1', showListOnMobile ? 'hidden md:flex' : 'flex')}
        >
          {children}
        </main>
      </div>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        selfId={user.id}
        conversations={conversations}
      />
    </div>
  );
}
