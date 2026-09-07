import Link from 'next/link';
import { Providers } from '../providers';
import { LoginForm } from '@/features/auth/login-form';
import { ServerStatusBanner } from '@/components/ui/server-status-banner';
import { PrewarmApi } from '@/features/landing/warm-link';
import { ThemeToggle } from '@/features/theme';
import { Logo } from '@/components/ui/logo';

export const metadata = { title: 'Sign in — Relay' };

export default function LoginPage() {
  return (
    <Providers socket={false}>
      {/* Someone signing in is about to make requests; start the boot now. */}
      <PrewarmApi />

      <div className="flex min-h-dvh flex-col">
        <ServerStatusBanner />

        {/*
          One centred column on paper. Signing in is a single task with a single control,
          so the page carries nothing but that task — the body ground is already paper,
          so nothing here needs to paint its own.
        */}
        <div className="relative flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
          <ThemeToggle className="absolute top-6 right-6" />

          <div className="w-full max-w-sm">
            <Link
              href="/"
              className="mb-10 inline-flex items-center gap-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
            >
              <Logo size={24} />
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
      </div>
    </Providers>
  );
}
