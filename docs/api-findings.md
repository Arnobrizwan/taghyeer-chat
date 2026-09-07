# API Findings — live probe of `frontend-task-chatapp.onrender.com`

Everything below was observed against the live API on **7 September 2026**, not inferred
from the Swagger page. The published spec is deliberately request-only: it declares
`responses: { default: Unspecified }` for every operation, so every status code, envelope
and field type here was derived by calling the thing.

Re-runnable proof: [`docs/recon/verify-api.mjs`](./recon/verify-api.mjs) asserts every
claim in this document against the live API — `node docs/recon/verify-api.mjs`. Last run:
**57/57 checks matched.**

Raw captures: [`docs/recon/`](./recon) (`phase-a` auth · `phase-b` conversations/messages ·
`phase-c` groups/admin · `phase-d` pagination · `phase-e`/`phase-f` sockets). JWTs redacted.

Test accounts: three users (Ada / Grace / Alan) registered with fresh `+8801…` numbers.

**Fairness note.** A good part of this API is well built — group authorization in particular
is careful and correct. I have flagged what is genuinely wrong and said so plainly where
things work. The list is long because I probed hard, not because the API is bad.

---

## 1. Findings that directly shaped the client architecture

These six are the ones that would have produced visible, hard-to-debug bugs if I had
assumed conventional behaviour.

### 1.1 The `before` cursor is **inclusive** — every page boundary repeats a message

Seeded 25 ordered messages (`seq-01`…`seq-25`) and paged with `limit=10`:

```
page1  ?limit=10                          → seq-25 … seq-16   hasMore=true
page2  ?limit=10&before=<_id of seq-16>   → seq-16 … seq-07   hasMore=true
page3  ?limit=10&before=<_id of seq-07>   → seq-07 … (older)  hasMore=true
```

`seq-16` and `seq-07` each appear on two pages. Across three pages: **30 messages
fetched, 28 unique.** A naive `[...older, ...current]` concat on scroll-up renders a
duplicate at every single page boundary.

*Handled by:* the message store is keyed by id (`Map<id, Message>`), never an array
concat, so a repeated boundary message collapses onto itself. Documented in
`DECISIONS.md` as the reason the store is id-keyed rather than a plain list.

### 1.2 `message:new` renames the id field and changes the timestamp type

The same message entity, over two transports, in the same second:

| | REST `POST /messages` | socket `message:new` |
|---|---|---|
| id field | `"_id": "6a9e50ba…"` | `"id": "6a9e50ba…"` |
| createdAt | `"2026-09-07T05:50:50.346Z"` (ISO string) | `1788760250346` (epoch ms number) |

```jsonc
// REST response
{"_id":"6a9e50badb386e2dcaba119d","conversation":"6a9e4fa8…","sender":"6a9e4f4c…",
 "text":"REST-ECHO-TEST","createdAt":"2026-09-07T05:50:50.346Z"}
// socket message:new, same message
{"id":"6a9e50badb386e2dcaba119d","conversation":"6a9e4fa8…","sender":"6a9e4f4c…",
 "text":"REST-ECHO-TEST","createdAt":1788760250346}
```

Feed the socket payload into code expecting the REST shape and you get `undefined` keys
and `Invalid Date` — silently, at render time.

*Handled by:* two Zod schemas that both normalise onto one internal `Message` type
(`id: string`, `createdAt: number`). Nothing downstream of the API boundary knows there
were ever two shapes.

### 1.3 The sender does **not** receive an echo of their own message

A sent a message; only B received `message:new`. Confirmed for both REST send and socket
`message:send`.

```
A received message:new? false
B received message:new? true
```

*Consequence:* optimistic append will **not** be double-rendered by an incoming socket
echo. Reconciliation is therefore only needed between the optimistic entry and the REST
response — a strictly simpler problem than the usual echo-dedupe. I still key by id and
carry a client `tempId`, so the design stays correct if an echo is ever added.

### 1.4 Socket `message:send` acks `{ok:true}` but returns **no message**

```
ack = [{"ok":true}]
```

No id, no timestamp. So a socket-sent message cannot be reconciled against its optimistic
placeholder — you never learn its server id. REST `POST /messages` returns the full
created message.

*Decision:* **send over REST, receive over socket.** The socket is a pure inbound
channel. This is the single most consequential architecture decision from recon, and it is
driven by the API's actual behaviour rather than preference.

