import Image from 'next/image';

/**
 * The Relay mark. Deliberately not a client component: every place it appears — the
 * landing nav and footer, the sign-in page — renders on the server.
 *
 * `next/image` skips optimisation automatically for a `.svg` src, so this is one
 * ~800-byte request that the browser then caches across the whole site. The `alt` is
 * empty because the word "Relay" always sits next to it; giving the mark its own label
 * would make a screen reader say the name twice.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image src="/logo.svg" alt="" width={size} height={size} className={className} />
  );
}
