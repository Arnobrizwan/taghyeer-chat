# Chat API — reference documentation

**Deliverable 1.** The published spec at `/docs/` is request-only: it declares
`responses: { default: Unspecified }` for every operation and documents no status codes.
Everything below — every envelope, field type, status code and error shape — was observed
against the live API on 7 September 2026. Evidence: [`docs/recon/`](./recon).
Behavioural quirks are catalogued in [`api-findings.md`](./api-findings.md); this document
is the contract, and cross-references findings where the contract is surprising.

Machine-readable version: [`openapi.yaml`](./openapi.yaml).

- **REST base URL:** `https://frontend-task-chatapp.onrender.com/api`
- **Socket.io origin:** `https://frontend-task-chatapp.onrender.com` (root, **not** `/api`)
- **Health:** `https://frontend-task-chatapp.onrender.com/health` — at the **root**.
  The spec places it under the `/api` server, but `/api/health` returns **404**.

---

## Conventions

### Authentication

`Authorization: Bearer <jwt>` on every endpoint except `POST /auth/login` and `GET /health`.

The JWT is `HS256` with claims `{ sub, iat, exp }`, where `sub` is the user id and the
lifetime is **7 days**. There is no refresh endpoint and no revocation; re-authenticating
means calling `POST /auth/login` again.

### Identifiers

