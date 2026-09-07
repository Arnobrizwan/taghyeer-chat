# Decisions

One line per non-obvious decision: **decision — alternative rejected — why.**
Newest at the bottom of each phase. Feeds the Part 3 write-up.

## Phase 0 — Recon

- **Probe the live API with scripted Node runs before writing any code** — reading the Swagger page and assuming conventional REST — the spec documents zero response bodies and zero status codes, so every shape had to be observed; this surfaced six behaviours (§1 of `api-findings.md`) that would each have been a silent bug.
- **Send messages over REST, receive over socket** — sending over `message:send` — the socket ack is `{ok:true}` with no message body, so a socket send can never be reconciled with its optimistic placeholder; REST returns the full created message including `_id` and `createdAt`.
- **Key the message store by id (`Map<id, Message>`) rather than an array** — appending to an array — the `before` cursor is inclusive, so every pagination boundary re-serves one message; id-keying makes the duplicate collapse instead of render.
- **Normalise both transports onto one internal `Message` type at the API boundary** — using the raw payloads and branching at render time — REST sends `_id` + ISO string, the socket sends `id` + epoch number for the same entity; normalising once means no component ever sees two shapes.
- **Treat a 2xx whose body fails schema validation as an error** — trusting the status code — `POST /messages` returns `200 null` for a non-existent conversation, so status alone reports a failed write as success.
- **Detect session expiry on `401 || code === 'NO_TOKEN'`** — checking `401` alone — a missing token returns `400 NO_TOKEN`, so status-only detection misses half of all auth failures.
- **Every authed query is gated on `status === 'authenticated'`, and the socket on a locally-unspent JWT** — letting them mount and fail — hooks can't be called conditionally, so `AppShell` starts its conversations query above its own session guard, before `Providers` has hydrated the token from `localStorage` (child effects run before parent ones). Ungated, the first request of every cold load went out unauthenticated and came back `400 NO_TOKEN`. The JWT rule lives in `lib/jwt` so the session and the socket cannot drift apart on it.
- **The login page mounts `Providers` with the socket switched off** — letting every route's provider open one — `/login` and `/app` each mount their own `Providers`, so signing in opened a socket on the login page that the redirect then closed mid-handshake ("WebSocket is closed before the connection is established"), leaving `/app` to start again from nothing. Against a cold Render instance that throws away the slowest part of the boot.
- **Store raw recon captures in `docs/recon/` with JWTs redacted** — keeping them in a scratch dir — the findings doc makes strong claims about the API; the evidence should be checkable by a reviewer.

## Phase 2 — Skeleton

- **TanStack Query for request-shaped state, a Zustand store for the message timeline** — one library for everything — the timeline has three independent writers (history pages, socket pushes, the outbox) and an *overlapping* page cursor, which is precisely what Query's array-of-pages cache models worst; the conversation list and search are ordinary requests and get retry/dedupe/refetch-on-reconnect for free.
- **`request()` is a plain module wired to the session via a token-provider callback** — a `useApi()` hook — the outbox flusher runs outside React's tree and still needs authenticated calls.
- **A `2xx` whose body fails Zod validation raises `ApiError`** — trusting status codes — `POST /messages` answers `200` with `null` for a non-existent conversation.
- **Two Zod schemas (REST + socket) transforming onto one `Message`** — a single loose schema — the transports genuinely disagree on both field name and timestamp type; normalising once means nothing above the boundary branches.
- **`ApiError.kind` rather than raw status codes** — branching on `err.status` at call sites — auth failure spans `400` and `401`, and a malformed id arrives as `500`, so status alone is not a usable signal.
- **Cast-error `500`s are remapped to a friendly "not found"** — surfacing the server message — the raw text leaks the Mongoose model name and is meaningless to a user.

## Phase 3 — Features

