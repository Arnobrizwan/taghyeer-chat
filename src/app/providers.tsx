'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuthFailureHandler, setTokenProvider } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { useSession } from '@/features/auth/session';
import { useChatStore } from '@/features/chat/store';
import { SocketProvider } from '@/lib/socket/provider';

/*
 * Wire the module-level API client to the session store once, at import time.
 *
 * These are static registrations with no dependency on props or render state, so doing
 * them here rather than inside the component guarantees they are in place before the
 * first request can possibly be issued.
 */
setTokenProvider(() => useSession.getState().token);
setAuthFailureHandler(() => useSession.getState().signOut('expired'));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Warm latency is ~1s (findings §8), so refetching casually is expensive.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        // The socket doesn't announce new *direct* conversations (findings §7), so a
        // refetch on reconnect is how the list stays truthful.
        refetchOnReconnect: true,
        retry: (count, error) =>
          error instanceof ApiError ? error.isRetryable && count < 2 : count < 2,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Wires the API client to the session.
 *
 * The client is a plain module, not a hook, so it reads the token through a provider
 * function and reports auth failures through a callback. That keeps `request()` usable
 * from anywhere — including the outbox flusher, which runs outside React's tree.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const token = useSession((s) => s.token);
  const status = useSession((s) => s.status);
  const hydrateSession = useSession((s) => s.hydrate);
  const hydrateOutbox = useChatStore((s) => s.hydrate);

  useEffect(() => {
    hydrateSession();
    hydrateOutbox();
  }, [hydrateSession, hydrateOutbox]);

  // A signed-out user should not keep another account's cached conversations.
  useEffect(() => {
    if (status === 'anonymous') queryClient.clear();
  }, [status, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SocketProvider key={token ?? 'anonymous'} token={token}>
        {children}
      </SocketProvider>
    </QueryClientProvider>
  );
}
