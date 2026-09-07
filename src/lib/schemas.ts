// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { z } from 'zod';
import type {
  Conversation,
  GroupConversation,
  LastMessage,
  Message,
  UserRef,
} from './domain';

/**
 * The API boundary.
 *
 * Every byte from the network is parsed here and converted into a domain type. Two rules
 * hold above this file: nothing sees `_id`, and nothing sees an ISO date string.
 *
 * This is not defensive decoration. The API genuinely returns the same message entity in
 * two different shapes depending on transport (findings §1.2), and returns `200` with a
 * `null` body for a write that failed (findings §1.5) — so a schema failure is a real
 * runtime signal, not a theoretical one.
 */

/** REST sends ISO-8601; the socket sends epoch milliseconds. Both land as a number. */
const timestamp = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: 'custom', message: `Unparseable timestamp: ${String(v)}` });
    return z.NEVER;
  }
  return ms;
});

const objectId = z.string().min(1);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const userRefSchema = z
  .object({ _id: objectId, name: z.string(), phone: z.string() })
  .transform((u): UserRef => ({ id: u._id, name: u.name, phone: u.phone }));

export const meSchema = z
  .object({
    _id: objectId,
    name: z.string(),
    phone: z.string(),
    createdAt: timestamp.optional(),
  })
  .transform((u): UserRef => ({ id: u._id, name: u.name, phone: u.phone }));

export const loginSchema = z.object({
  token: z.string().min(1),
  user: meSchema,
});

export const userSearchSchema = z.array(userRefSchema);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** REST shape: `_id`, ISO `createdAt`. */
export const restMessageSchema = z
  .object({
    _id: objectId,
    conversation: objectId,
    sender: objectId,
    // The server accepts and stores messages with no text at all (findings §4.6).
    text: z.string().optional(),
    createdAt: timestamp,
  })
  .transform(
    (m): Message => ({
      id: m._id,
      conversationId: m.conversation,
      senderId: m.sender,
      text: m.text ?? '',
      createdAt: m.createdAt,
      status: 'sent',
    }),
  );

/** Socket shape: `id` (not `_id`), epoch-number `createdAt`, `text` may be absent. */
export const socketMessageSchema = z
  .object({
    id: objectId,
    conversation: objectId,
    sender: objectId,
    text: z.string().optional(),
    createdAt: timestamp,
  })
  .transform(
    (m): Message => ({
      id: m.id,
      conversationId: m.conversation,
      senderId: m.sender,
      text: m.text ?? '',
      createdAt: m.createdAt,
      status: 'sent',
    }),
  );

export const messagePageSchema = z.object({
  messages: z.array(restMessageSchema),
  hasMore: z.boolean(),
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * `lastMessage` is `{}` rather than `null` when a conversation is empty (findings §4.4),
 * which makes the obvious truthiness guard always pass. Collapse it to `null` here.
 */
const lastMessageSchema = z
  .object({
    text: z.string().optional(),
    sender: objectId.optional(),
    createdAt: timestamp.optional(),
  })
  .transform((m): LastMessage | null =>
    m.sender && m.createdAt !== undefined
      ? { text: m.text ?? '', senderId: m.sender, createdAt: m.createdAt }
      : null,
  );

const directListItemSchema = z
  .object({
    _id: objectId,
    type: z.literal('direct'),
    participant: userRefSchema,
    lastMessage: lastMessageSchema.optional(),
    updatedAt: timestamp,
  })
  .transform(
    (c): Conversation => ({
      id: c._id,
      type: 'direct',
      peer: c.participant,
      lastMessage: c.lastMessage ?? null,
      updatedAt: c.updatedAt,
    }),
  );

const groupShape = {
  _id: objectId,
  type: z.literal('group'),
  name: z.string(),
  createdBy: objectId,
  admins: z.array(objectId),
  participants: z.array(userRefSchema),
  lastMessage: lastMessageSchema.optional(),
  updatedAt: timestamp.optional(),
  createdAt: timestamp.optional(),
};

const groupListItemSchema = z.object(groupShape).transform(
  (c): GroupConversation => ({
    id: c._id,
    type: 'group',
    name: c.name,
    createdBy: c.createdBy,
    adminIds: c.admins,
    participants: c.participants,
    lastMessage: c.lastMessage ?? null,
    updatedAt: c.updatedAt ?? c.createdAt ?? Date.now(),
  }),
);

/** Returned by every group write, and by the `conversation:updated` socket event. */
export const groupSchema = groupListItemSchema;

export const conversationListSchema = z.object({
  data: z.array(z.union([directListItemSchema, groupListItemSchema])),
});

/**
 * `POST /conversations` returns a third participants representation — bare id strings,
 * with no `type` field (findings §4.2). We only need the id, because the caller
 * immediately refetches the list to get the fully-populated row.
 */
export const createdDirectSchema = z.object({
  _id: objectId,
  participants: z.array(objectId),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * `code` is normally a string, but MongoDB-level failures surface a *number*
 * (findings §3.3), so accept both and stringify.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.union([z.string(), z.number()]).optional(),
    details: z
      .array(z.object({ path: z.string().optional(), message: z.string() }))
      .optional(),
  }),
});

/** Socket ack: a third error shape again — a plain string under `error`. */
export const socketAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
