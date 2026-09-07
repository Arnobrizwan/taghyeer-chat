import type { Metadata } from 'next';
import { OutboxDemo } from '@/features/landing/outbox-demo';
import { PrewarmApi, WarmLink } from '@/features/landing/warm-link';
import { ThemeToggle } from '@/features/theme';
import { Reveal } from '@/features/landing/reveal';
import { Logo } from '@/components/ui/logo';

export const metadata: Metadata = {
  title: 'Relay — chat that survives a bad connection',
  description:
    'Direct and group messaging with an offline outbox. Messages you send on a dropped connection queue locally and flush in order when you reconnect — nothing is silently lost.',
};

const CAPABILITIES = [
  {
    title: 'Direct and group chats',
    body: 'One-to-one conversations and groups with admins who can add, remove, promote and rename. Anyone can leave.',
  },
  {
    title: 'Live, without refreshing',
    body: 'Messages arrive over a websocket and land in the open thread and the sidebar at the same time.',
  },
  {
    title: 'History that loads as you scroll',
    body: 'Cursor-paginated history, merged by message id so a page boundary never shows you the same message twice.',
  },
  {
    title: 'Scroll position you can trust',
    body: 'Reading something further up? An incoming message never yanks you away. A pill tells you it arrived.',
  },
];

export default function LandingPage() {
  return (
    <div className="bg-paper text-ink">
      {/* Begins waking the sleeping API while the visitor reads. Renders nothing. */}
      <PrewarmApi />

      {/* ---------------------------------------------------------------- Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Relay</span>
        </span>
        <span className="flex items-center gap-3">
          <ThemeToggle />
          <WarmLink
            href="/app"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper transition-transform duration-200 hover:-translate-y-0.5"
          >
            Open the app
          </WarmLink>
        </span>
      </header>

      {/* --------------------------------------------------------------- Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 sm:px-8 sm:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <Reveal>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
                <span className="size-1.5 rounded-full bg-vermilion-bright" />
                Real-time messaging
              </p>
            </Reveal>

            <Reveal delay={60}>
              {/*
                Broken by hand rather than left to the browser: "…on a / dead connection"
                stranded a two-word orphan, and `text-balance` can't fix a break inside a
                styled span. Each line is a clause, so the emphasis lands where it reads.
              */}
              <h1 className="font-display max-w-[13ch] text-[clamp(2.6rem,5.9vw,4.15rem)] leading-[1.03] tracking-tight sm:max-w-none">
                <span className="block text-balance">Every message you send.</span>
                <span className="text-vermilion-accent block italic">
                  Even the ones you sent
                </span>
                <span className="text-vermilion-accent block italic">on a dead connection.</span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-muted">
                Most chat apps quietly drop what you typed while the signal was gone. Relay
                queues it, keeps the order, and sends it the moment you&apos;re back — so
                the thread reads the way you actually wrote it.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <WarmLink
                  href="/app"
                  className="group inline-flex items-center gap-2 rounded-xl bg-vermilion px-6 py-3.5 text-[15px] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-vermilion-bright"
                >
                  Start chatting
                  <svg viewBox="0 0 20 20" className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </WarmLink>
                <span className="text-sm text-ink-faint">
                  No password — your phone number signs you in.
                </span>
              </div>
            </Reveal>
          </div>

          {/* The product visual is the working demo itself. */}
          <Reveal delay={220}>
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-6 rounded-[2rem] bg-vermilion/10 blur-3xl"
              />
              <div className="relative">
                <OutboxDemo />
                <p className="mt-3 text-center text-xs text-ink-faint">
                  Interactive demo — cut the connection, keep typing, then reconnect.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- The argument */}
      <section className="border-t border-line bg-paper-sunken text-ink">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <Reveal>
            <h2 className="max-w-2xl font-display text-[clamp(2rem,4.5vw,3rem)] leading-tight text-balance">
              A dropped connection shouldn&apos;t cost you the message.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-muted">
              When a websocket drops, the server replays nothing. Anything sent in that gap
              is gone unless the client goes and fetches it back. Relay assumes the
              connection is unreliable and is built around that, rather than treating it as
              an edge case.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2">
            {CAPABILITIES.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <div className="border-t border-line pt-5">
                  <h3 className="text-[17px] font-semibold text-ink">{c.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ How it works */}
      <section className="border-t border-line bg-paper text-ink">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <Reveal>
            <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-tight">
              What happens when the signal goes
            </h2>
          </Reveal>

          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'You keep typing',
                body: 'The composer never locks. Your message is written to a local queue before anything touches the network.',
              },
              {
                step: '02',
                title: 'It waits, visibly',
                body: 'Queued messages stay in the thread marked “waiting for connection”. Nothing vanishes, and nothing pretends it was delivered.',
              },
              {
                step: '03',
                title: 'It flushes in order',
                body: 'The moment you reconnect the queue drains one message at a time, so the order you wrote is the order everyone reads.',
              },
            ].map((s, i) => (
              <Reveal key={s.step} delay={i * 90}>
                <li className="flex flex-col gap-3">
                  <span className="font-display text-4xl text-vermilion">{s.step}</span>
                  <h3 className="text-[17px] font-semibold">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-muted">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="border-t border-line bg-paper-sunken text-ink">
        <div className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8">
          <Reveal>
            <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.25rem,5.5vw,3.75rem)] leading-[1.05] text-balance">
              Try it on a train, in a lift, or anywhere the bars run out.
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <WarmLink
              href="/app"
              className="mt-10 inline-flex items-center gap-2 rounded-xl bg-vermilion px-7 py-4 text-base font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-vermilion-bright"
            >
              Open Relay
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </WarmLink>
          </Reveal>
        </div>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-7 text-sm text-ink-faint sm:flex-row sm:px-8">
            <span className="flex items-center gap-2">
              <Logo size={20} />
              Relay
            </span>
            <span>Built as a take-home for Taghyeer Technologies.</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