- **Warm-latency-aware caching (`staleTime: 30s`)** — aggressive refetching — every request costs ~1s even warm, so casual refetches are expensive.
- **Search is not issued below 2 characters** — searching on every keystroke — an empty `q` returns the entire user directory.
- **Self is filtered from search results** — leaving the API's response as-is — the API returns you, and selecting yourself opens an unrelated conversation via the `$all: [me, me]` bug.
- **Existing direct conversations are resolved from the local list before calling the API** — always POSTing — the endpoint is idempotent so both work, but the local path avoids a ~1s round trip and reads as "open" rather than "create".
- **Admin-only controls are not rendered for non-admins** — rendering them and surfacing the 403 — the API enforces this correctly; a button that always fails is worse than no button.
- **`MessageList` is remounted per conversation via `key`** — resetting scroll state in an effect — a new conversation is genuinely new state, and this removed a `setState`-in-effect the React Compiler lint correctly rejected.
- **"Pinned to bottom" is a ref, not state** — `useState` — nothing renders from it and it changes every scroll frame; as state it re-rendered the whole list on every scroll.
- **The jump-to-latest scroll is instant, never animated** — smooth scrolling — verified twice in-browser that animated scrolling silently failed to land (see `ai-usage-log.md`); for the one scroll behaviour the brief names explicitly, landing reliably beats animating.
- **`searchUsers` sends several safe query variants and merges them** — a single escaped query — escaping prevents the `500` but breaks the endpoint's exact-equality phone match, so a raw variant is also sent whenever it contains no regex metacharacters.

## Phase 4 — Offline outbox

- **Every send is queued first and transmitted second** — sending directly and queueing only on failure — a single path means a message can never be lost between "typed" and "failed", including across a reload.
- **The queue is persisted to `localStorage` and flushed strictly FIFO, one in flight** — parallel flush — concurrent sends would let a later message land first and reorder the conversation for everyone.
- **Sends are never retried automatically after an ambiguous failure** — automatic retry — `POST /messages` is not idempotent and takes no client key, so a retry racing a slow success posts twice; the user gets an explicit Retry instead.

## Phase 5 — Landing

- **Warm paper/ink with a single vermilion accent** — the usual cool-grey or dark-navy chat palette — one accent means anything vermilion is always actionable, and the warmth reads as chosen rather than defaulted.
- **The product visual is a working demo, not a screenshot** — a static image — the claim being made is behavioural ("your message survives a drop"), and the only honest way to show behaviour is to let the reader cause it.
- **Reveal animations use IntersectionObserver with no reduced-motion branch** — a JS check for `prefers-reduced-motion` — the global stylesheet already collapses transition durations, so one code path serves both.

## Phase 7 — Verification

- **`allowedDevOrigins` for `127.0.0.1` and the LAN IP** — testing both sessions on one origin — same-origin tabs share `localStorage` and therefore the session; two origins give two genuinely independent logins. Dev-only, no effect on the production build.

## Bonus — cross-tab coordination + API pre-warming

- **One elected leader transmits the outbox, via the Web Locks API** — every tab flushing its own copy — the queue is shared through `localStorage`, so two tabs that hydrate it both send every entry, and `POST /messages` is not idempotent. Web Locks releases automatically when a tab closes or crashes, so a successor is promoted with no heartbeat and no stale-lock timeout to tune.
- **Cross-tab events carry an originating tab id** — relying on `BroadcastChannel` not echoing to the sender — it only withholds a message from the exact posting *object*, not from other channel instances in the same tab; the publisher here is a module singleton and the listener is a hook, so a tab did receive its own events and enqueued every optimistic message twice. Caught in the browser, not in review.
- **Followers mirror the queue but never transmit** — leaving pending messages visible only in the tab they were typed in — the mirrored copy is what makes a second tab truthful, and the leader check happens at send time.
- **Leadership is re-checked inside the flush loop, via a ref** — checking once on entry — a tab demoted mid-drain must stop immediately, and putting `isLeader` in `flush`'s dependencies would re-create it and lose the in-flight guard.
- **Pre-warm the API on landing-page mount and on CTA intent** — only handling the cold start once it happens — the boot can run while the visitor reads instead of while they wait; the banner stays for the cases this misses.
- **`warmUp()` is fire-and-forget with a 60s cooldown** — pinging on every hover — six intent events across three CTAs must cost one request, not six, and a warm-up failure is not worth reporting because the real request will report it properly.
- **Probe scheduled via `requestIdleCallback`** — firing it during mount — waking a server must never compete with first paint.

