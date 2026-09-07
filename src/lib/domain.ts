// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

/**
 * The application's internal vocabulary.
 *
 * Nothing in here mirrors the wire format. The live API returns `_id` over REST and `id`
 * over the socket, ISO-8601 strings in one place and epoch milliseconds in another, and
 * three different shapes for "the people in this conversation" (see docs/api-findings.md
 * §1.2 and §4.2). All of that is reconciled in schemas.ts; above that boundary there is
 * exactly one shape for each concept.
 */

export type UserRef = {
  id: string;
  name: string;
  phone: string;
};

export type MessageStatus = 'sent' | 'sending' | 'failed' | 'queued';

export type Message = {
  /** Server id once acknowledged; the client `tempId` while still pending. */
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  /** Epoch milliseconds. Normalised from ISO (REST) or epoch (socket). */
  createdAt: number;
  status: MessageStatus;
  /**
   * Stable client-side identity, kept after reconciliation so an optimistic entry can be
   * matched to its server message and so retries stay idempotent.
   */
  tempId?: string;
};

export type LastMessage = {
  text: string;
  senderId: string;
  createdAt: number;
};

type ConversationBase = {
  id: string;
  /** `null`, never `{}` — the API returns an empty object here (findings §4.4). */
  lastMessage: LastMessage | null;
  updatedAt: number;
};

export type DirectConversation = ConversationBase & {
  type: 'direct';
  /** The *other* participant. The API calls this singular `participant`. */
  peer: UserRef;
};

export type GroupConversation = ConversationBase & {
  type: 'group';
  name: string;
  createdBy: string;
  adminIds: string[];
  participants: UserRef[];
};

export type Conversation = DirectConversation | GroupConversation;

export function isGroup(c: Conversation): c is GroupConversation {
  return c.type === 'group';
}

export function conversationTitle(c: Conversation): string {
  return c.type === 'group' ? c.name : c.peer.name;
}

export function isAdmin(c: Conversation, userId: string): boolean {
  return c.type === 'group' && c.adminIds.includes(userId);
}

/**
 * Resolve a sender id to a display name.
 *
 * `sender` is never populated by the API, so names come from the conversation's
 * participant list. A member who has since left is no longer in that list, which is why
 * this returns a placeholder rather than an empty string (findings §4.5).
 */
export function senderName(c: Conversation | undefined, senderId: string, selfId: string): string {
  if (senderId === selfId) return 'You';
  if (!c) return 'Unknown';
  if (c.type === 'direct') return c.peer.id === senderId ? c.peer.name : 'Unknown';
  return c.participants.find((p) => p.id === senderId)?.name ?? 'Former member';
}
