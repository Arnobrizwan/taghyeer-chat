import Image from 'next/image';

/**
 * The Relay mark. Deliberately not a client component: every place it appears — the
 * landing nav and footer, the sign-in page — renders on the server.
 *
 * `next/image` skips optimisation automatically for a `.svg` src, so this is one
 * ~900-byte request that the browser then caches across the whole site. The `alt` is
 * empty because the word "Relay" always sits next to it; giving the mark its own label
 * would make a screen reader say the name twice.
 *
 * `priority` because the default is `loading="lazy"`, and a lazily-loaded logo leaves a
 * visible gap next to the wordmark on every first paint. Every placement resolves to the
 * same URL, so the footer copy costs nothing beyond the one the nav already fetched.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image src="/logo.svg" alt="" width={size} height={size} className={className} priority />
  );
}
