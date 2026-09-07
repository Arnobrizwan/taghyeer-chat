# Decisions

This is the running log of every choice I made that wasn't obvious, kept as I went rather
than reconstructed afterwards. For each one: what I decided, what I turned down, and why.
It's written the same way as the [write-up](./WRITEUP.md) — plain language, technical words
explained the first time — so it can be read without knowing the codebase.

The order is chronological within each phase, so you can see where I changed my mind.

---

## Phase 0 — probing the API before building

**I spent the first phase calling the live API by hand instead of writing app code.** The
alternative was to read the published documentation, assume it behaved like most APIs do,
and start building. I didn't, because that documentation describes zero response bodies and
zero status codes — it genuinely says "unspecified" for every operation. Every shape had to
be observed rather than read. That turned up six behaviours, catalogued in
[`api-findings.md`](./api-findings.md), each of which would otherwise have become a bug I'd
have spent hours blaming on my own code.

**Messages are sent as ordinary requests and received over the live connection**, rather
than doing both over the live connection. The live connection is the always-open pipe that
lets the server push things to you. Sending down it looked neater, but its confirmation is
just "OK" with no message attached — no id, no timestamp — so there'd be nothing to match
against the temporary copy the app shows you while a message is in flight. The ordinary
request returns the saved message in full, which is what makes that swap possible.

**Messages are stored keyed by their id, not kept in a list.** Asking for older messages
re-sends one you already have, at every single page boundary. Filed by id, that duplicate
lands on top of itself and disappears. Appended to a list, it renders twice.

**Both formats are converted into one internal shape at a single point**, rather than
keeping the raw versions and handling the difference at the point where they're displayed.
The same message arrives with a different key for its id and a different *type* of
timestamp depending on which route it came through. Converting once means nothing else in
the app ever has to know there were two.

**A successful status code with the wrong body is treated as a failure**, rather than
trusting the status. Sending to a conversation that doesn't exist returns a success code
with an empty body, so status alone would report a failed write as delivered.

**Session expiry is detected on either a `401` or the `NO_TOKEN` code**, not on `401`
alone. A missing credential and an invalid one come back as two different status codes
here, so the standard check misses half of them.

**Every authenticated request waits for the session to be confirmed, and the live
connection waits for a token that hasn't expired locally.** The alternative was to let them
start and fail. React doesn't let you skip these hooks conditionally, so the app shell
begins loading conversations above its own sign-in guard, before the token has been read
back from browser storage — child code runs before parent code. Left ungated, the very
first request of every cold load went out with no credentials and came back rejected. The
expiry rule lives in one shared module so the session and the live connection can never
disagree about it.

**The sign-in page starts its providers with the live connection switched off.** Each route
sets up its own providers, so signing in opened a connection on the login page that the
redirect then killed mid-handshake, leaving the main app to start again from nothing.
Against a server that takes a while to wake up, that threw away the slowest part of the
work for no reason.

**A message waiting to be sent gets the amber "waiting" treatment, never the accent
colour.** The alternative I tried first was the same solid bubble as a delivered message
with a small caption underneath. The single claim this product makes is that it never
pretends an undelivered message was delivered, and an identical-looking bubble made the
interface contradict its own copy.

**Every clock in the app uses one pinned format**, rather than whatever the visitor's
device prefers. Without it, seeded example timestamps rendered in 24-hour time next to live
ones rendering in 12-hour, on the same screen.

**The landing page shows the app built out of real elements, not a screenshot.** A picture
is stuck in one theme on a page whose colours invert, goes out of date the moment the
product moves, and costs far more to download than reusing the styles it's a picture of.

**Content that fades in on scroll also reveals itself after three seconds regardless, and
checks whether it's already on screen.** Anything that starts invisible and never receives
its cue is a blank page, which is a much worse failure than a missing animation.

**The raw captures from this phase are committed to [`docs/recon/`](./recon) with the
credentials removed**, rather than left in a scratch folder. The findings document makes
strong claims about somebody else's API, and a reviewer should be able to check them.

---

## Phase 2 — the skeleton

**Two state libraries rather than one**, and this is the trade-off I'd most expect to be
asked about. TanStack Query handles things that are really *requests* — the conversation
list, user search, who you are — and gets retrying, de-duplication and refetch-on-reconnect
for free. A separate Zustand store holds the message timeline. The timeline has three
independent writers (history pages, live pushes, and the outbox) and pages that deliberately
overlap, which is exactly the case a cache built around "an array of pages" models worst.
Forcing both jobs into one tool would have meant fighting it for one of them.

**The network layer is a plain module handed a way to fetch the current token**, rather
than a React hook. The outbox drains outside React's tree entirely, and it still needs to
make authenticated calls.

**A response that passes its status check but fails its shape check raises an error.** This
is the code-level version of the decision above: `POST /messages` answers `200` with
nothing at all for a conversation that doesn't exist.