### 1.5 `POST /messages` into a non-existent conversation returns **HTTP 200 with body `null`**

```
POST /messages {"conversationId":"6a9e4f4cdb386e2dcaba0000","text":"ghost"}
→ HTTP 200   null
```

A success status for a write that did not happen. The socket path gets this right
(`{"ok":false,"error":"Conversation not found"}`), so **REST and socket disagree about the
same operation.**

*Handled by:* the API client treats a `2xx` whose body fails schema validation as an
error, so a `null` body raises rather than resolving. Without that guard a send into a
deleted conversation would show as delivered.

### 1.6 Nothing is replayed on socket reconnect

Closed C's socket, sent two messages, reconnected, waited 5s:

```
replayed on reconnect? false (count=0)
REST re-sync finds them: ["OFFLINE-2","OFFLINE-1", …]
```

Messages sent during a drop are gone from the live stream permanently. The only recovery
is a REST re-fetch.

*Handled by:* on every `reconnect`, the open thread re-fetches its newest page and merges
by id. This is why the brief's "re-sync on reconnect" requirement is not optional here —
without it the UI silently loses messages.

**Good news on rooms:** the server broadcasts to **per-user** rooms, not per-conversation
ones. A socket connected *before* a group existed still receives messages for it, and for
brand-new direct conversations, with no reconnect. I tested this specifically because
per-conversation rooms would have forced a reconnect-on-new-conversation workaround.

---

## 2. `/users/search` — the weakest endpoint

### 2.1 Searching by phone number in the documented format returns **HTTP 500**

The spec's own example phone is `+15551234567`. Searching for any `+`-prefixed number:

```
GET /users/search?q=%2B88018009884505
→ HTTP 500
{"error":{"message":"Regular expression is invalid: quantifier does not follow a
  repeatable item","code":51091}}
```

`q` is interpolated into a MongoDB regex unescaped, so a leading `+` is a dangling
quantifier. **The primary documented use case — "search by phone" — crashes the endpoint.**
It is also an unsanitised-regex injection: `q=.*` matches every user.

*Handled by:* the client escapes regex metacharacters before sending, and additionally
retries a `+`-prefixed query without the `+`. Users type `+880…`; they should not have to
know the server can't take it.

### 2.2 An empty `q` dumps the user directory

`?q=` and an omitted `q` both return 50 users (an apparent internal cap) — every account
on the service, names and phone numbers, to any authenticated caller. `q` is marked
`required: true` in the spec, but is not enforced.

*Handled by:* the client never issues a search below 2 characters. Debounced input
firing on an empty field would otherwise pull the whole directory on every backspace.

### 2.3 Name and phone are matched by two different rules — and E.164 phones can't be found at all

My first pass concluded "case-sensitive and prefix-anchored". That was only half right, and
the correction matters, so here is what a second round of probing actually establishes:

| query | result | conclusion |
|---|---|---|
| `Grace` | 46 matches | — |
| `grace` | **0** | matching is case-**sensitive** |
| `Imran` | 3 | matches at the start of a name |
| `Hossain` (2nd word of "Imran Hossain") | 5 | **not** anchored to the string start — any **word** start |
| `mran` (mid-word) | **0** | not a substring match |
| `01672589498` (a phone stored without `+`) | **1** | exact phone matches |
| `0167258` (prefix of that same phone) | **0** | phone is **exact equality**, not prefix |
| `\+8801711000902` (escaped, exact stored value) | **0** | escaping breaks the equality test |
| `+8801711000902` (raw) | **500** | the unescaped `+` crashes it |

So there are **two different rules in one endpoint**: names go through a case-sensitive
regex anchored at a word boundary, phones through exact string equality.

**The consequence is that a phone number stored in E.164 form cannot be found by any
client.** Send it raw and the `+` produces a 500 (§2.1); escape the `+` and the query no
longer equals the stored value, so the equality test fails. Both doors are shut, and no
amount of client-side work opens either. The API's own example phone is `+15551234567`.

*Handled by:* `searchUsers` sends several safe variants and merges them — the raw query
when it contains no regex metacharacters (so exact phone match still works for numbers
stored without a `+`), an escaped copy (so name search never 500s), and the bare digits
for `+`-prefixed input (which matches numbers stored without one). The empty-result copy
states the real rules rather than implying the person doesn't exist.

### 2.4 Search returns *you*

`A` searching their own name gets their own account back. Selecting yourself hits the bug
in §4.3.

*Handled by:* self is filtered from results client-side.

