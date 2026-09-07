// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { describe, expect, it } from 'vitest';
import { restMessageSchema, socketMessageSchema, conversationListSchema } from './schemas';
import { isObjectId } from './utils';

/*
 * The normalisation boundary.
 *
 * The project's rule is that nothing outside `lib/api` and `lib/schemas` ever sees `_id`,
 * an ISO date string, or a `{ data }` wrapper. These tests are what makes that a rule
 * rather than an aspiration: the same message arrives over REST and over the socket in two
 * different shapes (findings §1.2), and both have to come out as one domain type.
 */

const OID = '6a9e904adb386e2dcaba4306';
const CONV = '6a9e905bdb386e2dcaba4356';
const USER = '6a9e838cdb386e2dcaba3ac6';

describe('the two message wire shapes normalise to one domain type', () => {
  it('parses the REST shape: _id, ISO createdAt', () => {
    const m = restMessageSchema.parse({
      _id: OID,
      conversation: CONV,
      sender: USER,
      text: 'over rest',
      createdAt: '2026-09-07T10:15:30.000Z',
    });
    expect(m).toEqual({
      id: OID,
      conversationId: CONV,
      senderId: USER,
      text: 'over rest',
      createdAt: Date.parse('2026-09-07T10:15:30.000Z'),
      status: 'sent',
    });
  });

  it('parses the socket shape: id, epoch createdAt', () => {
    const m = socketMessageSchema.parse({
      id: OID,
      conversation: CONV,
      sender: USER,
      text: 'over socket',
      createdAt: 1788770130000,
    });
    expect(m.id).toBe(OID);
    expect(m.conversationId).toBe(CONV);
    expect(m.createdAt).toBe(1788770130000);
    expect(m.status).toBe('sent');
  });

  it('produces byte-identical output for the same message on either transport', () => {
    // This is the property that lets the store key by id and not care where a message
    // came from. If it ever stops holding, the same message renders twice.
    const at = '2026-09-07T10:15:30.000Z';
    const viaRest = restMessageSchema.parse({
      _id: OID, conversation: CONV, sender: USER, text: 'same', createdAt: at,
    });
    const viaSocket = socketMessageSchema.parse({
      id: OID, conversation: CONV, sender: USER, text: 'same', createdAt: Date.parse(at),
    });
    expect(viaRest).toEqual(viaSocket);
  });

  it('gives absent text a real empty string, never undefined', () => {
    // The server accepts and stores messages with no text at all (findings §4.6), and a
    // bubble rendering `undefined` is worse than one rendering nothing.
    const m = restMessageSchema.parse({
      _id: OID, conversation: CONV, sender: USER, createdAt: '2026-09-07T10:15:30.000Z',
    });
    expect(m.text).toBe('');
  });

  it('treats ids as opaque strings here, and enforces their shape at the URL boundary', () => {
    /*
     * Worth pinning down, because the obvious assumption is the opposite. `objectId` is
     * `z.string().min(1)`: the parser accepts whatever the server calls an id rather than
     * second-guessing it, so a server-side id-format change cannot make the client reject
     * otherwise valid data. The 500-on-malformed-id problem (findings §3.2) is a problem
     * about what we *send*, so the guard lives where a URL is built — `isObjectId`, in
     * lib/utils, covered in its own suite.
     */
    const m = restMessageSchema.parse({
      _id: 'not-an-objectid', conversation: CONV, sender: USER, createdAt: 0,
    });
    expect(m.id).toBe('not-an-objectid');
    expect(isObjectId(m.id)).toBe(false);
  });

  it('still rejects an empty id, which could never be a real entity', () => {
    expect(() =>
      restMessageSchema.parse({ _id: '', conversation: CONV, sender: USER, createdAt: 0 }),
    ).toThrow();
  });

  it('never leaks a wire field into the domain object', () => {
    const m = restMessageSchema.parse({
      _id: OID, conversation: CONV, sender: USER, text: 'x', createdAt: 0,
    });
    expect(m).not.toHaveProperty('_id');
    expect(m).not.toHaveProperty('conversation');
    expect(m).not.toHaveProperty('sender');
  });
});

describe('conversationListSchema', () => {
  const direct = {
    _id: CONV,
    type: 'direct' as const,
    participant: { _id: USER, name: 'Sam Mercer', phone: '8801711002200' },
    updatedAt: '2026-09-07T10:15:30.000Z',
  };

  it('unwraps the { data } envelope used by this one endpoint', () => {
    // Four different envelope conventions are in use across the API; the wrapper stops at
    // this boundary so nothing downstream has to know which one it was.
    const parsed = conversationListSchema.parse({ data: [direct] });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]?.id).toBe(CONV);
  });

  it('renames participant to peer so a direct exposes the other person, not a wire field', () => {
    const [c] = conversationListSchema.parse({ data: [direct] }).data;
    expect(c?.type).toBe('direct');
    if (c?.type === 'direct') expect(c.peer.id).toBe(USER);
    expect(c).not.toHaveProperty('participant');
  });

  it('collapses lastMessage: {} to null', () => {
    /*
     * The endpoint returns `{}` rather than `null` for an empty conversation
     * (findings §4.4), which makes the obvious truthiness guard always pass and renders a
     * blank preview row. This is the guard against that.
     */
    const parsed = conversationListSchema.parse({ data: [{ ...direct, lastMessage: {} }] });
    expect(parsed.data[0]?.lastMessage).toBeNull();
  });

  it('keeps a real lastMessage', () => {
    const parsed = conversationListSchema.parse({
      data: [{
        ...direct,
        lastMessage: { text: 'hello', sender: USER, createdAt: '2026-09-07T10:15:30.000Z' },
      }],
    });
    expect(parsed.data[0]?.lastMessage?.text).toBe('hello');
    expect(parsed.data[0]?.lastMessage?.senderId).toBe(USER);
  });

  it('reads both shapes in one list and renames admins to adminIds', () => {
    const group = {
      _id: '6a9e905bdb386e2dcaba9999',
      type: 'group' as const,
      name: 'Recon Squad',
      createdBy: USER,
      admins: [USER],
      participants: [{ _id: USER, name: 'Sam Mercer', phone: '8801711002200' }],
      createdAt: '2026-09-07T10:15:30.000Z',
    };
    const { data } = conversationListSchema.parse({ data: [direct, group] });
    expect(data.map((c) => c.type)).toEqual(['direct', 'group']);
    const g = data[1];
    if (g?.type === 'group') {
      expect(g.adminIds).toEqual([USER]);
      expect(g).not.toHaveProperty('admins');
    }
  });

  it('falls back to createdAt when a group omits updatedAt', () => {
    // Groups come back without updatedAt on some paths, and the list sorts by recency —
    // an undefined there sends a brand-new group to the bottom.
    const { data } = conversationListSchema.parse({
      data: [{
        _id: '6a9e905bdb386e2dcaba9999',
        type: 'group',
        name: 'Recon Squad',
        createdBy: USER,
        admins: [],
        participants: [],
        createdAt: '2026-09-07T10:15:30.000Z',
      }],
    });
    expect(data[0]?.updatedAt).toBe(Date.parse('2026-09-07T10:15:30.000Z'));
  });
});
