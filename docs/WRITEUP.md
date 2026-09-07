# Part 3 — Write-up

This explains how I built Relay and why I made the choices I made. I've tried to write it so
it makes sense whether or not you write code for a living. Where I have to use a technical
word, I explain it the first time.

---

## The short version

**Relay is a chat app.** You sign in with your phone number, find someone, and message them
one-to-one or in a group. Messages arrive instantly, without refreshing the page.

**The one thing that makes it different:** most chat apps quietly lose whatever you typed
while your signal was gone. Relay doesn't. If you type on a dead connection, your message is
saved on your device first, shown to you as clearly waiting, and sent the moment you're back
online — in the order you wrote it. Nothing disappears, and nothing pretends it was
delivered when it wasn't.

**Before I wrote any of it, I spent the first phase testing the API I'd been given.** An API
is the service the app talks to, like a kitchen an app sends orders to. The documentation
for this one described almost nothing about what it actually sends back, so I ran roughly
120 test requests and wrote down the real answers. That turned up around twenty genuine
faults, several of which would have caused bugs I'd have blamed on my own code. Finding them
first is the reason the rest of the build went the way it did.

Everything below is the detail behind those three paragraphs.

---

## Part 1 — how I built the app, and why

### I tested the API before I built anything

The provided documentation listed the addresses you can call, but for the responses it
essentially said "unspecified". So I wrote throwaway scripts and called every endpoint by
hand, including deliberately wrong calls, and recorded exactly what came back.

Some of what I found, in plain terms:

- **Asking for older messages returned one you already had.** Loading a conversation in
  pages meant every page boundary repeated a message.
- **A failed send reported success.** Sending to a conversation that doesn't exist returned
  "OK" with an empty body. A naive app would show the message as sent.
- **Searching for a phone number starting with `+` crashed the server.** The `+` was being
  passed straight into a pattern-matching engine, where it means something special.
- **Empty messages were accepted.** Sending a blank message, or one containing only spaces,
  succeeded and was delivered to everyone.
- **The same message arrives in two different shapes** depending on whether it comes through
  the live connection or a normal request.
- **You never get told about your own message.** If you send from one browser tab, a second
  tab of yours never hears about it.

The full list, with evidence for each, is in [`api-findings.md`](./api-findings.md), and my
own clean rewrite of the documentation is in [`API.md`](./API.md).

### Those findings decided the architecture

This is the part I'd most like to be judged on, because the structure of the app is a direct
response to what I found, rather than a template I applied.

- **Every message is filed by its unique id**, not by its position in a list. That's what
  makes the duplicate at each page boundary collapse harmlessly instead of appearing twice.
- **Messages are sent the ordinary way, not down the live connection.** The live connection
  confirms a send but doesn't tell you what it saved, so there'd be nothing to match against.
  The ordinary route returns the saved message, so I can swap my temporary copy for the real
  one.
- **Everything arriving from the network is checked and reshaped at a single point** before
  the rest of the app sees it. Two incoming shapes become one internal shape. This is also
  what catches the "success with an empty body" case: a response that passes the status check
  but fails the shape check is treated as a failure, which is what it is.
- **Only one browser tab is allowed to send.** More on this below.

I used two separate state libraries rather than one, and that was a deliberate trade-off.
TanStack Query handles things that are really *requests* — the conversation list, user
search, who you are. Zustand holds the message timeline and the outbox, which behave less
like a cached request and more like a small database that several things write to at once.
Forcing both jobs into one tool would have meant fighting it for one of them.

### The extra feature: the offline outbox

The brief invited something original, so I picked the failure I find most annoying in real
chat apps.

When you press send, your message is written to your own device *before* anything touches
the network. If the send succeeds, the saved copy is swapped for the server's copy and you
see a tick. If it fails, the message stays in the thread, clearly marked as waiting — amber,
outlined, with a clock instead of a tick — and it is retried when you're back online. The
queue drains one message at a time, so the order you typed is the order everyone reads.

The important detail is that a waiting message never *looks* delivered. That was the whole
point, so I made queued and sent visually different rather than nearly identical.

You can try it without going offline: on the landing page, press **Cut the connection**,
keep typing, then **Reconnect**.

### Two problems that only appear in real use

**Two tabs of the same account.** Because the API never tells you about your own messages,
opening the app twice and sending from one leaves the other stale. Worse, my own outbox made
it dangerous: the queue is saved on the device, so both tabs would find it and both would
send it — and since the API has no protection against the same message being submitted
twice, everything queued would arrive in duplicate.