---

## 3. Error handling: consistent envelope, inconsistent everything else

**Credit where due:** REST errors share one envelope, and it is a good one.

```jsonc
{ "error": { "message": "…", "code": "MACHINE_CODE", "details": [ {"path":"…","message":"…"} ] } }
```

`details[]` on validation failures is genuinely useful — it maps straight onto per-field
form errors, which is exactly what I use it for on the login screen.

But:

### 3.1 A missing token is **400**, not 401

```
no Authorization header      → 400 {"code":"NO_TOKEN"}
Authorization: Bearer <junk> → 401 {"code":"INVALID_TOKEN"}
Authorization: Token <valid> → 400 {"code":"NO_TOKEN"}
```

Authentication failure split across two status classes, with the *absent* credential
getting the less correct code. Any client that keys "log the user out" off `401` alone
will miss half of its auth failures.

*Handled by:* the client's session-expiry check keys off `401 || code === 'NO_TOKEN'`,
not status alone.

### 3.2 A malformed ObjectId is **500** with the raw Mongoose error leaked

```
GET /conversations/nope/messages
→ HTTP 500
{"error":{"message":"Cast to ObjectId failed for value \"nope\" (type string) at
  path \"_id\" for model \"Conversation\"","code":"SERVER_ERROR"}}
```

Same for `POST /conversations {userId:"not-an-id"}` and group creation with a malformed
id. A client-supplied bad id is a 400, not a server fault, and the internal model name
should not be in the response. A deep-link to `/app/c/typo` produces a 500.

*Handled by:* ids are validated client-side before they reach a URL, and the error
normaliser maps this specific `SERVER_ERROR` + CastError text onto a friendly "that
conversation doesn't exist".

### 3.3 Three different error shapes across the surface

| source | shape |
|---|---|
| REST | `{error:{message, code:"STRING", details?}}` |
| REST, Mongo-level | `{error:{message, code: 51091}}` — **numeric** code |
| socket ack | `{ok:false, error:"plain string"}` |

The numeric `code` breaks the "code is a string" assumption the rest of the API sets.

### 3.4 Two different shapes for the same validation failure

```
name: ""     → 400 {"code":"VALIDATION_ERROR","details":[{"path":"name",…}]}
name: "   "  → 400 {"code":"INVALID_NAME"}          ← no details[], different code
```

Empty and whitespace-only names fail in two different formats, so a form binding errors
from `details[]` silently shows nothing for the whitespace case.

### 3.5 Invalid JSON is reported as `SERVER_ERROR`

A malformed request body returns `400` (correct) but with `code:"SERVER_ERROR"` and the
raw parser message — a client error labelled as a server one.

---

## 4. Response-shape inconsistencies

### 4.1 Four envelope conventions across seven read endpoints

| endpoint | envelope |
|---|---|
| `GET /conversations` | `{ "data": [...] }` |
| `GET /conversations/{id}/messages` | `{ "messages": [...], "hasMore": bool }` |
| `GET /users/search` | bare array `[...]` |
| `GET /auth/me` | bare object |
| `POST /auth/login` | `{ "token", "user" }` |
| `POST /messages`, `POST /conversations` | bare object |

Four conventions, one API. This is the concrete problem the redesign section of `API.md`
addresses — not redesign for its own sake.

### 4.2 `participants` has three different representations

```jsonc
POST /conversations        → "participants": ["6a9e4f4c…", "6a9e4f4d…"]      // bare ids
GET /conversations (group) → "participants": [{_id, name, phone}, …]          // populated
GET /conversations (direct)→ "participant":  {_id, name, phone}               // singular!
```

Same conceptual field, three shapes, one of them a different key. Direct and group list
items are different enough that they need a discriminated union on `type`, which is how I
model them.

### 4.3 `POST /conversations` with your **own** id returns an unrelated conversation

```
POST /conversations {"userId": "<A's own id>"}   (as A)
→ 200, returns A↔B's existing conversation
```

Not an error, and not a self-chat — it returns whichever conversation A is already in.
This is consistent with a `participants: { $all: [me, userId] }` lookup, where
`$all: [A, A]` degenerates to "any conversation containing A". A user who searches, sees
themselves (§2.4) and taps their own name lands in a **stranger's conversation**.

*Handled by:* self is removed from search results, so the path is unreachable in the UI.

### 4.4 `lastMessage` is `{}` when there are no messages

