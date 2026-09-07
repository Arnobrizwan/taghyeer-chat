'use client';

import { EmptyState } from '@/components/ui';

/**
 * Desktop-only placeholder. On mobile this route renders just the sidebar (the shell
 * hides this pane), so the user never sees an empty screen with no way forward.
 */
export default function AppIndexPage() {
  return (
    <div className="hidden flex-1 items-center justify-center bg-paper-sunken/40 md:flex">
      <EmptyState
        icon={
          <svg viewBox="0 0 48 48" className="size-12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 12h32v22H20l-8 7v-7H8z" strokeLinejoin="round" />
            <path d="M16 20h16M16 26h10" strokeLinecap="round" />
          </svg>
        }
        title="Pick a conversation"
        body="Choose a chat from the list, or start a new one to begin messaging."
      />
    </div>
  );
}
