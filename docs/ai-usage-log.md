# AI usage log (running)

Kept as we go so the README's AI-usage section is accurate rather than reconstructed.
Tool: Claude Code (Opus 5).

## Phase 0
- **Used for:** writing the seven throwaway Node probe scripts that exercised every
  endpoint and failure path against the live API, and drafting `api-findings.md` from
  the captured JSON.
- **Rejected / corrected:**
  - Initial probe assumed `/api/health` from the spec's declared server URL; the live
    call 404'd and the real path is root `/health`. Kept the 404 as a finding rather
    than quietly fixing the URL.
  - The first room-join test (probe5 §7) was **inconclusive** — it "showed" a socket not
    receiving messages for a post-connect group, but the receiving user had been removed
    from that group two steps earlier and the sender never gets an echo anyway. Rewrote
    it as probe6 with a third, uninvolved socket. The corrected result was the opposite:
    rooms are per-user and delivery works fine. This would have been a confidently wrong
    finding in the write-up.
  - Declined to state a cold-start duration. The API stayed warm for the whole session,
    so there is no measured number; the findings say so instead of quoting Render's
    marketing figure as an observation.

## Phases 1–5 (docs, app, landing)
- **Used for:** drafting `API.md`/`openapi.yaml` from the captured JSON, scaffolding the
  feature folders, and writing the first pass of every component.
- **Rejected / corrected:**
  - The generated `Reveal`, `SocketProvider`, `ServerStatusBanner` and `MessageList` all
    called `setState` synchronously inside effects, and two components read or wrote refs
    during render. Next 16's React Compiler lint rejected all six. Fixed by restructuring
    (derive instead of store, remount via `key`, sync refs in effects) rather than
    disabling the rules.
  - First draft of the landing demo put `schedule(...)` **inside** `setMessages` and
    `setOnline` updaters. React double-invokes updaters in development, so one click
    queued two flushes and fired four scripted replies at once. Caught by driving the
    demo in a real browser, not by reading the code.

## Phase 7 (verification)
- **Used for:** driving two live browser sessions and scripting the assertions.
- **Found and fixed by actually running it — none of these were visible in review:**
  - The "new messages" pill dismissed but did **not** scroll. A smooth `scrollIntoView`
    was cancelled by the re-render that clears the unread badge. Switching to a smooth
    `scrollTop` assignment also failed — it stopped ~1000px short. Only an unanimated
    assignment lands reliably, so that is what ships.
  - `/users/search` matching rules were **wrong in my own Phase 0 findings**. I had
    written "case-sensitive and prefix-anchored". A second round of probing showed name
    is matched by a case-sensitive regex anchored at any *word* start, while phone is
    matched by *exact equality* — which together mean an E.164 number cannot be found by
    any client (raw `+` → 500, escaped `+` → no longer equal). Corrected `api-findings.md`
    §2.3, `API.md`, the client's query strategy, and the UI copy.
  - Two-session testing initially failed because Next blocks cross-origin dev resources;
    diagnosed from the dev server log rather than assumed to be an app bug.
- **Not accepted:** several measurements that looked like app bugs but were faults in my
  own test scripts — a selector that only matched run-ending bubbles (undercounting
  messages), and a scroll assertion that raced a smooth animation. Each was re-measured
  before concluding anything.

## Bonus (cross-tab coordination + pre-warming)
- **Used for:** drafting the `BroadcastChannel` wrapper, the Web Locks leader hook, and
  the pre-warm components.
- **Found by running it, not by reading it:**
  - The first version had a **self-echo bug**. I had assumed `BroadcastChannel` doesn't
    deliver to the sending tab — true only of the exact posting *object*. The publisher
    (a module singleton, usable outside React) and the listener (a hook) are different
    instances, so the sending tab received its own broadcast and queued every optimistic
    message twice. Caught by watching the persisted queue in a real browser and seeing two
    identical entries. Fixed by tagging each event with a per-tab id.
  - Two more React Compiler ref-during-render errors in the generated hooks; both fixed by
    moving the ref writes into effects.
- **Verified against the server, not the UI:** after queueing one message offline with two
  tabs open, the API's own history showed exactly one stored copy — which is the claim
  worth proving, since a UI can look right while having sent twice.
