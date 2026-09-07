'use client';

import { create } from 'zustand';
import type { Message } from '@/lib/domain';

/**
 * The message timeline.
 *
 * This is deliberately not a request cache. Three independent writers feed it — REST
 * history pages, socket pushes, and the local outbox — and they can deliver the same
 * message more than once. In particular the API's `before` cursor is INCLUSIVE, so every
 * pagination boundary re-serves one message (findings §1.1).
 *
 * Keying by id makes all of that idempotent: a duplicate is an overwrite, not a second
 * row. That single property is why this is a keyed store and not an array.
 */

export type Thread = {
  messages: Record<string, Message>;
  hasMore: boolean;
  /** Cursor for the next "load older" call — the oldest server id we hold. */
  oldestServerId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingOlder: boolean;
  error: string | null;
};

export type OutboxEntry = {
  tempId: string;
  conversationId: string;
  text: string;
  createdAt: number;
  senderId: string;
  attempts: number;
};

type ChatState = {
  threads: Record<string, Thread>;
  /** FIFO of tempIds awaiting delivery. Order is the send order, and is preserved. */
  outbox: OutboxEntry[];
  hydrated: boolean;

  getThread: (conversationId: string) => Thread;
  setThreadStatus: (conversationId: string, status: Thread['status'], error?: string | null) => void;
  setLoadingOlder: (conversationId: string, loading: boolean) => void;
  ingestPage: (
    conversationId: string,
    messages: Message[],
    hasMore: boolean,
    mode: 'initial' | 'older' | 'sync',
  ) => void;
  ingestMessage: (message: Message) => void;

  enqueue: (entry: Omit<OutboxEntry, 'attempts'>) => void;
  markSending: (tempId: string) => void;
  markQueued: (tempId: string) => void;
  markFailed: (tempId: string) => void;
  resolveSent: (tempId: string, serverMessage: Message) => void;
  dequeue: (tempId: string) => void;
  discard: (conversationId: string, tempId: string) => void;
  hydrate: () => void;
};

const OUTBOX_KEY = 'taghyeer-chat:outbox:v1';

export const emptyThread = (): Thread => ({
  messages: {},
  hasMore: false,
  oldestServerId: null,
  status: 'idle',
  loadingOlder: false,
  error: null,
});

/** Pending entries carry a client-generated id, distinguishable from a 24-hex ObjectId. */
const isPendingId = (id: string) => id.startsWith('tmp_');

function oldestIdOf(messages: Record<string, Message>): string | null {
  let oldest: Message | null = null;
  for (const m of Object.values(messages)) {
    if (isPendingId(m.id)) continue;
    if (!oldest || m.createdAt < oldest.createdAt) oldest = m;
  }
  return oldest?.id ?? null;
}

