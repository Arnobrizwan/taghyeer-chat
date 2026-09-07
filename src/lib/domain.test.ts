// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { describe, expect, it } from 'vitest';
import {
  conversationAvatarId,
  conversationTitle,
  isAdmin,
  isGroup,
  senderName,
  type Conversation,
  type UserRef,
} from './domain';

const ME: UserRef = { id: '6a9e838cdb386e2dcaba3ac6', name: 'Nadia Rahman', phone: '8801799123456' };
const SAM: UserRef = { id: '6a9e904adb386e2dcaba4306', name: 'Sam Mercer', phone: '8801711002200' };
const GRACE: UserRef = { id: '6a9e904bdb386e2dcaba4309', name: 'Grace Hopper', phone: '8801711003300' };

const direct: Conversation = {
  id: '6a9e904ddb386e2dcaba4314',
  type: 'direct',
  peer: SAM,
  lastMessage: null,
  updatedAt: 1_700_000_000_000,
};

const group: Conversation = {
  id: '6a9e905bdb386e2dcaba4356',
  type: 'group',
  name: 'Recon Squad',
  createdBy: ME.id,
  adminIds: [ME.id],
  participants: [ME, SAM, GRACE],
  lastMessage: null,
  updatedAt: 1_700_000_000_000,
};

describe('conversationAvatarId', () => {
  /*
   * The regression guard for a bug that shipped: three call sites passed `conversation.id`
   * for a direct, so the same person was one colour in the sidebar and another in the
   * thread header — breaking the contract `Avatar` states in its own docblock.
   */
  it('keys a direct by the other person, not the conversation', () => {
    expect(conversationAvatarId(direct)).toBe(SAM.id);
    expect(conversationAvatarId(direct)).not.toBe(direct.id);
  });

  it('keys a group by the conversation, because a group is not a person', () => {
    expect(conversationAvatarId(group)).toBe(group.id);
  });

  it('gives the same answer wherever it is called, which is the entire point', () => {
    expect(conversationAvatarId(direct)).toBe(conversationAvatarId({ ...direct }));
  });
});

describe('conversationTitle', () => {
  it('titles a direct with the peer and a group with its name', () => {
    expect(conversationTitle(direct)).toBe('Sam Mercer');
    expect(conversationTitle(group)).toBe('Recon Squad');
  });
});

describe('isGroup / isAdmin', () => {
  it('narrows the union', () => {
    expect(isGroup(group)).toBe(true);
    expect(isGroup(direct)).toBe(false);
  });

  it('reports admin only for a group member who is one', () => {
    expect(isAdmin(group, ME.id)).toBe(true);
    expect(isAdmin(group, SAM.id)).toBe(false);
  });

  it('is never true for a direct, so no admin control can render on one', () => {
    expect(isAdmin(direct, ME.id)).toBe(false);
  });
});

describe('senderName', () => {
  it('calls your own messages You', () => {
    expect(senderName(group, ME.id, ME.id)).toBe('You');
  });

  it('names a current group member', () => {
    expect(senderName(group, GRACE.id, ME.id)).toBe('Grace Hopper');
  });

  it('says Former member for someone who has left, rather than blank', () => {
    // History outlives membership: messages from a removed member stay in the thread and
    // must still be attributed to somebody.
    expect(senderName(group, '6a9e904bdb386e2dcaba430c', ME.id)).toBe('Former member');
  });

  it('names the peer in a direct and falls back otherwise', () => {
    expect(senderName(direct, SAM.id, ME.id)).toBe('Sam Mercer');
    expect(senderName(direct, GRACE.id, ME.id)).toBe('Unknown');
  });

  it('degrades to Unknown when the conversation has not loaded yet', () => {
    expect(senderName(undefined, SAM.id, ME.id)).toBe('Unknown');
  });
});
