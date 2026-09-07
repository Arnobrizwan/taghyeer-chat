import Link from 'next/link';
import { Providers } from '../providers';
import { LoginForm } from '@/features/auth/login-form';
import { ServerStatusBanner } from '@/components/ui/server-status-banner';
import { PrewarmApi } from '@/features/landing/warm-link';
import { ThemeToggle } from '@/features/theme';

export const metadata = { title: 'Sign in — Relay' };

export default function LoginPage() {
  return (
    <Providers>
      {/* Someone signing in is about to make requests; start the boot now. */}
      <PrewarmApi />

      <div className="flex min-h-dvh flex-col">
        <ServerStatusBanner />

        {/*
          A split screen rather than a form floating in the middle of an empty page: it
          carries the landing page's ink panel into the app, so signing in doesn't feel
          like arriving at a different product. The panel is decorative and hidden below
          `lg`, where the form should have the whole screen.
        */}
        <div className="grid flex-1 lg:grid-cols-2">
          <div className="relative flex items-center justify-center px-5 py-12 sm:px-10">
            <ThemeToggle className="absolute top-6 right-6" />
            <div className="w-full max-w-sm">
              <Link
                href="/"
                className="mb-10 inline-flex items-center gap-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
              >
                <span className="flex size-6 items-center justify-center rounded-md bg-vermilion text-[11px] font-bold text-white">
                  R
                </span>
                Relay
              </Link>

              <h1 className="font-display text-[42px] leading-[1.05] text-ink">Welcome back</h1>
              <p className="mt-3 mb-9 text-[15px] leading-relaxed text-ink-muted">
                Enter your number to sign in. If it&apos;s new here, we&apos;ll create your
                account automatically.
              </p>

              <LoginForm />
            </div>
          </div>

          <aside
            aria-hidden="true"
            className="relative hidden overflow-hidden bg-canvas px-12 py-16 lg:flex lg:flex-col lg:justify-center"
          >
            <div className="absolute -top-24 -right-24 size-80 rounded-full bg-vermilion/15 blur-3xl" />

            <div className="relative max-w-md">
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-on-canvas/15 px-3 py-1 text-[11px] font-medium tracking-wide text-on-canvas/70 uppercase">
                <span className="size-1.5 rounded-full bg-vermilion-bright" />
                Built for bad signal
              </p>

              <p className="font-display text-[40px] leading-[1.1] text-on-canvas text-balance">
                Your message waits for the
                <span className="text-vermilion-accent italic"> tunnel to end</span>, then
                sends itself.
              </p>

              <div className="mt-10 space-y-2">
                <StaticBubble text="Heading into the tunnel now" state="queued" />
                <StaticBubble text="Text me when you're out" state="incoming" />
                <StaticBubble text="Out! That queued one just sent" state="sent" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Providers>
  );
}

function StaticBubble({
  text,
  state,
}: {
  text: string;
  state: 'queued' | 'sent' | 'incoming';
}) {
  const own = state !== 'incoming';
  return (
    <div className={own ? 'flex justify-end' : 'flex justify-start'}>
      <div className="flex max-w-[85%] flex-col items-end">
        <div
          className={
            own
              ? 'bubble-out bg-vermilion px-3 py-[7px] text-sm leading-[1.45] text-white'
              : 'bubble-in border border-on-canvas/15 bg-paper/10 px-3 py-[7px] text-sm leading-[1.45] text-paper/90'
          }
        >
          {text}
        </div>
        {state === 'queued' && (
          <span className="mt-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-on-canvas-amber">
            <span className="size-1.5 rounded-full bg-on-canvas-amber/70" />
            Waiting for connection
          </span>
        )}
      </div>
    </div>
  );
}