An empty object rather than `null`, so `if (c.lastMessage)` is always true and
`c.lastMessage.text` is `undefined`. Normalised to `null` at the boundary.

### 4.5 `sender` is never populated

Every message carries `sender` as a bare id string. Group messages must show a sender
name, so the client resolves ids against the conversation's `participants[]`. A sender who
has since **left** the group is not in `participants`, so their name is unresolvable —
those render as "Former member" rather than a blank.

### 4.6 `text` can be absent entirely

Socket-sending `{conversationId}` with no `text` produces a stored message whose payload
has **no `text` key**. The schema treats `text` as optional and defaults it to `""`.

---

## 5. Validation gaps the client has to cover

### 5.1 Empty and whitespace-only messages are accepted by both transports

```
POST /messages {"text":""}      → 200, message created with text ""
POST /messages {"text":"    "}  → 200, message created
socket message:send {"text":""} → {"ok":true}, broadcast to the other party
```

The brief requires empty messages to be unsendable. **The server will not help** — this is
entirely a client-side guarantee, enforced in both the button's disabled state and the
submit handler.

### 5.2 No trimming, no length cap

`"  padded  "` is stored verbatim; a 10,000-character message is accepted. The client
trims before sending and caps input length.

### 5.3 No phone validation at all

`POST /auth/login {"phone":"hello world","name":"Junk"}` → **200**, account created. Phone
format is a client-side concern only.

### 5.4 Logging in with an existing phone and a different name **renames the account**

```
login {phone: X, name: "Ada Lovelace"}  → user.name = "Ada Lovelace"
login {phone: X, name: "Ada RENAMED"}   → user.name = "Ada RENAMED"   (same _id)
```