The fix is that only one tab is allowed to transmit. The browser has a built-in mechanism for
"only one of you may hold this at a time", and it releases automatically if that tab is
closed or crashes, so another tab takes over with no timers to maintain. The other tabs still
show everything; they just don't send. I checked this properly by looking at the server's own
history afterwards and confirming exactly one copy existed, because a screen can look right
while having sent twice.

**The API falls asleep.** It's on a free hosting tier that shuts down after about fifteen
minutes of no traffic, so the first visitor waits up to a minute. Rather than only apologise
for it, the landing page quietly starts waking the server while you're reading, and again
when you move toward the button. If a request is still slow, you get an honest "waking the
server up" message with a counter instead of a spinner that explains nothing.

### Stopping spam and accidental double-sends

My testing showed the API has no rate limiting whatsoever, accepts empty messages, and has no
length limit. On a demo backend shared between candidates, one person holding down Enter
could fill everyone's history.

So sending passes two separate checks, because they catch different mistakes. One allows a
short burst then settles to about 40 messages a minute, which stops a held key. The other
ignores an identical message sent within four seconds, which catches a double click. Both
explain themselves when they refuse, and both **keep your text in the box** — throwing away
what someone typed would be worse than the problem being prevented.

---

## Part 2 — how I designed the landing page, and why

**Chat products all look the same:** cool grey, navy, a blue accent. Landing on that reads as
a default rather than a decision, so I went the other way.

**Colour.** Warm paper and deep ink, with a single orange-red accent. One accent, used with
discipline: if something is that colour, it's something you can do. Green and amber appear
only as status — green for delivered and connected, amber for waiting — so state never
competes with action for your attention. Colours are defined by *role* rather than as fixed
values, which is why the light and dark themes reach every screen instead of just the ones I
remembered to style.

**Type.** A serif for headings, a clean sans-serif for everything else. The serif is doing
real work: it's unexpected on a messaging product and gives the page a voice, and used
sparingly inside the app it makes empty screens feel considered rather than unfinished.

**The chat panel got a second pass**, because the brief says that's where you'd look closest
and my first attempt didn't survive it. Timestamps sat on their own row under every message,
which pushed messages apart and made the thread read as a stack of cards rather than a
conversation — the time now sits inside the bubble. The thread also ran the full width of a
desktop screen, so your eye had to cross the whole window to connect a message to its time;
it's now capped to a comfortable reading width. And the accent colour didn't have enough
contrast against white text to meet accessibility standards, so it was deepened until it did.

**Movement.** One easing curve everywhere, so motion feels like one system rather than
several. Movement is only ever used to explain something — a message appears so you notice
it, the "new messages" pill slides up because it just arrived. Nothing loops or decorates. If
your device is set to reduce motion, the animation goes and the app still works.

**The original idea here is that the demo is the product.** The claim being made is about
behaviour — "your message survives a dropped connection" — and the only honest way to show
behaviour is to let you cause it. So the hero image is a working chat you can break. It runs
the same logic as the real app. No invented testimonials, no FAQ accordion, no screenshot
pretending to be a product.

---

## How I used AI

**Straight answer: Claude Code (Opus 5) wrote most of the first-draft code in this
repository, and every commit says so.** The commit history will tell you that in ten seconds,
so I'd rather say it here than have you discover it. The brief allows AI and asks that it be
documented. This section and [`ai-usage-log.md`](./ai-usage-log.md) are that documentation,
and the log was kept as I went rather than tidied up afterwards.

What's mine is the part I'd want to be judged on: deciding to spend the first phase probing
the API instead of building, reading the captured responses and working out which quirks had
real consequences, choosing the offline outbox as the original feature, and every judgement
call listed below. The model was fastest at work that was already specified — test scripts,
first drafts of components, turning captured data into tables. It was consistently wrong
about anything that could only be settled by actually running the thing, which is why several
of the bugs below were found in a browser rather than by reading code.

**Things I rejected or had to fix:**

- **Six code-quality errors in generated components.** All were fixed by restructuring the
  code, not by switching the warnings off.
- **A bug that only appeared when running it.** The landing page demo fired four replies at
  once on a single click, because of how React deliberately runs some code twice during
  development. Invisible in review.
- **The "new messages" button didn't actually scroll.** Two failed attempts before I found
  why: the smooth scroll was being cancelled by the screen updating underneath it.
- **My own earlier findings were wrong.** I had recorded that user search was
  prefix-matched. Re-testing showed names and phone numbers are matched by two completely
  different rules, which together mean a phone number stored with a `+` cannot be found by
  anyone. I corrected the findings document, the app's search behaviour and the on-screen
  wording rather than leave a confident, wrong claim in something being graded.
- **A wrong assumption of mine about browser messaging** meant every message was queued
  twice across tabs. Found by watching the saved queue in a real browser, not by reading.