## Design pass — chat panel refinement

- **Timestamp floated inside the bubble, not on a row beneath it** — a meta row under every message — the row added ~18px between each pair, which defeated run-grouping entirely and made the thread read as a stack of cards rather than a conversation. Floated rather than absolutely positioned over a fixed-width spacer: the spacer has to guess the rendered width of the time, and when it guesses low the text runs underneath it.
- **Tails only on the last bubble of a run; 3px within a run, 12px between runs** — a uniform gap and a tail on every bubble — consecutive messages from one person should read as one block of speech.
- **Thread capped at `max-w-3xl` and centred** — full-width bubbles — on a 1440px window the eye has to cross the whole screen to pair a message with its timestamp. The composer is capped to the same measure so the two columns line up.
- **Accent deepened from `#e0451f` to `#cf3d18`** — keeping the brighter tone — white body text on the original was **4.17:1**, under AA; it is 4.85:1 now. Message bubbles are large filled areas, so the deeper tone also reads less neon.
- **Whole ink ramp raised so the faintest step still clears 4.5:1** — a conventional light grey for metadata — timestamps are 11px normal text, and `#9ca3af` sat at **2.38:1**. Teal moved from `#0f9488` (3.5:1) to `#0d7f74` so "Connected" is legible as text rather than decoration.
- **Active conversation marked with a left rule, not only a tint** — background tint alone — a tint is indistinguishable from hover when the pointer happens to be resting on a row.
- **Both headers pinned to `h-16`** — intrinsic heights — the sidebar and thread rules have to meet exactly across the split, and they did not.
- **Sign-in is a single centred column, and the landing page runs on the same paper/ink roles as the app** — rather than either one being pinned to a fixed dark ground — a page that ignores the theme toggle reads as a different product, not a bolder one; the demo in the hero already restates what makes this app different, so a decorative panel was only competing with it.
- **The landing demo's bubbles rebuilt to match the app exactly** — leaving the demo on its original styling — the landing page is showing the product, and a reviewer clicking through would land somewhere that looks unrelated.

## Theming and anti-spam

- **Tokens named by role, switched with `@theme inline`** — a duplicate set of dark class names — `paper` means "the page surface" and `ink` means "what reads on it", so every component keeps one set of classes and the palette re-resolves from a single attribute on `<html>`.
- **Theme applied by a blocking inline script, before paint** — reading `localStorage` in an effect — the effect approach paints light first and snaps to dark, which is the flash every themed site gets wrong.
- **Three states (light / system / dark), not a binary toggle** — a two-state switch — a binary control cannot express "follow my OS", which is the setting most people actually want and the one it silently overwrites the moment it is touched.
- **`useSyncExternalStore` for the theme** — `useState` + an effect — the theme lives in `localStorage` and on the DOM, both outside React and both changeable from another tab; this is what that hook is for, and it makes cross-tab theme sync fall out for free.
- **Only the modal scrim uses a fixed token; every page surface is themed `paper`/`ink`** — pinning the landing hero and login panel dark as well — a page that ignores the theme toggle reads as a different product, not a bolder one. The scrim is the real exception: left themed it lightened the screen instead of dimming it.
- **Sparse threads pinned to the bottom (`min-h-full` + `justify-end`)** — top alignment — three messages stranded above a large empty panel read as a loading failure, which is exactly how the landing demo looked.
- **Flood protection is a token bucket, duplicates a separate time window** — one combined rule — a burst of five is normal typing while five identical sends is a stuck key, and conflating them either blocks real use or misses the common mistake.
- **A refused send keeps the user's text and says why** — clearing the box, or failing silently — the send was refused, not delivered; discarding what someone typed is a worse outcome than the spam.
