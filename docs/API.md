# The API, as it actually behaves

**Deliverable 1.** This is the reference documentation for the chat service the app talks
to. I've written it so it makes sense whether or not you write code for a living. Where I
have to use a technical word, I explain it the first time.

An API is the service an app sends its orders to, like a kitchen. The published
documentation for this one told you where to send an order but almost nothing about what
comes back: for every single operation it says the response is "unspecified", and it lists
no status codes at all. So none of what follows was copied from a document. I called every
endpoint by hand against the live service on 7 September 2026, including deliberately wrong
calls, and wrote down exactly what came back. The raw captures are in
[`docs/recon/`](./recon) so you can check any claim here yourself.

Two companion documents: [`api-findings.md`](./api-findings.md) catalogues the faults I
found and why they matter, and [`openapi.yaml`](./openapi.yaml) is the machine-readable
version of this page. **This document is the contract** — what you can rely on. Where the
contract is surprising, it points at the finding that explains why.

- **Normal requests go to:** `https://frontend-task-chatapp.onrender.com/api`
- **The live connection goes to:** `https://frontend-task-chatapp.onrender.com` — the root
  address, *not* `/api`. This is easy to get wrong and fails silently-ish if you do.
- **Health check:** `https://frontend-task-chatapp.onrender.com/health`, also at the root.
  The published spec files it under `/api`, but `/api/health` returns "not found".

---

## The ground rules

### Proving who you are

Every call except logging in and the health check needs an `Authorization: Bearer <token>`
header. A token here is a signed string the server hands you at login that proves you are
who you say you are, so you don't send a password with every request.

The token lasts **seven days**. There is no way to refresh it and no way to revoke it. When
it expires you log in again, and that's the whole story.

### Identifiers