All ids are 24-character hex MongoDB ObjectIds. A malformed id is **not** rejected as a
client error — it produces a **500** with a leaked driver message (see
[Error handling](#error-handling)). Validate ids before putting them in a URL.

### Response envelopes ⚠️

There is no single envelope. Four conventions are in use:

| Shape | Endpoints |
|---|---|
| `{ "data": [...] }` | `GET /conversations` |
| `{ "messages": [...], "hasMore": bool }` | `GET /conversations/{id}/messages` |
| bare array | `GET /users/search` |
| bare object | `GET /auth/me`, `POST /conversations`, `POST /messages`, all group writes |
| `{ "token", "user" }` | `POST /auth/login` |

### Status codes actually used

`200` (all successful reads and writes except one), `201` (**only** `POST
/conversations/group`), `400`, `401`, `403`, `404`, `500`.

Note `400` carries two distinct meanings: request validation failure *and* a missing
credential. See [Error handling](#error-handling).

---

## Data models

Observed field-for-field. `?` marks a field that is absent in some responses.

### User

```jsonc
{
  "_id": "6a9e4f4cdb386e2dcaba0fc5",
  "name": "Ada Lovelace",
  "phone": "+8801700988450",
  "createdAt": "2026-09-07T05:44:44.952Z"   // present on /auth/login and /auth/me only
}
```

`createdAt` is **omitted** from users embedded in search results and in
`conversation.participants[]`.

### Message (REST)

```jsonc
{
  "_id": "6a9e4fafdb386e2dcaba103b",
  "conversation": "6a9e4fa8db386e2dcaba101f",
  "sender": "6a9e4f4cdb386e2dcaba0fc5",     // bare id — NEVER populated
  "text": "Hello",
  "createdAt": "2026-09-07T05:46:23.837Z"   // ISO 8601 string
}
```

### Message (Socket `message:new`) ⚠️

The **same entity** over the socket, with two fields that differ from REST:

```jsonc
{
  "id": "6a9e50badb386e2dcaba119d",         // "id", not "_id"
  "conversation": "6a9e4fa8db386e2dcaba101f",
  "sender": "6a9e4f4cdb386e2dcaba0fc5",
  "text": "Hello",                           // may be ABSENT entirely
  "createdAt": 1788760250346                 // epoch milliseconds NUMBER, not ISO string
}
```

Any client consuming both transports must normalise. See
[findings §1.2](./api-findings.md#12-messagenew-renames-the-id-field-and-changes-the-timestamp-type).

### Conversation — direct

```jsonc
{
  "_id": "6a9e4fa8db386e2dcaba101f",
  "type": "direct",
  "participant": { "_id": "…", "name": "Grace Hopper", "phone": "+880…" },  // SINGULAR, the other user
  "lastMessage": { "text": "…", "sender": "…", "createdAt": "…" },          // {} when none
  "updatedAt": "2026-09-07T05:46:33.857Z"
}
```

### Conversation — group

```jsonc
{
  "_id": "6a9e4ff6db386e2dcaba1078",
  "type": "group",
  "name": "Recon Squad",
  "createdBy": "6a9e4f4cdb386e2dcaba0fc5",
  "admins": ["6a9e4f4cdb386e2dcaba0fc5"],                    // array of ids
  "participants": [{ "_id": "…", "name": "…", "phone": "…" }],// populated objects
  "lastMessage": { … } | {},
  "updatedAt": "…",
  "createdAt": "…"                                            // on write responses only
}
```

⚠️ `participants` takes **three different shapes** across the API — bare ids from
`POST /conversations`, populated objects on groups, and a singular `participant` on
directs. Model conversations as a discriminated union on `type`.

⚠️ `lastMessage` is `{}` — an empty object, not `null` — when a conversation has no
messages, so a truthiness check on it always passes.

---

## Auth

### `POST /auth/login`

Log in or register. **No auth required.** There is no separate signup: an unknown phone
creates an account, a known phone logs in.

```jsonc
// request
{ "phone": "+8801700988450", "name": "Ada Lovelace" }
```

**`200`**

```jsonc
{ "token": "eyJhbGciOiJIUzI1NiIs…", "user": { "_id", "name", "phone", "createdAt" } }
```

⚠️ **Logging in with an existing phone and a different `name` renames the account.** The
phone number alone is the credential; this call doubles as an unauthenticated profile
rename. There is no password.

⚠️ **`phone` is not validated.** `{"phone": "hello world"}` returns `200` and creates an
account. Format enforcement is entirely client-side.

| Status | Condition |
|---|---|
| `200` | Logged in or registered |
| `400` | `VALIDATION_ERROR` — `phone` or `name` missing, empty, or not a string |
| `400` | `SERVER_ERROR` — body is not valid JSON (mislabelled; it is a client error) |

### `GET /auth/me`

Current user. Returns a **bare User object**, not wrapped.

```jsonc
{ "_id": "…", "name": "…", "phone": "…", "createdAt": "…" }
```

| Status | Condition |
|---|---|
| `200` | — |
| `400` | `NO_TOKEN` — header absent, empty, or a non-`Bearer` scheme ⚠️ *not 401* |
| `401` | `INVALID_TOKEN` — malformed, tampered, or bad signature |

---

## Users

### `GET /users/search?q=`

Search by name **or** phone. Returns a **bare array** of `{_id, name, phone}`, capped at
**50** results, with no pagination.

⚠️ **This endpoint has the most serious defects in the API.**

| Input | Result |
|---|---|
| `q=Grace` | 46 matches |
| `q=grace` | **0** — name matching is case-**sensitive** |
| `q=Hossain` (2nd word of "Imran Hossain") | 5 — anchored to any **word** start, not the string start |
| `q=mran` (mid-word) | **0** — not a substring match |
| `q=01672589498` (exact phone, stored without `+`) | 1 — phone is **exact equality** |
| `q=0167258` (a prefix of that same phone) | **0** — not a prefix match |
| `q=%2B8801711000902` (E.164, raw) | **`500`** ⚠️ |
| `q=%5C%2B8801711000902` (E.164, escaped) | **0** — escaping breaks the equality test |
| `q=` or `q` omitted | **50 users returned** — the whole directory, despite `q` being `required` |
| `q=.*` | matches everything — `q` is an unescaped regex |

⚠️ **Name and phone are matched by two different rules.** Name goes through a
case-sensitive regex anchored at a word start; phone through exact string equality.

The `500` on `+`:

```jsonc
{ "error": { "message": "Regular expression is invalid: quantifier does not follow a repeatable item",
             "code": 51091 } }   // note: NUMERIC code, unlike every other error
```

`q` is interpolated into a MongoDB regex without escaping, so a leading `+` is a dangling
quantifier. **Searching by phone in the documented format crashes the endpoint.** Clients
must escape regex metacharacters before sending.

⚠️ **A phone stored in E.164 form cannot be found by any client.** Sent raw, the `+`
returns `500`. Escaped, the query no longer equals the stored value, so the exact-equality
phone test fails. There is no third option — this is unfixable from the client, and the
API's own example phone is `+15551234567`.

⚠️ Results **include the calling user**. Combined with the bug in `POST /conversations`
below, selecting yourself from search opens someone else's conversation.

| Status | Condition |
|---|---|
| `200` | Array of matches (possibly empty) |
| `400` | `NO_TOKEN` |
| `500` | `q` contains regex metacharacters such as `+`, `(`, `*` |

---

## Conversations

### `GET /conversations`

Every conversation the caller participates in, **sorted by `updatedAt` descending**.
Wrapped in `{ "data": [...] }`. Mixed direct and group items — discriminate on `type`.

Returns `{"data": []}` for a new user. `200` / `400 NO_TOKEN`.

### `POST /conversations`

Start (or find) a direct conversation.

```jsonc
{ "userId": "6a9e4f4ddb386e2dcaba0fca" }
```

**`200`** — a bare Conversation whose `participants` is an array of **bare id strings**
(unlike everywhere else).

✅ **Idempotent.** Calling it twice for the same pair returns the identical conversation,
so "already have a conversation with this user" is handled server-side. Note it returns
`200` in both cases and gives no signal as to which happened.

⚠️ **Passing your own `userId` returns an arbitrary existing conversation** — not an
error and not a self-chat. Consistent with a `participants: { $all: [me, userId] }` lookup
degenerating to "any conversation containing me". Filter yourself out of search results.

| Status | Condition |
|---|---|
| `200` | Created, or existing returned |
| `400` | `VALIDATION_ERROR` (missing `userId`) · `UNKNOWN_USER` (well-formed id, no such user) |
| `500` | ⚠️ `userId` is not a valid ObjectId — leaks `Cast to ObjectId failed … for model "User"` |

### `GET /conversations/{id}/messages?limit=&before=`

Message history, **newest-first (descending)**. Reverse for display.

```jsonc
{ "messages": [ Message, … ], "hasMore": true }
```

**Pagination contract, as observed:**

- `before` is a **message `_id`**. An ISO timestamp returns **`500`**.
- ⚠️ **`before` is INCLUSIVE.** The message identified by the cursor is returned **again**
  as the first item of the next page. Paging 25 messages at `limit=10` yields 30 rows
  across 3 pages, of which **28 are unique**. Merge by id; never concatenate.
- Default `limit` is **20**. `limit=0`, `limit=-5` and `limit=abc` all **silently fall back
  to 20** instead of erroring. `limit=2.7` returns 2.
- **No maximum `limit`** — `limit=9999` returned the entire history.
- ⚠️ An unknown-but-well-formed `before` is **silently ignored** and page 1 is returned, so
  a stale cursor quietly re-serves the newest messages instead of erroring.
- ✅ `hasMore` was accurate in every case tested, including at the exact boundary. It is
  the reliable signal for stopping infinite scroll.

| Status | Condition |
|---|---|
| `200` | — |
| `400` | `NO_TOKEN` |
| `403` | `FORBIDDEN` — not a participant (also returned to **removed** members) |
| `404` | `NOT_FOUND` — no such conversation |
| `500` | ⚠️ malformed `id` or malformed `before` |

There is **no `GET /conversations/{id}`**; it returns `404 Route not found`. A single
conversation cannot be fetched by id — deep-links must load the list and find it.

---

## Messages

### `POST /messages`

```jsonc
{ "conversationId": "…", "text": "Hello" }
```

**`200`** — the created Message (REST shape). This is the **only** send path that returns
the created entity; the socket equivalent does not (see below).

⚠️ **`200` with body `null` when the conversation does not exist.** A success status for a
write that did not happen — and the socket path returns a proper error for the same input.
Treat a `2xx` whose body fails schema validation as a failure.

⚠️ **Empty and whitespace-only text is accepted** — `{"text": ""}` and `{"text": "   "}`
both return `200` and create a message that is broadcast to other participants. There is
no trimming and **no length cap** (10,000 characters accepted). All of this must be
enforced client-side.

| Status | Condition |
|---|---|
| `200` | Message created — **or** conversation missing, with body `null` ⚠️ |
| `400` | `VALIDATION_ERROR` — `text` or `conversationId` missing |
| `403` | `FORBIDDEN` — not a participant |
| `500` | ⚠️ malformed `conversationId` |

---

## Groups

This is the best-built part of the API. Authorization is enforced correctly and
consistently across all four admin actions, each with a distinct message.

### `POST /conversations/group`

```jsonc
{ "name": "Project Team", "participantIds": ["<id>", "<id>"] }
```

**`201`** — the created group. ⚠️ The **only** `201` in the API.

- `participantIds` excludes the caller, who is added automatically as the sole **admin**.
- Requires **≥ 2** entries (3 members including you). ✅ Duplicates are de-duplicated and
  the caller's own id is ignored if included.
- ⚠️ The 3-member minimum is enforced **only at creation** — removals may take a group
  below it and it stays a fully functional `type: "group"`. Do not assume
  `participants.length >= 3`.

| Status | Condition |
|---|---|
| `201` | Created |
| `400` | `VALIDATION_ERROR` (`name` missing/empty, fewer than 2 participants) · `INVALID_NAME` (whitespace-only name — ⚠️ *different code and shape*, no `details[]`) · `UNKNOWN_USER` |
| `500` | ⚠️ malformed id in `participantIds` |

### `PATCH /conversations/{id}` — rename

`{ "name": "New name" }` → **`200`**, full updated group. Admin only.

| Status | Condition |
|---|---|
| `200` | Renamed |
| `400` | `VALIDATION_ERROR` (empty) · `INVALID_NAME` (whitespace-only) · `NOT_A_GROUP` (target is a direct) |
| `403` | `FORBIDDEN` — "Only admins can rename the group" |

### `POST /conversations/{id}/participants` — add members

`{ "userIds": ["<id>"] }` → **`200`**, full updated group. Admin only.
Re-adding an existing member is a silent no-op returning `200`.

`400 VALIDATION_ERROR` for an empty array · `403` for non-admins.

### `DELETE /conversations/{id}/participants/{userId}` — remove or leave

**`200`**, full updated group. Admins may remove anyone; **any member may remove
themselves** (leave). A removed member immediately gets `403` on history.

✅ **When the last admin leaves, another member is auto-promoted** — groups are never
orphaned.

⚠️ Removing someone who is not a member returns **`200`** and silently no-ops.

`403 FORBIDDEN` — "Only admins can remove other members".

### `POST /conversations/{id}/admins` — promote

`{ "userId": "<id>" }` → **`200`**, full updated group. Admin only. Idempotent.

`400 NOT_A_MEMBER` if the target is not in the group · `403` for non-admins.

There is **no demote endpoint** and no way to remove admin status.

---

## System

### `GET /health`

⚠️ At the **root origin**, not under `/api`. `/api/health` → **404**.

`200` → `{ "status": "ok" }`. No auth.

---

## Error handling

### Envelope

REST errors share one envelope, and `details[]` maps cleanly onto per-field form errors:

```jsonc
{ "error": { "message": "Validation failed",
             "code": "VALIDATION_ERROR",
             "details": [ { "path": "phone", "message": "Required" } ] } }
```

### Codes observed

| Code | Status | Meaning |
|---|---|---|
| `NO_TOKEN` | **400** ⚠️ | Authorization header absent, empty, or non-Bearer |
| `INVALID_TOKEN` | 401 | Malformed, tampered or bad-signature JWT |
| `VALIDATION_ERROR` | 400 | Body validation failed; carries `details[]` |
| `INVALID_NAME` | 400 | Whitespace-only group name; ⚠️ **no** `details[]` |
| `UNKNOWN_USER` | 400 | Referenced user does not exist |
| `NOT_A_MEMBER` | 400 | Promotion target is not in the group |
| `NOT_A_GROUP` | 400 | Group operation on a direct conversation |
| `FORBIDDEN` | 403 | Not a participant, or not an admin |
| `NOT_FOUND` | 404 | No such conversation, or unknown route/verb |
| `SERVER_ERROR` | 400 / 500 | Invalid JSON body (400) **or** ObjectId cast failure (500) |
| `51091` | 500 | ⚠️ **Numeric** code — MongoDB invalid-regex, from `/users/search` |

### Three inconsistencies worth coding around

1. **Auth failures split across `400` and `401`.** A *missing* credential is `400
   NO_TOKEN`; an *invalid* one is `401`. Session-expiry detection must check
   `401 || code === 'NO_TOKEN'`, not status alone.
2. **`code` is usually a string but sometimes a number** (`51091`).
3. **Socket errors use a third shape entirely** — `{ ok: false, error: "plain string" }`.

### Internal detail leakage

Any malformed ObjectId produces a `500` containing the raw driver message and the internal
model name:

```
Cast to ObjectId failed for value "nope" (type string) at path "_id" for model "Conversation"
```

This is a client error being reported as a server fault, and it exposes schema internals.

---

## WebSocket contract

Outside the OpenAPI document, so specified here in full.

### Connection

```js
import { io } from 'socket.io-client';
const socket = io('https://frontend-task-chatapp.onrender.com', { auth: { token } });
```

**Root origin, not `/api`.** Socket.io serves itself at `/socket.io/`.

Handshake auth is clean and fails loudly — no silent half-connected state:

| Condition | Result |
|---|---|
| Valid token | `connect` |
| Invalid token | `connect_error`, `message: "Invalid token"` |
| No token | `connect_error`, `message: "No token provided"` |

### Rooms and delivery

✅ The server broadcasts to **per-user** rooms, not per-conversation ones. A socket
connected *before* a conversation existed still receives its messages — verified for both
a group created after connect and a brand-new direct conversation. No reconnect is needed
when conversations are created.

⚠️ **Nothing is replayed on reconnect.** Messages sent while a socket was down are gone
from the live stream permanently and are only recoverable via
`GET /conversations/{id}/messages`. Re-syncing on reconnect is mandatory, not optional.

### `server → client` — `message:new`

Fires for every message in any conversation the user belongs to.

```jsonc
{ "id": "…", "conversation": "…", "sender": "…", "text": "…", "createdAt": 1788760250346 }
```

⚠️ `id` (not `_id`), `createdAt` as epoch **number** (not ISO string), and `text` may be
**absent** if the message was created without one.

⚠️ **The sender does NOT receive their own message.** Verified for both REST and socket
sends. Optimistic UI will therefore not be double-rendered by an echo — but keying inserts
by id keeps a client correct if an echo is ever added.

### `server → client` — `conversation:updated`

Full Conversation object (group shape) to **every** member, on group creation, rename, and
membership or admin changes.

⚠️ **Not emitted when a direct conversation is created.** The other party is told nothing
and only learns of the chat when a message arrives. An asymmetry with no obvious reason.

### `client → server` — `message:send`

```js
socket.emit('message:send', { conversationId, text }, (ack) => { … });
```

Ack shapes:

```jsonc
{ "ok": true }                                              // success
{ "ok": false, "error": "Conversation not found" }          // failure — plain string
{ "ok": false, "error": "Not a participant of this conversation" }
{ "ok": false, "error": "Cast to ObjectId failed for value \"nope\" …" }   // ⚠️ leaked
```

⚠️ **The ack contains no message** — no id, no timestamp. A socket-sent message can never
be reconciled against an optimistic placeholder, which is why this client **sends over
REST and receives over the socket**.

⚠️ Empty, whitespace-only and **missing** `text` all ack `{ok:true}` and broadcast. Sending
with no `text` field creates a message whose `message:new` payload has no `text` key.

Interestingly, the socket path validates the conversation **correctly** where REST does
not: the same bad `conversationId` that returns `200 null` over REST returns
`{ok:false, error:"Conversation not found"}` here.

---

## How I'd redesign this

Only changes that fix a problem I actually hit are listed. Each names the defect it fixes.

### Correctness — these are bugs, not preferences

1. **Make `before` exclusive.** Fixes the duplicate message at every page boundary
   (§1.1) — today every correct client must dedupe.
2. **Return `404` from `POST /messages` for a missing conversation.** Fixes `200 null`
   reporting a failed write as a success, and aligns REST with the socket, which already
   does this correctly.
3. **Reject empty and whitespace-only `text` with `400`.** Today the "no empty messages"
   rule is unenforceable server-side; every client must reimplement it, and any client
   that doesn't corrupts shared history for everyone.
4. **Escape the regex in `/users/search`.** Fixes the `500` on `+`-prefixed phones —
   the endpoint's own documented use case — and closes an unsanitised-regex injection.
5. **Require a non-empty `q`, returning `400`.** Fixes an empty query dumping every user's
   name and phone number to any caller.
6. **Case-insensitive, substring phone matching.** `grace` finding nothing and a phone's
   last six digits finding nothing both fail the only two ways people actually search.
7. **Exclude the caller from search results**, and reject `POST /conversations` with your
   own id. Together these close the path where selecting yourself opens a stranger's
   conversation.
8. **Map ObjectId cast failures to `400`** with a generic message. Fixes client errors
   reported as `500`s and stops leaking driver internals and model names.
9. **Return `401` for a missing token.** `400 NO_TOKEN` puts authentication failure in the
   wrong status class and breaks the standard "on 401, log out" client rule.
10. **Enforce the 3-member minimum on removal, or drop it at creation.** Enforcing an
    invariant only at creation means it isn't an invariant.

### Contract consistency

11. **One envelope everywhere:** `{ data: T }` for success, `{ error: {...} }` for failure.
    Fixes four different shapes across seven read endpoints — the single biggest source of
    per-endpoint special-casing in the client.
12. **One user-reference shape.** `participants` should always be an array of populated
    user objects, including on `POST /conversations`, and directs should use the same
    `participants` key rather than a singular `participant`. Three shapes for one concept
    forces a discriminated union purely to describe serialisation differences.
13. **`_id` → `id` everywhere, and always ISO-8601 timestamps** — including on the socket.
    Fixes the same entity arriving with a different key and a different timestamp *type*
    depending on transport, which is the failure mode most likely to reach production
    silently.
14. **`lastMessage: null`, not `{}`,** when a conversation is empty. `{}` is truthy, so
    the natural guard is always wrong.
15. **`201` for all creates,** or `200` for all of them. Currently exactly one endpoint
    differs from the rest.
16. **Always `{code, message, details[]}`, with `code` always a string.** Fixes the numeric
    `51091` and the `INVALID_NAME` variant that omits `details[]`, both of which break
    generic error handling.

### Pagination

17. **Return an explicit `nextCursor`** alongside `hasMore`, instead of requiring clients
    to reach into the last element for its `_id`. Cursor construction becomes the server's
    business, which is what lets you change the ordering key later.
18. **Validate `limit`** — `400` on non-numeric or negative — and **cap it** (say 100).
    Today `limit=abc` silently becomes 20 and `limit=9999` returns everything.
19. **`400` for an unknown `before` cursor.** Silently returning page 1 turns a stale
    cursor into "load older" mysteriously re-serving the newest messages.

### Resources worth adding

20. **`GET /conversations/{id}`.** Its absence means a deep-link to a thread must fetch the
    entire conversation list to resolve one id.
21. **`GET /messages/{id}` or a socket `message:sent` ack carrying the created message.**
    Would make socket sending viable; today the ack returns nothing usable, forcing
    all sends onto REST.
22. **Emit `conversation:updated` when a direct conversation is created.** Closes the
    asymmetry where group changes notify everyone but a new direct chat notifies nobody.
23. **A real auth story** — `POST /auth/register` separate from `POST /auth/login`, and an
    OTP or password. Today the phone number is the entire credential and the login call
    silently renames any existing account, so display names are not trustworthy identity.

### Resources worth removing

24. **Drop `DELETE /conversations/{id}/participants/{userId}` as the leave mechanism** in
    favour of an explicit `DELETE /conversations/{id}/me`. Overloading one route with
    "admin removes member" and "member leaves" is why it needs two different permission
    branches and why removing a non-member silently returns `200`.
