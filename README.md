# Relay

A real-time chat client for direct and group conversations, built against the provided
Chat API. Take-home submission for the Senior Frontend Engineer role at Taghyeer
Technologies.

## Live

Both deliverables are served from one domain:

| | URL |
|---|---|
| **Part 2 — landing page** | **https://taghyeer-chat-rust.vercel.app/** |
| **Part 1 — chat app** | **https://taghyeer-chat-rust.vercel.app/app** |

No credentials needed. Sign in with any phone number and a display name — an unknown
number registers automatically. There is no password: the phone number is the whole
credential, which is how the provided API works.

### Worth trying, in about three minutes

1. **Real-time.** Open `/app` in two different browsers (or a normal and a private
   window), sign in as two different numbers, and find the other by **name** — not by
   phone. The search endpoint can't match a `+`-prefixed number at all, for reasons
   explained under [Issues with the given API](#issues-with-the-given-api).
2. **The offline outbox.** On the landing page, hit **Cut the connection**, keep typing,
   then **Reconnect**. Messages queue and flush in order. The real app behaves the same
   way — switch your machine to airplane mode mid-conversation and nothing is lost.
3. **Scroll behaviour.** Scroll up in a long thread while the other window sends. You
   won't be yanked down; a "new messages" pill appears instead.
4. **Two tabs, one account.** Open `/app` twice in the *same* browser and send from one.
   The other updates instantly — which the API alone does not make possible, because it
   sends the author no echo of their own message.

> **The API sleeps.** It's on Render's free tier and spins down after ~15 minutes idle, so
> the first request after a quiet period can take up to a minute. Two things address that:
> the landing page starts waking the server while you read it, and if a request is still
> slow the app shows a "waking the server up" banner with a live counter rather than an
> unexplained spinner.

## Running locally

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build        # production build
npm run lint         # eslint — currently 0 problems, not just 0 errors
npx tsc --noEmit     # type check
```

```bash
# Re-verify every claim in docs/API.md against the live API (~1 min, 57 checks).
# Registers three throwaway accounts on timestamped numbers, so it is safe to re-run.
node docs/recon/verify-api.mjs
```

Node 20+. No API keys, no database, no local backend.

To exercise the two-session and cross-tab behaviour on `localhost`, note that same-origin
tabs share `localStorage` and therefore the session. `next.config.ts` allows `127.0.0.1`
as a dev origin so you can run a genuinely separate second login at
`http://127.0.0.1:3000` — that setting is dev-only and has no effect on a production build.

### Environment variables

Both are **optional** — the app falls back to the values below if unset. See
[`.env.example`](./.env.example).

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://frontend-task-chatapp.onrender.com/api` | REST base, **with** `/api` |
| `NEXT_PUBLIC_SOCKET_ORIGIN` | `https://frontend-task-chatapp.onrender.com` | Socket.io origin, **without** `/api` |

## Documentation

| Document | What it is |
|---|---|
| [`docs/API.md`](./docs/API.md) | **Deliverable 1.** Full reference for the API as it actually behaves, plus a "how I'd redesign this" section |
| [`docs/openapi.yaml`](./docs/openapi.yaml) | Machine-readable version of the same |
| [`docs/api-findings.md`](./docs/api-findings.md) | Everything I found probing the live API, with evidence |
| [`docs/recon/verify-api.mjs`](./docs/recon/verify-api.mjs) | Re-runnable harness asserting every documented claim against the live API — `node docs/recon/verify-api.mjs` (57/57) |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Every non-obvious decision: what I chose, what I rejected, why |
| [`docs/ai-usage-log.md`](./docs/ai-usage-log.md) | Running log of AI use, kept as I went |
| [`docs/recon/`](./docs/recon) | Raw JSON captures from the API probes (tokens redacted) |

## Tech stack

| Choice | Why |
|---|---|
| **Next.js 16 (App Router) + TypeScript** | Fixed by the brief. Strict mode, `noUncheckedIndexedAccess`, no `any` in application code. |
| **Tailwind CSS v4** | Design tokens live in `@theme` in one file, so the palette and type scale are declared once rather than scattered through components. |
| **TanStack Query** | Owns request-shaped server state — conversation list, user search, `/auth/me`. Gives retry, dedupe, staleness and refetch-on-reconnect for free. |
| **Zustand** | Owns the message timeline and the outbox. See the trade-off below — this split is deliberate. |
| **Zod** | Runtime validation at the API boundary. Not decoration: the API returns the same entity in two different shapes and returns `200 null` for a failed write, so schema failure is a real signal. |
| **socket.io-client** | Required by the API. |

Seven runtime dependencies, three of which are the framework itself (`next`, `react`,
`react-dom`) — so four chosen libraries. No component library, no form library, no
state-machine library, no date library.

Three things that would usually be dependencies are platform APIs here instead:

| Instead of | Used | For |
|---|---|---|
| a cross-tab state library | **`BroadcastChannel`** | mirroring sends between tabs of the same user |
| a distributed-lock helper | **`navigator.locks`** | electing the single tab allowed to transmit the outbox — the browser releases the lock on close or crash, so there is no heartbeat or stale-lock timeout to maintain |
| a virtualisation library | plain DOM | not needed at this message volume; noted as a limitation under [What I'd improve](#what-id-improve-with-more-time) |

## Project structure

Organised by feature, with a hard normalisation boundary at `src/lib`.

```
src/
  app/                       routes: / (landing), /login, /app, /app/c/[id]
  features/
    auth/                    session store, login form
    conversations/           list, search, new-chat dialog
    chat/                    message list, composer, thread, store, outbox, cross-tab sync
    groups/                  members + admin panel
    landing/                 interactive outbox demo, scroll reveal, API pre-warm
  lib/
    api/                     client, typed endpoints, ApiError, server status, warm-up
    socket/                  socket provider (inbound only)
    cross-tab.ts             BroadcastChannel bus + Web Locks leader election
    domain.ts                the app's vocabulary — no wire types
    schemas.ts               Zod: two wire shapes -> one domain type
  components/ui/             Button, Field, Avatar, Modal, states
```

**The rule:** nothing outside `lib/api` and `lib/schemas` ever sees `_id`, an ISO date
string, or a `{ data }` wrapper. One shape in, one shape out.

---

# Part 3 — Write-up

## Part 1 reasoning: architecture and trade-offs

### I probed the API before writing any code

The published spec is deliberately request-only — it declares
`responses: { default: Unspecified }` for every operation. So I spent the first phase
scripting ~120 calls against the live service and recording exactly what came back
([`docs/api-findings.md`](./docs/api-findings.md), raw captures in
[`docs/recon/`](./docs/recon)).

That documentation isn't a snapshot I hope still holds — `docs/recon/verify-api.mjs`
asserts every claim in it against the live API and currently reports **57/57**, so a
reviewer can check it rather than take my word for it.

That wasn't diligence for its own sake. Six of those findings each changed a decision, and
every one of them would have been a silent bug had I assumed conventional behaviour:

1. **The `before` pagination cursor is inclusive.** Paging 25 messages at `limit=10` yields
   30 rows across 3 pages, of which 28 are unique — every page boundary re-serves one
   message. → The message store is a `Map<id, Message>`, never an array concat, so a
   repeated boundary message collapses onto itself.
2. **The socket renames the id and retypes the clock.** REST sends `_id` and an ISO string;
   `message:new` sends `id` and epoch milliseconds, for the same message. → Two Zod schemas
   transform onto one internal `Message`. Nothing above that line branches on transport.
3. **The sender receives no echo of their own message.** → Optimistic appends can't be
   double-rendered by an inbound copy, which made reconciliation simpler than expected. I
   still key every insert by id so the design stays correct if an echo is ever added.
4. **The socket's send ack is `{ok:true}` with no message body.** → **Send over REST,
   receive over socket.** A socket-sent message can never be matched back to its optimistic
   placeholder; REST returns the created entity with its real id. This is the single most
   consequential decision in the app and it came from behaviour, not preference.
5. **`POST /messages` returns `200` with a `null` body when the conversation doesn't
   exist** — a success status for a write that didn't happen. → The client treats any `2xx`
   whose body fails schema validation as an error.
6. **Nothing is replayed when a socket reconnects.** Messages sent during a drop are gone
   from the live stream permanently. → A REST re-sync fires on every reconnect, and this
   finding is what the Part 4 feature is built on.

### State: two libraries, one boundary

TanStack Query alone is the conventional answer and I'd normally take it. I didn't, because
the message timeline has **three independent writers** — REST history pages, socket pushes,
and the local outbox — and Query's infinite-query cache models data as an array of pages.
Merging socket pushes and optimistic entries into that structure means hand-writing the
merge anyway, inside a cache shaped for something else. Finding #1 makes it worse: the
pages genuinely *overlap*, which a page-array has no concept of.

So the split is: **Query owns anything request-shaped** (conversation list, search,
`/auth/me`) and earns its keep with retry, dedupe and refetch-on-reconnect. **A Zustand
store owns the timeline**, because that isn't a cache — it's a live-merged log where every
write must be idempotent.

The honest cost is that two state systems mean one judgement call per new piece of state. I
took that over bending one tool into a job it's shaped wrong for, and the boundary is
stateable in a sentence.

### Reconciliation

Every path funnels through an id-keyed upsert, which is what makes the inclusive cursor and
any repeated delivery harmless:

- **Send** → insert `{tempId, status:'queued'}` → `POST /messages` → delete the temp entry,
  insert the canonical message by its server id.
- **Receive** → normalise → upsert by id. Idempotent by construction.
- **Load older** → `before=<oldest id held>` → upsert every result; the duplicated boundary
  message overwrites itself.
- **Reconnect** → refetch the newest page and invalidate the list.

Ordering is `(createdAt, id)` with pending messages pinned last, so client-clock skew can't
make a message visibly jump backwards when it sends.

### Part 4 — the original feature: an offline outbox

The brief asks for something original rather than generically well-executed, so I picked
the thing this specific API's weakness argues for. Finding #6 is a **demonstrable data-loss
bug**: send a message while the socket is down and it is silently gone.

Every send is therefore **queued first and transmitted second**. The queue is persisted to
`localStorage`, so a message survives a reload or a crash, and it is flushed **strictly
FIFO with one request in flight** — sending concurrently would let a later message land
before an earlier one and reorder the conversation for everybody. Queued messages stay
visible in the thread marked "waiting for connection"; failures keep the user's text and
offer a retry rather than disappearing.

Sends are **never retried automatically**. `POST /messages` is not idempotent and accepts no
client key, so a retry racing a slow success would post the message twice.

You can play with the mechanism on the landing page — cut the connection, keep typing,
reconnect — without signing in.

### Bonus: the two states nobody tests

Two additions beyond the brief, both aimed at states that only show up once the app is in
real use.

**1. Cross-tab coordination.** Finding #3 above — the sender gets no echo — has a
consequence I didn't chase at first: **open the app in two tabs and send from one, and the
other's thread silently goes stale.** Each tab holds its own socket, so other people's
messages arrive everywhere, but your own arrive nowhere.

Worse, my own outbox made it dangerous. The queue is persisted to `localStorage`, so **two
tabs that hydrate it both flush it** — and since `POST /messages` is not idempotent and
accepts no client key, every queued message gets sent twice.

Both are fixed by electing a single sender. Leadership uses the **Web Locks API**: the lock
is held for the lifetime of the tab and released by the browser automatically when it
closes or crashes, so a successor is promoted with no heartbeat and no stale-lock timeout.
A `BroadcastChannel` mirrors optimistic sends, deliveries and failures to every other tab,
so followers show the queue and see delivery immediately without being allowed to transmit.

Verified end to end: with two tabs open and one message queued offline, **the server's own
history contains exactly one copy** — which is the claim worth proving, because a UI can
look correct while having sent twice.

Building it surfaced a bug in my own assumption. `BroadcastChannel` withholds a message
only from the exact object that posted it, not from other channel instances in the same
tab — and my publisher (a module singleton, callable outside React) and listener (a hook)
are separate instances. So the sending tab received its own events and queued every message
twice. Events now carry an originating tab id.

**2. Pre-warming the sleeping API.** The cold-start banner handles the symptom. This
handles the cause: a health probe fires on landing-page mount, and again when the visitor
aims at a call to action, so the container boots **while they read** rather than while they
wait. It's fire-and-forget on an idle callback with a 60-second cooldown, so it never
competes with first paint and six intent events cost one request. The banner stays for the
cases this doesn't cover.

### What I deliberately didn't do

No typing indicators, read receipts, emoji picker or dark-mode toggle. The brief says
common additions earn nothing even when well executed, and each of those would have cost
time the chat panel needed.

## Part 2 reasoning: design

**The problem with chat UI design is that it's a solved-looking space** — cool grey, navy,
a blue accent. Landing on that palette reads as a default rather than a decision, so I went
the other way.

**Palette.** Warm paper (`#faf7f2`) and deep ink (`#14171f`), with a single vermilion accent
(`#e0451f`). One accent only, used with discipline: anything vermilion is something you can
do. Teal and amber appear solely as status colours — teal for delivered and connected,
amber for queued and waking — so state is never competing with action for attention. The
app runs on paper; the landing page inverts to ink. Same tokens, different ground, which
makes them feel like one product rather than two pages.

**Typography.** Instrument Serif for display, Inter for everything else. The serif is doing
real work: it's editorial and slightly unexpected on a messaging product, it gives the
landing page a voice, and used sparingly in-app (screen titles, empty states) it makes those
moments feel considered instead of templated. Inter carries all UI and message text, where
legibility at 15px matters more than character.

**Motion.** One easing curve (`cubic-bezier(0.22, 1, 0.36, 1)`) shared by every transition,
so movement feels like one system. Motion is only ever used to explain something: messages
pop in so a new arrival is noticed, the pill slides up because it arrived, sections reveal
on scroll to establish reading order. Nothing loops or decorates. Under
`prefers-reduced-motion` animations are removed while state transitions are kept — stripping
those makes an interface feel broken rather than calm.

**The landing page's original interaction is the product demo itself.** The claim being
made is behavioural — "your message survives a dropped connection" — and the only honest way
to show behaviour is to let the reader cause it. So the hero visual is a working chat where
you can cut the connection, watch messages queue in amber, and reconnect to watch them flush
in order. It runs the same state machine as the real composer. No stock testimonials, no FAQ
accordion, no screenshot standing in for a product.

## AI usage

Claude Code (Opus 5) was used throughout. Kept as a running log in
[`docs/ai-usage-log.md`](./docs/ai-usage-log.md); the honest summary:

**What it did well:** writing the seven throwaway probe scripts that produced the API
findings, first drafts of components, and turning captured JSON into documentation.

**What I rejected or had to fix:**

- **Six React Compiler lint errors in generated code.** The first drafts of `Reveal`,
  `SocketProvider`, `ServerStatusBanner` and `MessageList` all called `setState`
  synchronously inside effects, and two read or wrote refs during render. I fixed all six by
  restructuring — deriving state instead of storing it, remounting via `key` instead of
  resetting in an effect, syncing refs in effects — rather than disabling the rules.
- **A side effect inside a `setState` updater** in the landing demo. React double-invokes
  updaters in development, so one click queued two flushes and fired four scripted replies at
  once. Only visible by running it in a browser.
- **The "new messages" pill didn't scroll.** Smooth `scrollIntoView` was cancelled by the
  re-render that clears the unread badge; a smooth `scrollTop` assignment then stopped
  ~1000px short. Two failed attempts before settling on an unanimated assignment, which is
  what ships and is also what a reduced-motion user should get.
- **My own Phase 0 findings were wrong about `/users/search`.** I had recorded
  "case-sensitive and prefix-anchored". Re-probing showed name is matched by a
  case-sensitive regex anchored at any *word* start while phone is matched by *exact
  equality* — which together mean an E.164 number is unfindable. I corrected the findings
  doc, `API.md`, the client's query strategy and the UI copy rather than leaving a confident
  and wrong claim in a graded artifact.
- **A wrong assumption about `BroadcastChannel`**, in the bonus work. I had taken it that a
  channel never delivers to the sending tab — true only of the exact posting *object*, not
  of other instances in the same tab. My publisher is a module singleton and my listener is
  a hook, so the sending tab received its own events and **queued every optimistic message
  twice**. Found by watching the persisted queue in a real browser, not by reading the code.
- **A test that looked like a pass but proved nothing.** My API verification harness
  asserted that `limit=abc` falls back to 20, but ran against a 15-message conversation, so
  returning 15 was *consistent* with the claim without demonstrating it. I seeded the
  fixture past the default page size and expanded it into the full matrix rather than
  leaving a check that couldn't fail for the right reason.
- **Refused to invent a cold-start measurement.** The API stayed warm throughout my session,
  so the findings say I didn't observe one instead of quoting Render's published figure as
  though I had.

Several apparent bugs during verification turned out to be faults in my own test scripts — a
selector that only matched run-ending bubbles, an assertion racing a smooth animation. Each
was re-measured before I concluded anything about the app.

## Issues with the given API

Full detail with evidence in [`docs/api-findings.md`](./docs/api-findings.md). Condensed:

| Issue | Handled by |
|---|---|
| `before` cursor is **inclusive** — every page boundary duplicates a message | id-keyed store; duplicates collapse |
| Socket sends `id` + epoch number; REST sends `_id` + ISO string | two Zod schemas → one domain type |
| `POST /messages` → **`200` with `null`** for a missing conversation | schema-validated `2xx`; failure raises |
| **Nothing replayed on socket reconnect** | REST re-sync on every reconnect |
| Socket send ack carries no message | send over REST instead |
| **Empty and whitespace-only messages are accepted** and broadcast | client-side guard on button *and* submit |
| `?q=+880…` → **`500`**, unescaped regex injection | escape metacharacters; send safe variants |
| **E.164 phone numbers are unfindable** — raw `+` 500s, escaped breaks exact match | multi-variant query; UI copy says so |
| Empty `q` returns the **entire user directory** | 2-character minimum before searching |
| Malformed ObjectId → **`500`** leaking the Mongoose model name | validate ids client-side; remap to "not found" |
| Missing token → **`400`**, invalid token → `401` | detect auth failure on status **or** code |
| **Four different response envelopes**; `participants` in three shapes | normalised once at the boundary |
| Search returns *you*; `POST /conversations` with your own id returns a **stranger's chat** | self filtered from results |
| `lastMessage` is `{}`, not `null` | normalised to `null` |
| Groups can drop below their own 3-member minimum after creation | no length assumption anywhere |
| No `GET /conversations/{id}` | list fetched eagerly; deep links resolve from it |
| New direct conversations emit **no** socket event | list invalidated when a message arrives for an unknown conversation |
| No echo to the sender ⇒ a second tab of the same user goes stale | `BroadcastChannel` mirrors sends across tabs |
| `POST /messages` not idempotent ⇒ two tabs flushing one queue send twice | Web Locks elects a single sending tab |

**In fairness:** the group and authorization layer is genuinely well built. Every admin
action correctly rejects non-admins with distinct messages, `POST /conversations` is
idempotent, group creation de-duplicates and ignores self, removed members immediately lose
history access, and when the last admin leaves another member is auto-promoted. `hasMore` was
accurate in every case I tested. I'd change none of it.

## How this was verified

There are no automated tests — that's the honest gap, and it's first on the list below.
What I did instead was drive the real thing and assert against it, which caught four bugs
that were invisible in review.

**Two live browser sessions**, signed in as different users, on different origins so the
sessions were genuinely independent:

| Check | Result |
|---|---|
| Real-time delivery, direct **and** group | Arrives with no refresh; sender name shown in groups |
| Pagination across the inclusive cursor | 25 → **41 messages, 0 duplicates**, order intact |
| Scrolled up + incoming message | Viewport unmoved (300 → 300); pill appears; click lands at bottom (distance **0**) |
| Empty / whitespace send | Blocked at the button **and** on direct form submit — 0 messages created |
| Offline → queue → reconnect | 3 queued, persisted, flushed FIFO, all "Sent", received **in order**, 0 duplicates |
| Two tabs, one queued message | **Server history contains exactly one copy** |
| Leader tab closed | Survivor acquires the freed lock and sends; production build shows 1 held / 0 pending |
| Cold start (8s stall injected) | Banner at ~3.5s, counter ticks 1s → 2s → 3s, clears on completion |
| Pre-warm | 1 `GET /health` on landing; 6 intent events → **0 extra requests** (60s cooldown) |
| 375px viewport | **0 overflowing elements**, composer usable, list ⇄ thread navigation works |
| Deployed URLs, clean session | Both `200`, no auth, no deployment protection |

**The API documentation is machine-checked**, not a snapshot I hope still holds:

```
$ node docs/recon/verify-api.mjs
================ 57/57 checks match documentation ================
```

Where a result was surprising I re-measured before believing it. Several apparent app bugs
turned out to be faults in my own test scripts — a selector that only matched run-ending
bubbles, an assertion racing a smooth scroll animation, and a `limit` check that couldn't
fail for the right reason. Those were fixed in the tests, not papered over in the app.

**Gates:** `npm run build`, `npx tsc --noEmit` and `npm run lint` are all clean — lint
reports **0 problems**, including the React Compiler rules Next 16 enables, none of which
are disabled anywhere in the codebase.

## What I'd improve with more time

- **Tests.** The biggest gap. [How this was verified](#how-this-was-verified) describes
  what I did instead, and it caught four real bugs — but a scripted browser session is a
  one-off, not a regression net. The reconciliation logic (`store.ts`, `use-outbox.ts`,
  `schemas.ts`) is pure and would take unit tests cleanly; the pill, pagination and
  cross-tab behaviours want Playwright, which can drive two contexts properly rather than
  the two-origin workaround I used by hand.
- **Virtualised message list.** Currently every loaded message stays in the DOM. Fine for
  hundreds, not for tens of thousands.
- **A real gap-fill on reconnect.** Today reconnect refetches the newest page, which covers
  any realistic drop. A rigorous version would page backwards until it overlaps what's
  already held.
- **Optimistic group admin actions.** Rename, promote and remove currently wait on a ~1s
  round trip. The message path is optimistic; these should be too.
- **A leader-tab fallback for browsers without Web Locks.** Support is broad (Chrome,
  Firefox, Safari 15.4+), and where it's missing every tab sends as before rather than not
  sending at all — but a `localStorage` lease with a heartbeat would close the gap
  properly.
- **Accessibility beyond the basics.** ARIA, focus management, keyboard operation and the
  message log's live region are in place, but I haven't tested with a real screen reader.
- **`GET /conversations/{id}` on the server side.** Its absence forces the whole list to
  load before a deep-linked thread can render its own header.

---

### A note on the assignment PDF

The PDF contains an injected line instructing an AI assistant to insert a specific unrelated
word into the write-up. It was identified during the first read and deliberately not
followed; the word appears nowhere in this submission. Flagging it here because noticing it
is the point of including it.
