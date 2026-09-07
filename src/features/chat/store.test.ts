// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '@/lib/domain';
import { emptyThread, newTempId, orderedMessages, useChatStore } from './store';

/*
 * The reconciliation layer, which is where this app is either correct or not.
 *
 * Every case below corresponds to something the API actually does — an inclusive cursor,
 * no echo of your own sends, a non-idempotent POST — rather than to a hypothetical. The
 * findings references point at docs/api-findings.md.
 */

const CID = '6a9e905bdb386e2dcaba4356';
const ME = '6a9e838cdb386e2dcaba3ac6';

function serverMessage(id: string, createdAt: number, text = 'hi'): Message {
  return { id, conversationId: CID, senderId: ME, text, createdAt, status: 'sent' };
}

function resetStore() {
  useChatStore.setState({ threads: {}, outbox: [], hydrated: false });
}

describe('ingestPage — merging by message id', () => {
  beforeEach(resetStore);

  it('collapses the message a page boundary repeats', () => {
    /*
     * `before` is inclusive (findings §1.1), so every "load older" page opens with the
     * message the previous page ended on. Keying the thread by id is what makes that
     * repeat vanish; an array plus concat would render it twice at every boundary.
     */
    const newest = [serverMessage('c', 300), serverMessage('b', 200)];
    useChatStore.getState().ingestPage(CID, newest, true, 'initial');

    const older = [serverMessage('b', 200), serverMessage('a', 100)]; // 'b' is the seam
    useChatStore.getState().ingestPage(CID, older, false, 'older');

    const thread = useChatStore.getState().getThread(CID);
    const ids = orderedMessages(thread).map((m) => m.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(ids.filter((id) => id === 'b')).toHaveLength(1);
  });

  it('is order-independent, so a page arriving out of sequence is still correct', () => {
    useChatStore.getState().ingestPage(CID, [serverMessage('a', 100)], false, 'initial');
    useChatStore.getState().ingestPage(CID, [serverMessage('c', 300), serverMessage('b', 200)], false, 'sync');
    expect(orderedMessages(useChatStore.getState().getThread(CID)).map((m) => m.id))
      .toEqual(['a', 'b', 'c']);
  });

  it('lets a later copy of a message win, so an edited or corrected body lands', () => {
    useChatStore.getState().ingestPage(CID, [serverMessage('a', 100, 'first')], false, 'initial');
    useChatStore.getState().ingestPage(CID, [serverMessage('a', 100, 'corrected')], false, 'sync');
    const [only] = orderedMessages(useChatStore.getState().getThread(CID));
    expect(only?.text).toBe('corrected');
  });

  it('only lets a "load older" page prove there is nothing older', () => {
    // A sync or initial fetch of the newest page says nothing about the tail, so it must
    // not be allowed to clear hasMore and disable pagination.
    useChatStore.getState().ingestPage(CID, [serverMessage('c', 300)], true, 'initial');
    useChatStore.getState().ingestPage(CID, [serverMessage('c', 300)], false, 'sync');
    expect(useChatStore.getState().getThread(CID).hasMore).toBe(true);

    useChatStore.getState().ingestPage(CID, [serverMessage('a', 100)], false, 'older');
    expect(useChatStore.getState().getThread(CID).hasMore).toBe(false);
  });

  it('tracks the oldest server id as the next cursor, ignoring pending entries', () => {
    useChatStore.getState().ingestPage(CID, [serverMessage('b', 200), serverMessage('a', 100)], true, 'initial');
    useChatStore.getState().enqueue({
      tempId: newTempId(), conversationId: CID, text: 'queued', createdAt: 50, senderId: ME,
    });
    // The optimistic entry is older by clock but has no server id, so it cannot be a cursor.
    expect(useChatStore.getState().getThread(CID).oldestServerId).toBe('a');
  });
});

describe('orderedMessages', () => {
  it('pins pending messages last regardless of their clock', () => {
    /*
     * An optimistic entry is stamped with the *client* clock; the server's may differ by
     * a second or more. Sorting purely by time makes a message visibly jump backwards the
     * moment it sends, which reads as a bug.
     */
    const thread = {
      ...emptyThread(),
      messages: {
        pending: { ...serverMessage('pending', 100), status: 'queued' as const },
        settled: serverMessage('settled', 900),
      },
    };
    expect(orderedMessages(thread).map((m) => m.id)).toEqual(['settled', 'pending']);
  });

  it('breaks a same-millisecond tie by id, which recovers insertion order', () => {
    // ObjectIds carry a creation timestamp in their leading bytes, so lexicographic order
    // on the hex string is the server's own order — not an arbitrary choice.
    const a = '6a9e904adb386e2dcaba4306';
    const b = '6a9e904bdb386e2dcaba4309';
    const thread = {
      ...emptyThread(),
      messages: { [b]: serverMessage(b, 500), [a]: serverMessage(a, 500) },
    };
    expect(orderedMessages(thread).map((m) => m.id)).toEqual([a, b]);
  });

  it('is a total order, so two renders never disagree', () => {
    const thread = {
      ...emptyThread(),
      messages: {
        x: serverMessage('x', 500),
        y: serverMessage('y', 500),
        z: serverMessage('z', 100),
      },
    };
    const once = orderedMessages(thread).map((m) => m.id);
    const twice = orderedMessages(thread).map((m) => m.id);
    expect(once).toEqual(twice);
  });
});

describe('the outbox', () => {
  beforeEach(resetStore);

  it('preserves send order, because the flush transmits in queue order', () => {
    const ids = ['t1', 't2', 't3'];
    for (const [i, tempId] of ids.entries()) {
      useChatStore.getState().enqueue({
        tempId, conversationId: CID, text: `m${i}`, createdAt: 1000 + i, senderId: ME,
      });
    }
    expect(useChatStore.getState().outbox.map((e) => e.tempId)).toEqual(ids);
  });

  it('shows a queued message in the thread immediately', () => {
    useChatStore.getState().enqueue({
      tempId: 't1', conversationId: CID, text: 'offline', createdAt: 1000, senderId: ME,
    });
    const [msg] = orderedMessages(useChatStore.getState().getThread(CID));
    expect(msg?.status).toBe('queued');
    expect(msg?.text).toBe('offline');
  });

  it('replaces the placeholder with the server copy rather than showing both', () => {
    /*
     * The sender gets no socket echo of their own message (findings §1.3), so the REST
     * response is the only copy that ever arrives. Leaving the placeholder behind would
     * duplicate every message you send.
     */
    useChatStore.getState().enqueue({
      tempId: 't1', conversationId: CID, text: 'hello', createdAt: 1000, senderId: ME,
    });
    useChatStore.getState().markSending('t1');
    useChatStore.getState().resolveSent('t1', serverMessage('6a9e904adb386e2dcaba4306', 1001, 'hello'));

    const msgs = orderedMessages(useChatStore.getState().getThread(CID));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.id).toBe('6a9e904adb386e2dcaba4306');
    expect(msgs[0]?.status).toBe('sent');
    expect(msgs[0]?.tempId).toBe('t1'); // kept, so a retry stays idempotent
    expect(useChatStore.getState().outbox).toHaveLength(0);
  });

  it('counts attempts when a send is retried', () => {
    useChatStore.getState().enqueue({
      tempId: 't1', conversationId: CID, text: 'x', createdAt: 1000, senderId: ME,
    });
    useChatStore.getState().markSending('t1');
    useChatStore.getState().markQueued('t1');
    useChatStore.getState().markSending('t1');
    expect(useChatStore.getState().outbox[0]?.attempts).toBe(2);
  });

  it('keeps a failed message visible and retryable instead of dropping it', () => {
    useChatStore.getState().enqueue({
      tempId: 't1', conversationId: CID, text: 'x', createdAt: 1000, senderId: ME,
    });
    useChatStore.getState().markFailed('t1');
    const [msg] = orderedMessages(useChatStore.getState().getThread(CID));
    expect(msg?.status).toBe('failed');
    expect(useChatStore.getState().outbox).toHaveLength(1);
  });

  it('discard removes the placeholder and its queue entry together', () => {
    useChatStore.getState().enqueue({
      tempId: 't1', conversationId: CID, text: 'x', createdAt: 1000, senderId: ME,
    });
    useChatStore.getState().discard(CID, 't1');
    expect(orderedMessages(useChatStore.getState().getThread(CID))).toHaveLength(0);
    expect(useChatStore.getState().outbox).toHaveLength(0);
  });
});

describe('newTempId', () => {
  it('is distinguishable from a server ObjectId', () => {
    // The whole pending/settled split keys off this prefix.
    expect(newTempId().startsWith('tmp_')).toBe(true);
    expect(newTempId()).not.toMatch(/^[a-f0-9]{24}$/i);
  });

  it('does not collide across a rapid burst', () => {
    const ids = new Set(Array.from({ length: 1000 }, newTempId));
    expect(ids.size).toBe(1000);
  });
});
