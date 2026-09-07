import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { themeScript } from '@/features/theme';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Relay — chat that survives a bad connection',
  description:
    'A real-time messaging client built for direct and group conversations, with an offline outbox that keeps your messages when the network drops.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme before React
    // hydrates, so the server markup and the live DOM legitimately differ on that attribute.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        {/*
          Visible only once focused, which is the whole point: a keyboard user should not
          have to tab through the nav on every page to reach the content. Every route
          renders a `#main-content` anchor for it to land on.
        */}
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