**Two validation schemas, one for each route, both converting to a single message type**,
rather than one loose schema covering both. The two routes genuinely disagree about the
field name and the timestamp type, and a schema loose enough to accept both would push that
disagreement into every component instead of resolving it.

**Errors carry a meaning rather than a raw status code.** Call sites branch on that meaning,
not on the number. Authentication failure spans two status codes here and a malformed id
arrives as a server error, so the number on its own isn't usable.

**Server crashes caused by malformed ids are remapped to a friendly "not found"**, rather
than surfaced. The raw text leaks the internal name of the data model and means nothing to
a person.

---

## Phase 3 — features

**Data is considered fresh for 30 seconds** rather than refetched aggressively. Every
request to this API costs roughly a second even when the server is fully awake, so casual
refetching is expensive in a way it usually isn't.

**Search doesn't fire until you've typed two characters.** An empty query returns the
entire user directory, so searching on every keystroke means the first keystroke dumps
everyone.

**You're filtered out of your own search results.** The API returns you, and picking
yourself opens an unrelated stranger's conversation because of a bug in how it looks up
existing chats.

**Opening a one-to-one chat checks the local list first before asking the server to create
one.** The endpoint is safe to call twice, so both work, but the local path avoids a
one-second round trip and reads as "open this conversation" rather than "create it".

**Admin-only controls aren't rendered at all for non-admins**, rather than rendered and
then failing. The API enforces this correctly, and a button that always refuses is worse
than no button.

**The message list is rebuilt from scratch when you switch conversation**, rather than
having its scroll position reset by an effect. A different conversation is genuinely
different state, and doing it this way also removed a pattern the React Compiler lint was
right to reject.

**Whether the thread is pinned to the bottom is tracked outside React's state.** Nothing on
screen is drawn from it and it changes on every frame of a scroll. Held as state, it
re-rendered the entire message list every time you moved.

**The jump-to-latest button scrolls instantly, never smoothly.** I verified twice in a real
browser that the smooth version silently failed to arrive, because the screen updating
underneath it cancelled the animation. For the one scroll behaviour the brief calls out by
name, landing reliably beats looking nice.

**User search sends several safe variants of the query and merges the results**, rather
than one carefully escaped query. Escaping prevents the server crash on a `+`, but it also
breaks the exact-match rule phone numbers are held to, so a raw variant is sent as well
whenever the text contains nothing dangerous.

---

## Phase 4 — the offline outbox

**Every message is written to the queue first and transmitted second**, rather than sent
directly and only queued if that fails. One path means there is no window — not even a
reload — in which a message exists as "typed" but not as "saved".

**The queue is stored on your device and drained strictly in order, one at a time**, rather
than flushed in parallel. Sending several at once would let a later message land first and
reorder the conversation for everybody, permanently.

**Nothing is retried automatically after an ambiguous failure.** The send endpoint offers
no protection against the same message being submitted twice, so an automatic retry racing
a slow success posts it twice for real. You get an explicit Retry button instead, which is
a worse experience and a correct one.

---

## Phase 5 — the landing page

**Warm paper and ink with a single vermilion accent**, rather than the cool grey or dark
navy nearly every chat product uses. One accent colour means anything vermilion is always
something you can do, and the warmth reads as a decision rather than a default.

**The product image is a working demo, not a screenshot.** The claim being made is about
behaviour — your message survives a dropped connection — and the only honest way to show
behaviour is to let the reader cause it themselves.

**Scroll animations have no separate branch for reduced motion.** The global stylesheet
already collapses every transition when a device asks for that, so one code path serves
both cases.

---

## Phase 7 — verification

**Local testing runs on two different addresses**, rather than two tabs on one. Tabs on the
same address share their storage and therefore share a signed-in session; two addresses
give two genuinely independent logins, which is the only way to test the two-tab behaviour
honestly. Development only, with no effect on what ships.

---

## Bonus — multiple tabs, and waking the server up

**Only one tab is allowed to transmit the outbox**, rather than each tab flushing its own
copy. The queue is shared through browser storage, so two tabs both read it and both send
everything in it — and since the API has no protection against the same message arriving
twice, everything queued would genuinely be delivered twice. The browser has a built-in
"only one of you may hold this at a time" mechanism, which releases automatically if that
tab is closed or crashes, so a successor takes over with no heartbeat to maintain and no
stale-lock timeout to tune.

**Messages passed between tabs carry the id of the tab that sent them**, rather than
relying on the browser not echoing them back. It only withholds a message from the exact
object that posted it, not from other listeners in the same tab — and here the publisher is
a shared module while the listener is a hook, so a tab really did receive its own events
and queued every message twice. Found by watching the stored queue in a real browser, not
by reading the code.

**Tabs that aren't transmitting still mirror the queue**, rather than showing pending
messages only in the tab they were typed in. The mirrored copy is the entire reason a
second tab tells you the truth. The check for "am I the one allowed to send" happens at
send time, not at display time.