function persistOutbox(outbox: OutboxEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // Quota or private mode — the outbox degrades to in-memory only.
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  threads: {},
  outbox: [],
  hydrated: false,

  getThread: (conversationId) => get().threads[conversationId] ?? emptyThread(),

  setThreadStatus: (conversationId, status, error = null) =>
    set((s) => {
      const thread = s.threads[conversationId] ?? emptyThread();
      return { threads: { ...s.threads, [conversationId]: { ...thread, status, error } } };
    }),

  setLoadingOlder: (conversationId, loadingOlder) =>
    set((s) => {
      const thread = s.threads[conversationId] ?? emptyThread();
      return { threads: { ...s.threads, [conversationId]: { ...thread, loadingOlder } } };
    }),

  ingestPage: (conversationId, incoming, hasMore, mode) =>
    set((s) => {
      const thread = s.threads[conversationId] ?? emptyThread();
      const messages = { ...thread.messages };
      for (const m of incoming) messages[m.id] = m;

      return {
        threads: {
          ...s.threads,
          [conversationId]: {
            ...thread,
            messages,
            // "Load older" is the only thing that can prove there is nothing older.
            // A sync or initial fetch of the newest page says nothing about the tail.
            hasMore: mode === 'older' ? hasMore : (thread.status === 'idle' ? hasMore : thread.hasMore || hasMore),
            oldestServerId: oldestIdOf(messages),
            status: 'ready',
            error: null,
            loadingOlder: false,
          },
        },
      };
    }),

  ingestMessage: (message) =>
    set((s) => {
      const thread = s.threads[message.conversationId] ?? emptyThread();
      // Never resurrect a thread we've not opened; the list preview covers that case.
      const messages = { ...thread.messages, [message.id]: message };
      return {
        threads: {
          ...s.threads,
          [message.conversationId]: {
            ...thread,
            messages,
            oldestServerId: thread.oldestServerId ?? oldestIdOf(messages),
          },
        },
      };
    }),

  enqueue: (entry) =>
    set((s) => {
      const thread = s.threads[entry.conversationId] ?? emptyThread();
      const optimistic: Message = {
        id: entry.tempId,
        tempId: entry.tempId,
        conversationId: entry.conversationId,
        senderId: entry.senderId,
        text: entry.text,
        createdAt: entry.createdAt,
        status: 'queued',
      };
      const outbox = [...s.outbox, { ...entry, attempts: 0 }];
      persistOutbox(outbox);
      return {
        outbox,
        threads: {
          ...s.threads,
          [entry.conversationId]: {
            ...thread,
            messages: { ...thread.messages, [entry.tempId]: optimistic },
          },
        },
      };
    }),

  markSending: (tempId) => set((s) => patchPending(s, tempId, 'sending', +1)),
  markQueued: (tempId) => set((s) => patchPending(s, tempId, 'queued', 0)),
  markFailed: (tempId) => set((s) => patchPending(s, tempId, 'failed', 0)),

  /**
   * Swap an optimistic entry for the canonical server message.
   *
   * The sender never receives a socket echo of their own message (findings §1.3), so
   * there is no race with an inbound copy — but keying by id means this stays correct if
   * an echo is ever added, because the insert would simply overwrite itself.
   */
  resolveSent: (tempId, serverMessage) =>
    set((s) => {
      const cid = serverMessage.conversationId;
      const thread = s.threads[cid] ?? emptyThread();
      const messages = { ...thread.messages };
      delete messages[tempId];
      messages[serverMessage.id] = { ...serverMessage, tempId, status: 'sent' };
      const outbox = s.outbox.filter((e) => e.tempId !== tempId);
      persistOutbox(outbox);
      return {
        outbox,
        threads: {
          ...s.threads,
          [cid]: { ...thread, messages, oldestServerId: thread.oldestServerId ?? serverMessage.id },
        },
      };
    }),

  dequeue: (tempId) =>
    set((s) => {
      const outbox = s.outbox.filter((e) => e.tempId !== tempId);
      persistOutbox(outbox);
      return { outbox };
    }),

  discard: (conversationId, tempId) =>
    set((s) => {
      const thread = s.threads[conversationId] ?? emptyThread();
      const messages = { ...thread.messages };
      delete messages[tempId];
      const outbox = s.outbox.filter((e) => e.tempId !== tempId);
      persistOutbox(outbox);
      return { outbox, threads: { ...s.threads, [conversationId]: { ...thread, messages } } };
    }),

  /** Restore unsent messages written by a previous session (a reload, or a crash). */
  hydrate: () => {
    if (typeof window === 'undefined' || get().hydrated) return;
    let entries: OutboxEntry[] = [];
    try {
      const raw = window.localStorage.getItem(OUTBOX_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          entries = parsed.filter(
            (e): e is OutboxEntry =>
              typeof e === 'object' && e !== null &&
              typeof (e as OutboxEntry).tempId === 'string' &&
              typeof (e as OutboxEntry).conversationId === 'string' &&
              typeof (e as OutboxEntry).text === 'string',
          );
        }
      }
    } catch {
      entries = [];
    }

    set((s) => {
      const threads = { ...s.threads };
      for (const e of entries) {
        const thread = threads[e.conversationId] ?? emptyThread();
        threads[e.conversationId] = {
          ...thread,
          messages: {
            ...thread.messages,
            [e.tempId]: {
              id: e.tempId,
              tempId: e.tempId,
              conversationId: e.conversationId,
              senderId: e.senderId,
              text: e.text,
              createdAt: e.createdAt,
              status: 'queued',
            },
          },
        };
      }
      return { outbox: entries, threads, hydrated: true };
    });
  },
}));

function patchPending(
  s: ChatState,
  tempId: string,
  status: Message['status'],
  attemptDelta: number,
): Partial<ChatState> {
  const entry = s.outbox.find((e) => e.tempId === tempId);
  if (!entry) return {};
  const thread = s.threads[entry.conversationId] ?? emptyThread();
  const existing = thread.messages[tempId];
  if (!existing) return {};

  const outbox = attemptDelta
    ? s.outbox.map((e) => (e.tempId === tempId ? { ...e, attempts: e.attempts + attemptDelta } : e))
    : s.outbox;
  if (attemptDelta) persistOutbox(outbox);

  return {
    outbox,
    threads: {
      ...s.threads,
      [entry.conversationId]: {
        ...thread,
        messages: { ...thread.messages, [tempId]: { ...existing, status } },
      },
    },
  };
}

export function newTempId(): string {
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ordered view of a thread.
 *
 * Sorted by time, but pending messages are pinned last regardless of clock: an optimistic
 * entry is stamped with the *client* clock and the server's may differ by a second or
 * more, and a message visibly jumping backwards after it sends looks broken.
 */
export function orderedMessages(thread: Thread): Message[] {
  const list = Object.values(thread.messages);
  return list.sort((a, b) => {
    const aPending = a.status !== 'sent';
    const bPending = b.status !== 'sent';
    if (aPending !== bPending) return aPending ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : 1;
  });
}
