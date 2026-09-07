import Link from 'next/link';
import { Providers } from '../providers';
import { LoginForm } from '@/features/auth/login-form';
import { ServerStatusBanner } from '@/components/ui/server-status-banner';

export const metadata = { title: 'Sign in — Relay' };

export default function LoginPage() {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <ServerStatusBanner />
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-sm">
            <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink">
              <span className="flex size-6 items-center justify-center rounded-md bg-vermilion text-[11px] font-bold text-white">
                R
              </span>
              Relay
            </Link>

            <h1 className="font-display text-4xl leading-tight text-ink">Welcome back</h1>
            <p className="mt-2 mb-8 text-[15px] leading-relaxed text-ink-muted">
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