Every id in this API is a 24-character string of hexadecimal (the digits `0`–`9` plus the
letters `a`–`f`). If you send an id that isn't in that format, the server does **not** tell
you politely that it's wrong — it crashes with a 500 and leaks its own internal database
message. So validate ids before you put them in a URL rather than after. Details under
[When things go wrong](#when-things-go-wrong).

### There is no single response shape

This is the thing that costs a client the most work, so it's worth stating plainly up
front. Different endpoints wrap their answers differently, for no reason I could find:

| What you get back | Which endpoints do this |
|---|---|
| `{ "data": [...] }` | `GET /conversations` |
| `{ "messages": [...], "hasMore": bool }` | `GET /conversations/{id}/messages` |
| A bare array, no wrapper | `GET /users/search` |
| A bare object, no wrapper | `GET /auth/me`, `POST /conversations`, `POST /messages`, all group writes |
| `{ "token", "user" }` | `POST /auth/login` |

Four conventions across seven read endpoints. My client normalises all of them at a single
point so nothing above that line has to know.

### Which status codes are actually used

A status code is the short number a server returns to say how it went — 200 means fine, 404
means not found, and so on. This API uses `200` for almost everything that succeeds, `201`
for exactly one endpoint (group creation), and `400`, `401`, `403`, `404` and `500` for
failures.

One trap: **`400` means two different things here.** It's used both for "your request was
malformed" and for "you didn't send a token at all". Most APIs use `401` for the second.
More on that below.

---

## What the things look like

Observed field by field. A `?` means the field is missing from some responses.

### A user

```jsonc
{
  "_id": "6a9e4f4cdb386e2dcaba0fc5",
  "name": "Ada Lovelace",
  "phone": "+8801700988450",
  "createdAt": "2026-09-07T05:44:44.952Z"   // only on /auth/login and /auth/me
}
```

`createdAt` is dropped from users that appear inside search results and inside a
conversation's participant list. Don't rely on it being there.

### A message, over a normal request

```jsonc
{
  "_id": "6a9e4fafdb386e2dcaba103b",
  "conversation": "6a9e4fa8db386e2dcaba101f",
  "sender": "6a9e4f4cdb386e2dcaba0fc5",     // just an id, never the full user
  "text": "Hello",
  "createdAt": "2026-09-07T05:46:23.837Z"   // a date written out as text
}
```

### The same message, over the live connection

The live connection is the always-open pipe that lets the server push new messages to you
without you asking. It describes the **same message** differently:

```jsonc
{
  "id": "6a9e50badb386e2dcaba119d",         // "id", not "_id"
  "conversation": "6a9e4fa8db386e2dcaba101f",
  "sender": "6a9e4f4cdb386e2dcaba0fc5",
  "text": "Hello",                           // may be missing entirely
  "createdAt": 1788760250346                 // a number of milliseconds, not text
}
```

So the identifier is under a different key, and the timestamp is a different *type*, for
one entity depending only on how it reached you. Any client reading both has to convert
them into one shape, and mine does that once at the boundary rather than at every point of
use. See [findings §1.2](./api-findings.md#12-messagenew-renames-the-id-field-and-changes-the-timestamp-type).

### A one-to-one conversation

```jsonc
{
  "_id": "6a9e4fa8db386e2dcaba101f",
  "type": "direct",
  "participant": { "_id": "…", "name": "Grace Hopper", "phone": "+880…" },  // singular: the other person
  "lastMessage": { "text": "…", "sender": "…", "createdAt": "…" },          // {} if there are none
  "updatedAt": "2026-09-07T05:46:33.857Z"
}
```

### A group conversation

```jsonc
{
  "_id": "6a9e4ff6db386e2dcaba1078",
  "type": "group",
  "name": "Recon Squad",
  "createdBy": "6a9e4f4cdb386e2dcaba0fc5",
  "admins": ["6a9e4f4cdb386e2dcaba0fc5"],                     // ids only
  "participants": [{ "_id": "…", "name": "…", "phone": "…" }], // full objects
  "lastMessage": { … } | {},
  "updatedAt": "…",
  "createdAt": "…"                                             // only when you create or change it
}
```

Two things to watch here.

**The list of people in a conversation arrives in three different shapes.** Bare ids from
`POST /conversations`, full objects on groups, and a *singular* `participant` on one-to-one
chats. There's no way to write one piece of code that reads all three, so treat direct and
group as two distinct kinds of thing that happen to share an endpoint.

**`lastMessage` is an empty object `{}` when there are no messages, not an empty value.**
This matters more than it looks: in JavaScript an empty object counts as "yes, there's
something here", so the obvious check for "does this conversation have a last message"
silently passes and you end up reading fields off nothing.

---

## Signing in

### `POST /auth/login`

Logs you in, or registers you if you're new. No token needed, obviously. There is no
separate signup call: an unknown phone number creates an account, a known one signs in.

```jsonc
// what you send
{ "phone": "+8801700988450", "name": "Ada Lovelace" }
```

A `200` gives you back:

```jsonc
{ "token": "eyJhbGciOiJIUzI1NiIs…", "user": { "_id", "name", "phone", "createdAt" } }
```

**Signing in with an existing phone number but a different name renames that account.** The
phone number on its own is the entire credential — there is no password and nothing to
verify it's yours — so this call doubles as an unauthenticated rename of anyone's profile.
Display names on this platform are not trustworthy identity.

**The phone number isn't checked at all.** Sending `{"phone": "hello world"}` returns `200`
and creates an account. If you want phone numbers to look like phone numbers, your client
has to enforce that itself.

| Status | When |
|---|---|
| `200` | Signed in, or registered |
| `400` | `VALIDATION_ERROR` — `phone` or `name` missing, empty, or not text |
| `400` | `SERVER_ERROR` — the body isn't valid JSON. Mislabelled: that's a client error |

### `GET /auth/me`

Who am I. Returns a bare user object with no wrapper around it.

```jsonc
{ "_id": "…", "name": "…", "phone": "…", "createdAt": "…" }
```

| Status | When |
|---|---|
| `200` | Fine |
| `400` | `NO_TOKEN` — header missing, empty, or not `Bearer`. Note: **not** 401 |
| `401` | `INVALID_TOKEN` — malformed, tampered with, or badly signed |

---

## Finding people

### `GET /users/search?q=`

Searches by name or phone number. Returns a bare array of `{_id, name, phone}`, capped at
**50 results**, with no way to ask for the next page.

**This endpoint has the most serious problems in the API.** Here is what actually happens,
which is not what you'd guess:

| What you search for | What you get |
|---|---|
| `q=Grace` | 46 matches |
| `q=grace` | **Nothing.** Name matching is case-sensitive |
| `q=Hossain` (second word of "Imran Hossain") | 5 — it matches the start of any *word*, not just the start of the name |
| `q=mran` (from the middle of a word) | **Nothing.** It is not a "contains" search |
| `q=01672589498` (a phone stored without a `+`) | 1 — phone numbers must match *exactly* |
| `q=0167258` (the start of that same number) | **Nothing** |
| `q=%2B8801711000902` (a phone with `+`, sent as-is) | **Server crash, 500** |
| `q=%5C%2B8801711000902` (the same, escaped) | **Nothing** — escaping breaks the exact match |
| `q=` or no `q` at all | **50 users** — the whole directory, even though `q` is marked required |
| `q=.*` | Matches everything, because `q` is used as a search pattern without cleaning |

**Names and phone numbers are matched by two completely different rules.** A name goes
through a case-sensitive pattern anchored to the start of a word. A phone goes through
plain string equality. Nothing in the published documentation hints at either.

Here's the crash when the query starts with a `+`:

```jsonc
{ "error": { "message": "Regular expression is invalid: quantifier does not follow a repeatable item",
             "code": 51091 } }   // note: a NUMBER, unlike every other error code in the API
```

Your search text is being dropped straight into a pattern-matching engine without being
escaped first, and in that language a leading `+` is meaningless on its own, so the whole
thing falls over. **Searching for a phone number in the internationally standard format
crashes the endpoint** — and the API's own documentation gives `+15551234567` as its
example phone number. Clients have to escape special characters before sending.

That leads to a problem with no client-side fix at all: **a phone number stored with a `+`
in front of it cannot be found by anybody.** Send it raw and you get a crash. Escape it and
the text no longer equals what's stored, so the exact-match test fails. There is no third
option. My client sends several safe variations of a query and merges the results, which
recovers most real cases, and the interface tells people to search by name.

One more: **the results include you.** Combined with the bug in `POST /conversations`
below, picking yourself out of your own search results opens a stranger's conversation. So
filter yourself out.

| Status | When |
|---|---|
| `200` | An array of matches, possibly empty |
| `400` | `NO_TOKEN` |
| `500` | `q` contains a special character such as `+`, `(` or `*` |

---

## Conversations

### `GET /conversations`

Every conversation you're part of, newest activity first, wrapped in `{ "data": [...] }`.
One-to-one and group chats come back mixed together, so check the `type` field to tell them
apart. A brand new user gets `{"data": []}`.

`200`, or `400 NO_TOKEN`.

### `POST /conversations`

Start a one-to-one conversation, or find the existing one.

```jsonc
{ "userId": "6a9e4f4ddb386e2dcaba0fca" }
```

A `200` returns a bare conversation whose participant list is an array of **plain id
strings** — unlike everywhere else in the API, where they're full objects.

**Calling it twice is safe.** The same pair of people always gets the same conversation
back, so "do I already have a chat with this person" is handled for you by the server. It
returns `200` either way and gives you no way to tell whether it created something or found
it.

**Passing your own id returns an arbitrary conversation belonging to someone else.** Not an
error, and not a note-to-self chat. It behaves exactly like a lookup for "a conversation
containing me and me" collapsing into "any conversation containing me". This is why
filtering yourself out of search results isn't cosmetic.

| Status | When |
|---|---|
| `200` | Created, or the existing one returned |
| `400` | `VALIDATION_ERROR` (no `userId`) or `UNKNOWN_USER` (well-formed id, no such person) |
| `500` | `userId` isn't a valid id — and it leaks `Cast to ObjectId failed … for model "User"` |

### `GET /conversations/{id}/messages?limit=&before=`

The history of a conversation, **newest first**. Reverse it before you display it.

```jsonc
{ "messages": [ Message, … ], "hasMore": true }
```

How paging works here, as observed rather than as documented:

- **`before` is a message id**, not a date. Sending a date returns `500`.
- **`before` includes the message you named.** The message you used as your marker comes
  back *again* as the first item of the next page. Paging through 25 messages ten at a time
  gives you 30 rows across three pages, of which only 28 are distinct. Merge pages by id;
  never just stick them end to end. This single behaviour is the reason my client files
  every message by its id rather than keeping a list.
- **The default page size is 20.** `limit=0`, `limit=-5` and `limit=abc` all quietly fall
  back to 20 rather than complaining. `limit=2.7` returns 2.
- **There is no maximum page size.** `limit=9999` returned the entire history in one go.
- **An unknown marker is silently ignored** and you get page one instead. So a stale marker
  turns "load older messages" into "here are the newest messages again", with no error to
  tell you why.
- **`hasMore` is reliable.** It was correct in every case I tested, including at the exact
  boundary where the last page is full. It's the signal to trust for "stop loading".

| Status | When |
|---|---|
| `200` | Fine |
| `400` | `NO_TOKEN` |
| `403` | `FORBIDDEN` — you're not in this conversation, including if you were removed |
| `404` | `NOT_FOUND` — no such conversation |
| `500` | A malformed `id`, or a malformed `before` |

**There is no way to fetch one conversation by id.** `GET /conversations/{id}` returns
"route not found". So a link straight to a thread can't be resolved directly — you have to
load the whole list and find it, which is what my client does.

---

## Sending a message

### `POST /messages`

```jsonc
{ "conversationId": "…", "text": "Hello" }
```

A `200` returns the created message. **This is the only send path that tells you what it
saved**, which is precisely why my client sends this way rather than over the live
connection.

**A send to a conversation that doesn't exist returns `200` with a body of `null`.** A
success code for a write that did not happen. Worse, the live-connection version of the
same call gets this right and returns a proper error. The defence is to check the *shape*
of what comes back, not just the status code, and treat a well-statused response with the
wrong body as the failure it is.

**Empty messages are accepted.** `{"text": ""}` and `{"text": "   "}` both return `200`,
create a real message and broadcast it to everyone else in the conversation. Nothing is
trimmed and there is no length limit either — 10,000 characters went through fine. All of
that has to be enforced by the client, which means any client that doesn't enforce it
degrades the shared history for everybody.

| Status | When |
|---|---|
| `200` | Message created — **or** the conversation was missing, with `null` as the body |
| `400` | `VALIDATION_ERROR` — no `text` or no `conversationId` |
| `403` | `FORBIDDEN` — you're not in this conversation |
| `500` | A malformed `conversationId` |

---

## Groups

This is the best-built part of the API and I want to say so clearly, because most of this
document is criticism. Permissions are enforced correctly and consistently across all four
admin actions, each with its own distinct message.

### `POST /conversations/group`

```jsonc
{ "name": "Project Team", "participantIds": ["<id>", "<id>"] }
```

Returns `201` and the new group. This is the only `201` in the entire API.

- Your own id doesn't go in the list — you're added automatically as the only admin.
- You need at least two other people, so three members including you. Duplicates in the
  list are removed for you, and your own id is ignored if you include it anyway. Both are
  the right call.
- **The three-member minimum is only enforced when the group is created.** Removing people
  can take a group below it, and it carries on working as a normal group. So don't write
  any code that assumes a group has at least three members.

| Status | When |
|---|---|
| `201` | Created |
| `400` | `VALIDATION_ERROR` (missing name, fewer than two people) · `INVALID_NAME` (a name of only spaces — a different code *and* a different shape, with no `details`) · `UNKNOWN_USER` |
| `500` | A malformed id in the list |

### `PATCH /conversations/{id}` — rename a group

`{ "name": "New name" }` returns `200` and the full updated group. Admins only.

| Status | When |
|---|---|
| `200` | Renamed |
| `400` | `VALIDATION_ERROR` (empty) · `INVALID_NAME` (only spaces) · `NOT_A_GROUP` (it's a one-to-one chat) |
| `403` | `FORBIDDEN` — "Only admins can rename the group" |

### `POST /conversations/{id}/participants` — add people

`{ "userIds": ["<id>"] }` returns `200` and the full updated group. Admins only. Adding
somebody who's already in does nothing and still returns `200`.

`400 VALIDATION_ERROR` for an empty list, `403` for non-admins.

### `DELETE /conversations/{id}/participants/{userId}` — remove somebody, or leave

Returns `200` and the full updated group. Admins can remove anyone; anyone can remove
themselves, which is how leaving works. A removed member loses access to the history
immediately and starts getting `403`.

**When the last admin leaves, someone else is promoted automatically**, so a group can
never end up with nobody in charge. That's a genuinely thoughtful detail.

Removing somebody who isn't in the group returns `200` and quietly does nothing.

`403 FORBIDDEN` — "Only admins can remove other members".

### `POST /conversations/{id}/admins` — promote somebody

`{ "userId": "<id>" }` returns `200` and the full updated group. Admins only, and calling
it twice is harmless.

`400 NOT_A_MEMBER` if they aren't in the group, `403` for non-admins.

**There is no way to demote anyone.** Admin status, once given, is permanent.

---

## Health

### `GET /health`

At the root address, not under `/api`. `/api/health` returns `404`.

`200` and `{ "status": "ok" }`. No token needed.

---

## When things go wrong

### The shape of an error

Normal requests share one error format, and the `details` list maps neatly onto
field-by-field form errors, which is genuinely useful:

```jsonc
{ "error": { "message": "Validation failed",
             "code": "VALIDATION_ERROR",
             "details": [ { "path": "phone", "message": "Required" } ] } }
```

### Every code I saw

| Code | Status | What it means |
|---|---|---|
| `NO_TOKEN` | **400** | No `Authorization` header, an empty one, or not `Bearer` |
| `INVALID_TOKEN` | 401 | Malformed, tampered with, or badly signed token |
| `VALIDATION_ERROR` | 400 | The body failed validation; comes with `details` |
| `INVALID_NAME` | 400 | A group name of only spaces; comes **without** `details` |
| `UNKNOWN_USER` | 400 | You referenced a user who doesn't exist |
| `NOT_A_MEMBER` | 400 | You tried to promote somebody who isn't in the group |
| `NOT_A_GROUP` | 400 | A group operation aimed at a one-to-one chat |
| `FORBIDDEN` | 403 | Not a participant, or not an admin |
| `NOT_FOUND` | 404 | No such conversation, or an unknown route |
| `SERVER_ERROR` | 400 / 500 | Invalid JSON body (400), or a malformed id (500) |
| `51091` | 500 | A **number**, not text. The invalid-pattern crash from user search |

### Three things worth writing code around

1. **Authentication failures are split across two status codes.** A *missing* credential is
   `400 NO_TOKEN`; an *invalid* one is `401`. The usual client rule of "on a 401, sign the
   user out" therefore misses half of them. Check for `401` or the `NO_TOKEN` code, not
   status alone.
2. **The error code is usually text but occasionally a number.** Any generic error handling
   has to survive `51091`.
3. **Errors over the live connection use a third format entirely** — `{ ok: false, error:
   "some plain text" }`, with no code and no details.

### It leaks its own internals

Any malformed id produces a `500` carrying the raw database driver message and the internal
name of the data model:

```
Cast to ObjectId failed for value "nope" (type string) at path "_id" for model "Conversation"
```

Two problems in one line: a mistake in *my* request is being reported as a fault on *their*
side, and the response tells a stranger how the database is structured. My client remaps
these to a plain "not found" so none of it reaches a user.

---

## The live connection

None of this appears in the published documentation, so it's specified here in full.

### Connecting

```js
import { io } from 'socket.io-client';
const socket = io('https://frontend-task-chatapp.onrender.com', { auth: { token } });
```

Again: the **root address**, not `/api`.

Authentication on connect is clean and fails loudly, with no half-connected state to guess
at, which I appreciated:

| What you send | What happens |
|---|---|
| A valid token | It connects |
| An invalid token | `connect_error`, "Invalid token" |
| No token | `connect_error`, "No token provided" |

### Who receives what

**The server broadcasts to each person, not to each conversation.** That sounds like a
detail and isn't: it means a connection opened *before* a conversation existed still
receives that conversation's messages. I verified this both for a group created after
connecting and for a brand new one-to-one chat. So there's no need to reconnect or
re-subscribe when a conversation is created.

**Nothing is replayed when you reconnect.** Anything sent while your connection was down is
gone from the live stream permanently, and the only way to get it is to re-fetch the
history. Re-syncing after a reconnect isn't an optimisation here, it's mandatory.

### `message:new` — the server telling you about a message

Fires for every message in any conversation you belong to.

```jsonc
{ "id": "…", "conversation": "…", "sender": "…", "text": "…", "createdAt": 1788760250346 }
```

Note `id` rather than `_id`, the timestamp as a number rather than text, and that `text`
may be **missing entirely** if the message was created without any.

**You are never told about your own messages.** I verified this for sends over both routes.
On the one hand that means an app showing your message immediately won't see it appear
twice. On the other, it's why two browser tabs signed in as the same person can't stay in
step on their own, and it's the root of the two-tab problem the client solves with a
send-lock. Filing messages by id means the client stays correct either way, if this is ever
changed.

### `conversation:updated` — the server telling you a conversation changed

Sends the full group object to every member when a group is created, renamed, or has its
membership or admins changed.

**It is not sent when a one-to-one conversation is created.** The other person is told
nothing at all and only finds out a chat exists when a message arrives in it. I can't see a
reason for the asymmetry. My client works around it by refreshing the conversation list
whenever a message arrives for a conversation it doesn't recognise.

### `message:send` — sending over the live connection

```js
socket.emit('message:send', { conversationId, text }, (ack) => { … });
```

The confirmations look like this:

```jsonc
{ "ok": true }                                              // it worked
{ "ok": false, "error": "Conversation not found" }          // plain text, no code
{ "ok": false, "error": "Not a participant of this conversation" }
{ "ok": false, "error": "Cast to ObjectId failed for value \"nope\" …" }   // leaked again
```

**The confirmation contains no message** — no id, no timestamp, nothing. So a message sent
this way can never be matched up with the temporary copy an app shows you while it's in
flight. That's the single reason my client **sends over normal requests and listens over
the live connection**, rather than doing both over the live connection as you might expect.

Empty text, whitespace-only text and a **completely missing** `text` field all confirm
`{ok: true}` and broadcast. Sending with no `text` at all creates a message whose
notification has no `text` key, which is where the missing field above comes from.

One genuine oddity in the API's favour: **this route validates the conversation correctly
where the normal request does not.** The same bad conversation id that returns `200 null`
over a normal request returns a proper `{ok: false, error: "Conversation not found"}` here.
The correct behaviour exists in the codebase; it just isn't on the path most clients use.

---

## How I'd redesign it

Only changes that fix something I actually hit. Each one names the problem it solves.

### Correctness — these are bugs, not preferences

1. **Stop including the message you paged from.** Fixes the duplicate at every page
   boundary. Today every correct client has to de-duplicate to work around it.
2. **Return `404` when sending to a conversation that doesn't exist.** Fixes a failed write
   reporting itself as a success, and brings the normal route in line with the live
   connection, which already gets this right.
3. **Reject empty and whitespace-only messages.** Today "no empty messages" is a rule no
   server enforces, so every client has to reimplement it, and one that doesn't spoils the
   history for everyone else.
4. **Escape the search text before using it as a pattern.** Fixes the crash on
   `+`-prefixed phone numbers — the endpoint's own documented use case — and closes an
   injection hole while you're there.
5. **Require a non-empty search term.** An empty query currently hands any caller the name
   and phone number of every user on the platform.
6. **Match names case-insensitively and phone numbers on partial input.** `grace` finding
   nothing and the last six digits of a number finding nothing are the only two ways people
   actually search.
7. **Leave the caller out of search results, and refuse to open a conversation with
   yourself.** Together these close the path where picking yourself opens a stranger's chat.
8. **Turn malformed ids into a `400` with a generic message.** Fixes client mistakes being
   reported as server faults, and stops leaking driver internals and model names.
9. **Return `401` when a token is missing.** `400 NO_TOKEN` puts an authentication failure
   in the wrong category and breaks the standard "on a 401, sign out" rule every client
   uses.
10. **Enforce the three-member group minimum on removal too, or drop it entirely.** A rule
    enforced only at creation is not a rule.

### Consistency

11. **One response wrapper everywhere:** `{ data }` when it works, `{ error }` when it
    doesn't. Fixes four different shapes across seven endpoints, which is the single
    biggest source of per-endpoint special-casing in my client.
12. **One shape for a reference to a person.** Participants should always be full user
    objects, including from `POST /conversations`, and one-to-one chats should use the same
    `participants` key rather than a singular `participant`. Three shapes for one idea
    forces clients to model a difference that's really just serialisation.
13. **Pick `id` or `_id` and use it everywhere, and always write timestamps as text** —
    including over the live connection. The same entity arriving with a different key and a
    different timestamp type depending on how it reached you is the kind of fault most
    likely to reach production unnoticed.
14. **`lastMessage` should be empty, not an empty object,** when there are no messages. As
    it stands, the natural check for it is always wrong.
15. **Use `201` for every create, or `200` for every create.** Right now exactly one
    endpoint disagrees with the rest.
16. **Always return a code, a message and a details list, with the code always text.**
    Fixes the numeric `51091` and the `INVALID_NAME` variant that omits its details, both
    of which break any generic error handling.

### Paging

17. **Return the next marker explicitly** rather than making clients dig it out of the last
    item. It also makes the ordering the server's business, which is what lets you change
    it later without breaking every client.
18. **Validate the page size and cap it** (say 100). Today `limit=abc` silently becomes 20
    and `limit=9999` returns the entire history.
19. **Reject an unknown paging marker.** Silently returning page one turns a stale marker
    into "load older" mysteriously re-serving the newest messages.

### Things worth adding

20. **`GET /conversations/{id}`.** Without it, a link to a single thread has to load the
    entire conversation list to resolve one id.
21. **Either `GET /messages/{id}`, or make the live-connection confirmation carry the
    message it created.** Either one would make sending over the live connection viable.
    Today it returns nothing usable, which forces every send onto the normal route.
22. **Announce new one-to-one conversations** the way group changes are announced. Closes
    the gap where group changes notify everyone and a new chat notifies nobody.
23. **A real sign-in story** — registration separate from login, and a one-time code or a
    password. Today a phone number is the whole credential and signing in silently renames
    whatever account already has it.

### One thing worth removing

24. **Split "leave a group" out of "remove a member".** One route doing both is why it
    needs two separate permission branches, and why removing somebody who isn't a member
    quietly returns success.
