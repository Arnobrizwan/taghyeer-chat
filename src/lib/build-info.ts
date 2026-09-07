// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

/**
 * Build identity, surfaced into the DOM.
 *
 * A bug report that says "the composer did nothing" is worth very little without knowing
 * which build it came from — this app is redeployed by hand, the API it talks to sleeps
 * and wakes on its own schedule, and "it worked yesterday" is genuinely ambiguous here.
 * `<html data-build>` costs one attribute and lets anyone reporting a problem read the
 * exact revision straight out of devtools, or a script scrape it from the served HTML.
 *
 * The value is deliberately a literal rather than something read from the environment:
 * Vercel's build-time variables are absent under `next start` and in a plain `next build`
 * on a laptop, so an env-derived id is empty in exactly the situations where someone is
 * debugging locally and most wants it.
 */

/**
 * Identifies the revision and the channel it was distributed through.
 *
 * The trailing segment names the distribution rather than the code, so two builds of the
 * same source that reached people by different routes stay distinguishable in a bug
 * report. `src` is a build made straight from the repository.
 */
export const BUILD_ID = 'relay-2026.09.07-src';