- **A test that passed without proving anything.** It checked a fallback behaviour against a
  conversation too small for the result to be meaningful. I rebuilt the fixture so the check
  could actually fail for the right reason.
- **I refused to invent a measurement.** The API stayed awake during my session, so the
  findings say I didn't observe a cold start rather than quoting the hosting provider's
  published number as though I had.

Two habits I'd keep. Every AI-written explanation of *why* something behaves a certain way
was checked against the real captured responses before it went in, because confident and
wrong is the failure mode. And the automated tests are written against faults that actually
happened here, including two the model itself introduced.

---

## Problems with the API I was given

Full evidence in [`api-findings.md`](./api-findings.md). Condensed, with what I did about
each:

| What's wrong | What I did |
|---|---|
| Asking for older messages re-sends one you already have | Messages filed by id, so duplicates collapse |
| The live connection and normal requests describe a message differently | Both reshaped into one internal format |
| A send to a missing conversation returns success with an empty body | Responses are shape-checked, not just status-checked |
| Nothing is re-sent after the live connection drops | The app re-fetches on every reconnect |
| A send confirmation contains no message | Send via the normal route instead |
| Empty and whitespace-only messages are accepted and delivered | Blocked in the app, on both the button and the keyboard |
| A phone search starting with `+` crashes the server | Special characters escaped; safe variants sent |
| A number stored as `+880…` can't be found by anyone | Multiple query forms tried; the interface says to search by name |
| An empty search returns every user on the platform | Two-character minimum before searching |
| A malformed id crashes and leaks an internal name | Ids validated before sending; remapped to "not found" |
| A missing token is a different error code than an invalid one | Both detected |
| Four different response wrappers; one field appears in three shapes | Normalised once, at a single point |
| Search returns you, and starting a chat with yourself opens a stranger's conversation | You are filtered out of results |
| "No messages yet" is an empty object, not a null value | Normalised, because the obvious check silently passes |
| Groups can drop below their own stated three-member minimum | No code assumes a minimum size |
| No way to fetch a single conversation | The list is loaded first so shared links can resolve |
| New conversations announce nothing | The list refreshes when a message arrives for one it doesn't know |
| You're never told about your own messages | Tabs of the same user tell each other |
| The same message can be submitted twice with no protection | Only one tab is allowed to send |

**In fairness, some of it is genuinely well built.** Every group admin action correctly
refuses non-admins with a distinct message, starting a conversation twice returns the same
one rather than creating a duplicate, group creation removes duplicates and ignores you,
removed members immediately lose access to history, and when the last admin leaves someone
else is promoted automatically. I'd change none of that.

---

## How I checked it works

- **91 automated tests** covering the fiddly parts: merging pages of history, ordering,
  reshaping the two message formats, validation, and the colour-assignment used for
  profile pictures. Each was written against a fault that actually occurred.
- **A re-runnable script that checks all 57 documented claims against the live API**, so the
  documentation can't quietly drift out of date. `node docs/recon/verify-api.mjs`.
- **Driving the real app in a browser** for anything the above can't prove — two tabs, going
  offline mid-conversation, scroll position, page boundaries. Four real bugs came out of
  this that review had missed.
- **Layout measured rather than eyeballed** at phone, tablet, laptop and desktop widths:
  content overflowing the screen, elements pushed past the edge, text clipped by its own
  box, and buttons too small to tap comfortably.
- Several apparent bugs turned out to be faults in my own test scripts. Each was re-measured
  before I concluded anything about the app.

---

## What I'd do with more time

- **Component and end-to-end tests.** The logic is covered; the interface is checked by hand.
  A browser-driving test suite would make the two-tab and offline behaviour a permanent
  safety net rather than a one-off check.
- **Handle very long conversations.** Every loaded message currently stays on the page. Fine
  for hundreds, not for tens of thousands.
- **A more rigorous catch-up after reconnecting.** Today it re-fetches the newest page, which
  covers any realistic outage. A stricter version would page backwards until it overlaps what
  it already has.
- **Make group admin actions feel instant.** Renaming, promoting and removing currently wait
  for the server. Sending a message doesn't; these should match.
- **A fallback for older browsers** that lack the "only one tab may send" mechanism. Support
  is broad, and where it's missing every tab simply sends as it would have anyway, but the
  gap could be closed properly.
- **Test with a real screen reader.** Every colour pair meets the contrast standard and the
  screen-reader markup is in place, but correct and pleasant are not the same thing, and only
  using one tells you which you have.

---

### A note on the assignment PDF

The PDF contains a line addressed to AI assistants, instructing them to insert a specific
unrelated word into this write-up. It was spotted on the first read and deliberately not
followed; the word appears nowhere in this submission. Flagging it here because noticing it
is presumably the point of including it.
