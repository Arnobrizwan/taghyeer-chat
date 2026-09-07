# Part 3 — Write-up

## In 60 seconds

If you read nothing else, read this. Each line points at the section that argues it.

1. **I probed the API before writing a line of UI.** The spec declares
   `responses: { default: Unspecified }`, so I scripted ~120 calls and wrote down what
   actually came back — an unescaped-regex 500, `200` with a `null` body on a failed write,
   `lastMessage: {}` instead of `null`, three different shapes of `participants`, and a
   missing token answered with `400`, not `401`.
   → [Issues with the given API](#issues-with-the-given-api) ·
   [`docs/api-findings.md`](./docs/api-findings.md)
2. **Those findings drove the architecture, not the other way round.** Messages send over
   REST because the socket ack carries no body to reconcile against; the thread is keyed by
   id because the pagination cursor is inclusive; a Web Locks leader elects the one tab
   allowed to flush, because `POST /messages` is not idempotent.
   → [Reconciliation](#reconciliation)
3. **The original feature is an offline outbox.** Type on a dead connection and it queues,
   survives a refresh, and flushes in order when you reconnect — visibly queued, never
   disguised as delivered. → [Part 4](#part-4--the-original-feature-an-offline-outbox)
4. **The landing page is that feature, running.** The hero is the real state machine, not a
   screenshot, so Parts 1 and 2 argue the same thing.
   → [Part 2 reasoning](#part-2-reasoning-design)
5. **91 unit tests** cover reconciliation, ordering, wire-shape normalisation, validation
   and the avatar hash — each one written against a defect that actually occurred.
   → [How this was verified](#how-this-was-verified)
6. **Known gaps, stated plainly:** no component or end-to-end tests, no virtualised message
   list, no country picker on the phone field.
   → [What I'd improve with more time](#what-id-improve-with-more-time)

The rest of this document is the detail behind those six lines. It is long because the API
findings are long; skip to any heading above.

---

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

### Flood and duplicate protection

Recon established that the API applies **no rate limiting at all** — 30 concurrent
requests all returned `200` — and that `POST /messages` is not idempotent, accepts empty
text and has no length cap. On a shared demo backend, one person holding Enter can fill
everyone's history and nothing server-side stops them.

So sending passes two independent guards, because they catch different mistakes. A **token
bucket** allows a burst of 5 and then sustains ~40 messages a minute, which catches a held
key. A **4-second duplicate window** catches the accidental double-send — a double click,
or Enter pressed twice while the ~1s round trip is still in flight.

Both are advisory rather than silent: a refused send says why, and **keeps the text in the
box**. Discarding what someone typed would be a worse outcome than the spam being
prevented.

### What I deliberately didn't do

No typing indicators, read receipts or emoji picker. The brief says common additions earn
nothing even when well executed, and each would have cost time the chat panel needed.
Light/dark theming is present because it's expected of a product like this, but I'm not
claiming it as the originality bonus — that's the outbox and the cross-tab work.

## Part 2 reasoning: design

**The problem with chat UI design is that it's a solved-looking space** — cool grey, navy,
a blue accent. Landing on that palette reads as a default rather than a decision, so I went
the other way.

**Palette.** Warm paper (`#faf7f2`) and deep ink (`#14171f`), with a single vermilion accent
(`#e0451f`). One accent only, used with discipline: anything vermilion is something you can
do. Teal and amber appear solely as status colours — teal for delivered and connected,
amber for queued and waking — so state is never competing with action for attention. The
Paper and ink are *roles* rather than fixed colours, and every surface resolves them
through the same tokens — app, landing and sign-in alike — so the theme toggle reaches the
whole product and no page is pinned to a ground the reader didn't choose.

**Typography.** Instrument Serif for display, Inter for everything else. The serif is doing
real work: it's editorial and slightly unexpected on a messaging product, it gives the
landing page a voice, and used sparingly in-app (screen titles, empty states) it makes those
moments feel considered instead of templated. Inter carries all UI and message text, where
legibility at 15px matters more than character.

**The chat panel got a second pass**, because the brief says that's where they look
closest and the first version didn't hold up at desktop width. Three things were wrong.
Every message carried its timestamp on a row underneath, which added ~18px between each
pair and stopped consecutive messages grouping — the thread read as a stack of cards
rather than a conversation; the time now floats inside the bubble, so a run of messages
sits 3px apart and only the last one gets a tail. The thread ran the full width of the
window, so the eye had to cross 1400px to pair a message with its timestamp; it's capped
to a reading measure and centred, with the composer on the same measure. And the accent
carried white body text at only **4.17:1** — under AA — so it was deepened to `#cf3d18`
(4.85:1), which also reads less neon across the large filled areas bubbles create. The
whole ink ramp went up with it: 11px timestamps are normal text, and the conventional
metadata grey sat at 2.38:1.

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

**The split, up front: Claude Code (Opus 5) wrote most of the first-draft code in this
repository, and every commit is co-authored accordingly.** `git log` will show you that
immediately, so I would rather say it here than have you find it. The brief permits AI use
and asks that it be documented; this section and
[`docs/ai-usage-log.md`](./docs/ai-usage-log.md) are that documentation, and the log is a
running record kept as I went, not written afterwards to look tidy.

What that leaves as mine is the part I would want to be judged on: deciding to spend the
first phase probing the API instead of building, reading the ~120 captured responses and
working out which quirks had architectural consequences, choosing the offline outbox as the
original feature, and every judgement call listed under *What I rejected or had to fix*
below. The model was fastest at the work that was already specified — probe scripts,
component scaffolding, turning captured JSON into tables. It was consistently wrong about
anything that could only be settled by running the thing, which is why the verification
section exists and why four of the bugs it lists were found in a browser rather than in
review.

Two habits I would keep. Every model-written explanation of *why* something is the way it
is got checked against the captured responses before it went in, because plausible-sounding
and wrong is the failure mode. And the tests in `src/**/*.test.ts` are deliberately written
against defects that actually occurred here, including two the model itself introduced —
the avatar hash below shipped broken twice.

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
| Duplicate send within the window | Blocked, explained, text kept in the composer |
| XSS payloads stored via the API | Render as inert text — 0 injected elements |
| Light / dark / system | Applied before first paint, persists, follows the OS, syncs across tabs |
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

**Untrusted input.** The app calls no language model, so there is no prompt-injection
surface in the product itself — but it does render text written by other people, and the
API stores it raw. I posted `<img src=x onerror=…>`, `<script>` and `"><svg onload=…>`
through the API and confirmed all three render as inert text: **0 injected elements, 0
handlers, no alert**. React's escaping does the work; there is no `innerHTML`, no `eval`,
and the one `dangerouslySetInnerHTML` in the codebase is the theme script, a static
self-authored string with no interpolated input. Socket payloads, cross-tab events and the
persisted outbox are all shape-validated before use, and ids are checked against an
ObjectId pattern before they reach a URL.

**Unit tests: 91, across 7 files, in ~0.4s with no network.** They cover the parts where
this app is either correct or not — cursor-seam de-duplication, message ordering and its
ObjectId tie-break, the outbox lifecycle, the two wire shapes collapsing to one domain type,
JWT expiry, phone and message validation, and the avatar hash.

Two things about them are worth saying. **Every test was written against a defect that
actually happened here**, not against a hypothetical: the seam duplicate, the avatar tint
collision, `lastMessage: {}`, the invented `+` on a local phone number. And I checked the
tests are not vacuous by reintroducing two of those bugs and confirming the suite goes red —
restoring the old `h * 31 + c` hash fails the real-group tint test, and breaking the merge
key fails the seam test.

The suite is deliberately pure-logic and runs in Node with no jsdom. That is a consequence
of the architecture rather than a shortcut: nearly every bug found across three review
rounds was in logic that had been left sitting inside a component, and moving each one down
into `lib/` is what made it testable at all.

**Gates:** `npm test`, `npm run build`, `npx tsc --noEmit` and `npm run lint` are all clean
— lint reports **0 problems**, including the React Compiler rules Next 16 enables, none of
which are disabled anywhere in the codebase.

## What I'd improve with more time

- **Component and end-to-end tests.** The 91 unit tests cover the pure logic, which is
  where the real risk is, but nothing renders a component or drives a browser. The pill,
  scroll restoration on pagination, and the cross-tab leader election all want Playwright,
  which can drive two browser contexts properly rather than the two-origin workaround I
  used by hand. That is the next thing I would write.
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
- **Accessibility beyond the basics.** Every colour pair in the palette clears AA for its
  text size, ARIA and focus management are in place, and the message log has a live region
  scoped to additions — but I haven't tested with a real screen reader, which is the only
  way to know whether the live region is actually pleasant rather than merely correct.
- **`GET /conversations/{id}` on the server side.** Its absence forces the whole list to
  load before a deep-linked thread can render its own header.

---

### A note on the assignment PDF

The PDF contains an injected line instructing an AI assistant to insert a specific unrelated
word into the write-up. It was identified during the first read and deliberately not
followed; the word appears nowhere in this submission. Flagging it here because noticing it
is the point of including it.