**That check is re-read inside the send loop, not once when it starts.** A tab that loses
its turn part-way through draining has to stop immediately, and wiring the check into the
loop's dependencies the ordinary way would have rebuilt the loop and lost track of the
message already in flight.

**The API is woken up when the landing page loads and again when you move toward a
button**, rather than only handling the delay once someone hits it. The server sleeps after
about fifteen minutes of quiet and takes up to a minute to come back, so the boot can
happen while a visitor reads instead of while they wait. The honest "waking the server up"
banner stays for the cases this misses.

**Waking it is fire-and-forget with a one-minute cooldown**, rather than a ping on every
hover. Six intent events across three buttons should cost one request, not six. A failed
warm-up isn't reported, because the real request that follows will report it properly.

**The wake-up request is scheduled for the browser's idle time**, not fired during setup.
Waking a sleeping server should never compete with drawing the page.

---

## The design pass over the chat panel

The brief says the chat panel is where you'd look closest, so it got a second pass. My
first attempt didn't survive it.

**The timestamp floats inside the bubble**, rather than sitting on its own row underneath
every message. That row added about 18 pixels between every pair of messages, which
defeated the grouping of consecutive messages entirely and made the thread read as a stack
of cards rather than a conversation. Floated rather than positioned over a fixed-width gap,
because a fixed gap has to guess how wide the time will render, and when it guesses low the
text runs underneath it.

**Only the last bubble in a run gets a tail, with a 3-pixel gap inside a run and 12
between**, rather than a uniform gap and a tail on everything. Several messages from one
person should read as one block of speech.

**The thread is capped to a comfortable reading width and centred**, rather than running
the full width of the window. On a 1440-pixel screen your eye had to cross the entire
display to pair a message with its time. The box you type in is capped to the same measure
so the two line up.

**The accent colour was deepened from `#e0451f` to `#cf3d18`.** White text on the original
had a contrast ratio of 4.17:1, under the accessibility standard's 4.5:1; it's 4.85:1 now.
Message bubbles are large blocks of solid colour, so the deeper tone also just looks less
neon.

**The whole ink scale was raised so even the faintest step clears the standard**, rather
than using a conventional light grey for small print. Timestamps are 11-pixel body text and
the grey I'd used sat at 2.38:1. The teal moved too, so "Connected" reads as text rather
than as decoration.

**The active conversation is marked with a rule down its left edge, not only a background
tint.** A tint on its own is indistinguishable from hover when the pointer happens to be
resting on that row.

**Both headers are pinned to the same fixed height**, rather than sized by their contents.
The dividing lines in the sidebar and the thread have to meet exactly across the split, and
they didn't.

**Sign-in is a single centred column, and the landing page uses the same paper-and-ink
roles as the app**, rather than either being pinned permanently dark. A page that ignores
the theme toggle reads as a different product, not a bolder one — and the working demo in
the hero already says what makes this app different, so a decorative dark panel was only
competing with it.

**The demo's bubbles were rebuilt to match the real app exactly**, rather than left on
their own styling. The landing page is showing the product; a reviewer clicking through
shouldn't arrive somewhere that looks unrelated.

---

## Theming, and stopping spam

**Colours are named by role and swapped at one point.** `paper` means "the surface of the
page" and `ink` means "whatever reads on top of it", so every component keeps one set of
class names and the palette re-resolves from a single attribute on the page. The
alternative — a duplicate set of dark-mode class names on every element — is how themes end
up reaching only the screens you remembered to style.

**The theme is applied by a small blocking script before anything is drawn**, rather than
read from storage afterwards. Doing it afterwards paints the light theme first and snaps to
dark, which is the flash almost every themed site gets wrong.

**Three settings — light, system, dark — rather than a two-way switch.** A binary control
can't express "follow my computer", which is the setting most people actually want and the
one a two-way switch silently overwrites the moment it's touched.

**The theme is read through the browser's own subscription mechanism**, rather than held in
React state with an effect to sync it. It lives in storage and on the page, both outside
React and both changeable from another tab. Doing it properly makes theme changes sync
across tabs for free.

**Only the dimming layer behind a dialog uses a fixed colour; every page surface is
themed.** Left themed, that layer lightened the screen instead of dimming it, which is the
one genuine exception to the rule above.

**Conversations with only a few messages are pinned to the bottom of the panel**, rather
than aligned to the top. Three messages stranded above a large empty area read as a loading
failure, which is exactly how the landing page demo looked before I fixed it.

**Flood protection and duplicate protection are two separate rules**, not one combined one.
A burst of five messages is normal typing; five *identical* messages is a stuck key or a
double click. Conflating them either blocks real use or misses the mistake people actually
make. So one rule allows a short burst then settles to about 40 messages a minute, and a
separate one ignores an identical message sent within four seconds.

**A refused send keeps your text and tells you why**, rather than clearing the box or
failing silently. The message was refused, not delivered — throwing away what somebody just
typed is a worse outcome than the spam being prevented.
