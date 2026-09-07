// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { z } from 'zod';
import { request } from './client';
import {
  conversationListSchema,
  createdDirectSchema,
  groupSchema,
  loginSchema,
  meSchema,
  messagePageSchema,
  restMessageSchema,
  userSearchSchema,
} from '../schemas';
import type { Conversation, GroupConversation, Message, UserRef } from '../domain';
import { escapeRegex, isObjectId } from '../utils';
import { ApiError } from './errors';

// --- Auth -------------------------------------------------------------------

export function login(phone: string, name: string) {
  return request('/auth/login', {
    method: 'POST',
    body: { phone, name },
    schema: loginSchema,
    retry: false,
  });
}

export function me(signal?: AbortSignal): Promise<UserRef> {
  return request('/auth/me', { schema: meSchema, signal });
}

// --- Users ------------------------------------------------------------------

/**
 * Search users.
 *
 * The endpoint's real matching rules, established by probing it (findings §2):
 *
 *  - **Name** is matched by a case-sensitive regex anchored at a word start. `Hossain`
 *    finds "Imran Hossain", but `hossain` and `mran` find nothing.
 *  - **Phone** is matched by *exact equality*, not prefix and not substring.
 *  - `q` is interpolated into that regex unescaped, so any `+` returns a 500.
 *
 * Those last two interact badly: a raw `+8801…` crashes the endpoint, and an escaped
 * `\+8801…` no longer equals the stored phone, so the exact match fails too. E.164
 * numbers are therefore unsearchable through this API and no client can fix that.
 *
 * What we can do is send several safe variants and merge the results:
 *  1. the raw query when it holds no regex metacharacters — lets exact phone match work
 *     for numbers stored without a `+`;
 *  2. an escaped copy — keeps name search working without ever triggering the 500;
 *  3. for `+`-prefixed input, the digits alone — matches numbers stored without a `+`.
 *
 * Callers must not pass fewer than 2 characters: an empty `q` returns the whole directory.
 */
export async function searchUsers(query: string, signal?: AbortSignal): Promise<UserRef[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const escaped = escapeRegex(trimmed);
  const variants = new Set<string>([escaped]);
  // Only safe to send unescaped when there is nothing for the regex to choke on.
  if (escaped === trimmed) variants.add(trimmed);
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1);
    if (escapeRegex(digits) === digits) variants.add(digits);
  }

  const results = await Promise.all(
    [...variants].map((v) =>
      request(`/users/search?q=${encodeURIComponent(v)}`, {
        schema: userSearchSchema,
        signal,
      }).catch((err: unknown) => {
        // One variant failing must not discard another's results.
        if (err instanceof ApiError && !err.isAuthFailure) return [] as UserRef[];
        throw err;
      }),
    ),
  );

  const byId = new Map<string, UserRef>();
  for (const list of results) for (const u of list) byId.set(u.id, u);
  return [...byId.values()];
}

// --- Conversations ----------------------------------------------------------

export async function listConversations(signal?: AbortSignal): Promise<Conversation[]> {
  const { data } = await request('/conversations', {
    schema: conversationListSchema,
    signal,
  });
  return data;
}

/**
 * Start a direct conversation, or return the existing one.
 *
 * The endpoint is idempotent for an existing pair, so this doubles as "find". Passing
 * your own id returns an unrelated conversation you happen to be in (findings §4.3),
 * so that case is refused here rather than relying on callers to remember.
 */
export async function startDirectConversation(userId: string): Promise<string> {
  if (!isObjectId(userId)) {
    throw new ApiError({ kind: 'validation', message: 'Invalid user id' });
  }
  const created = await request('/conversations', {
    method: 'POST',
    body: { userId },
    schema: createdDirectSchema,
    retry: false,
  });
  return created._id;
}

export type MessagePage = { messages: Message[]; hasMore: boolean };

/**
 * A page of history, newest-first as the API returns it.
 *
 * `before` is INCLUSIVE (findings §1.1): the cursor message comes back as the first item
 * of the next page. Callers merge by id, so the repeat collapses instead of rendering
 * twice — see the message store.
 */
export function fetchMessages(
  conversationId: string,
  opts: { limit?: number; before?: string; signal?: AbortSignal } = {},
): Promise<MessagePage> {
  if (!isObjectId(conversationId)) {
    // A malformed id would produce a 500 with a leaked driver message (findings §3.2).
    throw new ApiError({ kind: 'not_found', message: 'Invalid conversation id' });
  }
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 25));
  if (opts.before) params.set('before', opts.before);

  return request(`/conversations/${conversationId}/messages?${params}`, {
    schema: messagePageSchema,
    signal: opts.signal,
  });
}

/**
 * Send a message over REST.
 *
 * Deliberately REST and not the socket: the socket's `message:send` ack is `{ok:true}`
 * with no message body (findings §1.4), so a socket-sent message can never be reconciled
 * with its optimistic placeholder. REST returns the created entity with its real id.
 *
 * Never retried — a retry after an ambiguous failure would duplicate the message.
 */
export function sendMessage(conversationId: string, text: string): Promise<Message> {
  return request('/messages', {
    method: 'POST',
    body: { conversationId, text },
    schema: restMessageSchema,
    retry: false,
  });
}

// --- Groups -----------------------------------------------------------------

export function createGroup(name: string, participantIds: string[]): Promise<GroupConversation> {
  return request('/conversations/group', {
    method: 'POST',
    body: { name, participantIds },
    schema: groupSchema,
    retry: false,
  });
}

export function renameGroup(id: string, name: string): Promise<GroupConversation> {
  return request(`/conversations/${id}`, {
    method: 'PATCH',
    body: { name },
    schema: groupSchema,
    retry: false,
  });
}

export function addParticipants(id: string, userIds: string[]): Promise<GroupConversation> {
  return request(`/conversations/${id}/participants`, {
    method: 'POST',
    body: { userIds },
    schema: groupSchema,
    retry: false,
  });
}

export function removeParticipant(id: string, userId: string): Promise<GroupConversation> {
  return request(`/conversations/${id}/participants/${userId}`, {
    method: 'DELETE',
    schema: groupSchema,
    retry: false,
  });
}

export function promoteToAdmin(id: string, userId: string): Promise<GroupConversation> {
  return request(`/conversations/${id}/admins`, {
    method: 'POST',
    body: { userId },
    schema: groupSchema,
    retry: false,
  });
}

export const healthSchema = z.object({ status: z.string() });
