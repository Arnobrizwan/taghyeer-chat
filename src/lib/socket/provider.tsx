'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_ORIGIN } from '@/lib/api/client';
import { groupSchema, socketMessageSchema } from '@/lib/schemas';
import type { Conversation, Message } from '@/lib/domain';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'unauthorised';

type SocketContextValue = {
  connection: ConnectionState;
  /** Increments on every successful (re)connect, so consumers can trigger a re-sync. */
  reconnectNonce: number;
  onMessage: (fn: (m: Message) => void) => () => void;
  onConversationUpdated: (fn: (c: Conversation) => void) => () => void;
};

const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * Inbound-only socket transport.
 *
 * Messages are *sent* over REST, not over this socket: the `message:send` ack is
 * `{ok:true}` with no message body (findings §1.4), so a socket send can never be matched
 * back to its optimistic placeholder. The socket exists purely to receive.
 *
 * Nothing is replayed after a drop (findings §1.6), so `reconnectNonce` drives a REST
 * re-sync on every reconnect. Without it, messages sent while the socket was down are
 * lost from the UI until a manual refresh.
 */
export function SocketProvider({
  token,
  children,
}: {
  token: string | null;
  children: React.ReactNode;
}) {
  const [socketState, setSocketState] = useState<ConnectionState>('connecting');
  // Derived, not stored: with no token there is nothing to connect, and writing that
  // into state from an effect would just be a render the compiler rightly objects to.
  // Providers remounts this component when the token changes, so state starts fresh.
  const connection: ConnectionState = token ? socketState : 'disconnected';
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const messageHandlers = useRef(new Set<(m: Message) => void>());
  const conversationHandlers = useRef(new Set<(c: Conversation) => void>());
  const hasConnectedOnce = useRef(false);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(SOCKET_ORIGIN, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on('connect', () => {
      setSocketState('connected');
      // Only a *re*connect needs a history re-sync; the first connect is covered by the
      // initial fetch the thread already performs.
      if (hasConnectedOnce.current) setReconnectNonce((n) => n + 1);
      hasConnectedOnce.current = true;
    });

    socket.on('disconnect', () => setSocketState('disconnected'));

    socket.on('connect_error', (err: Error) => {
      // The handshake rejects a bad token explicitly rather than half-connecting.
      const unauthorised = /token/i.test(err.message);
      setSocketState(unauthorised ? 'unauthorised' : 'disconnected');
    });

    socket.on('message:new', (raw: unknown) => {
      const parsed = socketMessageSchema.safeParse(raw);
      if (!parsed.success) return; // Malformed push: drop it; REST re-sync is the backstop.
      for (const fn of messageHandlers.current) fn(parsed.data);
    });

    socket.on('conversation:updated', (raw: unknown) => {
      const parsed = groupSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const fn of conversationHandlers.current) fn(parsed.data);
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [token]);

  const value = useMemo<SocketContextValue>(
    () => ({
      connection,
      reconnectNonce,
      onMessage: (fn) => {
        messageHandlers.current.add(fn);
        return () => void messageHandlers.current.delete(fn);
      },
      onConversationUpdated: (fn) => {
        conversationHandlers.current.add(fn);
        return () => void conversationHandlers.current.delete(fn);
      },
    }),
    [connection, reconnectNonce],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}