There is no password: the phone number alone is the credential, and the login call
doubles as an unauthenticated profile-rename. Correct per the brief ("new phone
auto-registers"), but worth stating plainly — it is why I do not treat the display name as
trustworthy identity anywhere in the UI.

---

## 6. Pagination details

- **Cursor is a message `_id`.** An ISO timestamp in `before` returns **500**.
- **Default `limit` is 20.** `limit=0`, `limit=-5` and `limit=abc` all silently fall back
  to 20 rather than erroring — confirmed against a 29-message conversation, so 20 is a
  real cap and not just "everything there was". `limit=2.7` returns 2.
- **No maximum limit.** `limit=9999` returned all 29 messages in one response.
- **A stale or unknown cursor is silently ignored.** `before=<valid-but-nonexistent
  ObjectId>` returns **page 1** instead of erroring — so a stale cursor makes "load older"
  silently re-serve the newest page. Caught by id-keyed merging, which makes it a no-op
  instead of a duplicate burst.
- **Order is newest-first** (descending). The client reverses for display.
- `hasMore` is present and **accurate** in every case I tested, including exactly-at-the-
  boundary. It is the reliable signal for stopping infinite scroll, and I use it rather
  than inferring from page length.

---

## 7. Groups and authorization — this part is well built

Probed every admin action as a non-admin. All correctly rejected with distinct, useful
messages:

```
PATCH  /conversations/{id}              (non-admin) → 403 "Only admins can rename the group"
POST   /conversations/{id}/participants (non-admin) → 403 "Only admins can add participants"
DELETE /conversations/{id}/participants/{other}     → 403 "Only admins can remove other members"
POST   /conversations/{id}/admins       (non-admin) → 403 "Only admins can promote members"
```

Also correct:

- Non-participants get `403 FORBIDDEN` on history, and **removed** members immediately
  lose access to history they could previously read.
- `POST /conversations` is **idempotent** — calling it twice for the same pair returns the
  same conversation. The brief's "handle already-having-a-conversation gracefully"
  requirement is satisfied server-side; the client still routes to the existing thread
  rather than assuming a create.
- Group creation **de-duplicates** `participantIds` and **ignores self** if included.
- Promoting an existing admin is idempotent.
- Promoting a non-member → `400 NOT_A_MEMBER`. Renaming a direct → `400 NOT_A_GROUP`.
- **When the last admin leaves, another member is auto-promoted** — a thoughtful touch
  that avoids orphaned groups.
- Group creation returns a proper `201`.

Minor issues in an otherwise solid area:

- **`201` on group create is the only `201` in the API** — every other write returns `200`,
  including creates. Inconsistent, though `201` is the correct one.
- **The "3+ members" rule is enforced only at creation.** Removals are not checked, so I
  reduced a group to a single participant and it remained `type: "group"` and fully
  functional. The client must not assume `participants.length >= 3`.
- **Removing a non-member returns `200`** and silently no-ops rather than `404`.
- **New direct conversations emit no socket event.** Group create/rename/membership all
  emit `conversation:updated` to every member, but starting a direct chat notifies the
  other party of nothing — they see it only when a message arrives or they refetch. An
  asymmetry with no obvious reason.

---

## 8. Transport, hosting and operational notes

- **`GET /health` is at the root, not under `/api`.** The spec declares its server as
  `{baseUrl}/api`, which makes the documented path `/api/health` — that **404s**.
  `https://…onrender.com/health` → `200 {"status":"ok"}`. A one-line spec bug, but it is
  the endpoint you would reach for first when the service seems down.
- **Warm latency is ~1 second.** Ten sequential `GET /conversations` calls: median
  **995 ms**, min 945 ms, max 1046 ms. Even fully warm, every request costs about a
  second. This is the real argument for optimistic sending — at a second per round trip,
  a non-optimistic composer feels broken.
- **Cold start:** Render's free tier spins down after ~15 minutes idle. The API was warm
  throughout my session (first call of the day: 1.46 s), so **I did not observe a true
  cold start and am not going to invent a number for one.** The handling is built and
  exercised against a forced timeout; §7 of the verification plan re-tests it against a
  genuinely idle service.
- **No rate limiting observed** — 30 concurrent requests, all `200`.
- **CORS is wide open and correct for a browser client:** `OPTIONS` → `204`,
  `access-control-allow-origin: *`, `allow-headers: authorization,content-type`. No proxy
  or server-side relay needed, so the app can call the API directly from the browser.
- **JWT:** `HS256`, claims `{sub, iat, exp}`, **7-day** expiry. `sub` is the user id, so
  the session can be hydrated without a `/auth/me` round trip — though I still verify
  against `/auth/me` on boot rather than trusting an unverified client-side decode.
- **Socket handshake auth is clean:** invalid token → `connect_error` "Invalid token";
  absent token → `connect_error` "No token provided". No silent half-connected state.
- **There is no `GET /conversations/{id}`.** It returns `404 "Route not found"`. A single
  conversation cannot be fetched by id, so deep-linking to a thread requires loading the
  full list and finding it there. This is the main reason the conversation list is fetched
  eagerly on entering the app.
- Unknown routes and wrong verbs return a consistent `404 {"code":"NOT_FOUND"}`.

---

## 9. Summary

| # | Finding | Severity | Client handling |
|---|---|---|---|
| 1 | `before` cursor inclusive → duplicate per page | **High** | id-keyed store |
| 2 | `id`/`_id` + number/ISO `createdAt` split by transport | **High** | Zod normalisation |
| 3 | `POST /messages` → `200 null` for missing conversation | **High** | schema-validated 2xx |
| 4 | No reconnect replay | **High** | REST re-sync on reconnect |
| 5 | Socket ack returns no message | **High** | send via REST |
| 6 | Empty/whitespace messages accepted | **High** | client-side guard |
| 7 | `?q=+880…` → 500 (regex injection) | **High** | escape + `+`-strip retry |
| 8 | Empty `q` dumps user directory | Medium | 2-char minimum |
| 9 | Malformed ObjectId → 500, leaks internals | Medium | validate before request |
| 10 | Missing token → 400 not 401 | Medium | check status *and* code |
| 11 | Four response envelopes | Medium | one normalised layer |
| 12 | Self returned by search → §4.3 wrong-conversation bug | Medium | filter self |
| 13 | Name search case-sensitive/word-anchored; **E.164 phones unfindable** | **High** | multi-variant query + honest UI copy |
| 14 | Stale cursor silently returns page 1 | Low | id-keyed merge absorbs it |
| 15 | `lastMessage: {}` not `null` | Low | normalised |
| 16 | Groups can fall below 3 members | Low | no length assumption |
| 17 | No `GET /conversations/{id}` | Low | eager list fetch |
| 18 | New directs emit no socket event | Low | list refetch on focus |

**Verdict.** The group/authorization layer is genuinely well built and I would not change
it. The problems concentrate in three places: the message-history cursor, the
REST↔socket contract drift, and `/users/search`, which has a reproducible 500 on its own
documented example input *and* cannot find an E.164 phone number by any means (§2.3). All are handled at the API boundary so that no component above
it deals with more than one shape of anything.
