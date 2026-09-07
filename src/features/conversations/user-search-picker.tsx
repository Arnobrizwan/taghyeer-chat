'use client';

import { useState } from 'react';
import type { UserRef } from '@/lib/domain';
import { Avatar, Button, Spinner } from '@/components/ui';
import { cx } from '@/lib/utils';
import { MIN_QUERY_LENGTH, useUserSearch } from './use-user-search';

/**
 * Debounced people search with multi-select.
 *
 * Two behaviours here exist because of how the endpoint actually works (findings §2):
 * nothing is queried below two characters, because an empty `q` returns the entire user
 * directory; and the empty-result copy explains the real matching rules, because "no
 * results" here usually means "typed in a way this endpoint can't match" rather than
 * "no such person" — names are case-sensitive and match only at a word start, and phone
 * numbers must be exact.
 */
export function UserSearchPicker({
  selfId,
  excludeIds = [],
  multiple = true,
  busy = false,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  selfId: string;
  excludeIds?: string[];
  multiple?: boolean;
  busy?: boolean;
  confirmLabel: string;
  onConfirm: (users: UserRef[]) => void;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<UserRef[]>([]);
  const { results, isSearching, hasQuery, debounced } = useUserSearch(query, selfId);

  const available = results.filter((u) => !excludeIds.includes(u.id));

  function toggle(user: UserRef) {
    setSelected((prev) => {
      const exists = prev.some((u) => u.id === user.id);
      if (exists) return prev.filter((u) => u.id !== user.id);
      return multiple ? [...prev, user] : [user];
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <label htmlFor="people-search" className="sr-only">
          Search people by name or phone
        </label>
        {/* A leading magnifier so the field reads as search before it is focused. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5 17.5 17.5" strokeLinecap="round" />
        </svg>
        <input
          id="people-search"
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="w-full rounded-lg border border-line-strong bg-paper py-2.5 pr-9 pl-10 text-[15px] transition-colors placeholder:text-ink-faint hover:border-ink-faint"
        />
        {isSearching && (
          <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-faint" />
        )}
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => toggle(u)}
                className="flex items-center gap-1.5 rounded-full bg-vermilion-soft py-1 pr-2 pl-2.5 text-xs font-medium text-vermilion-on-soft transition-colors hover:bg-vermilion/15"
              >
                {u.name}
                <span aria-hidden="true">×</span>
                <span className="sr-only">Remove {u.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="max-h-56 min-h-[3rem] overflow-y-auto scroll-quiet">
        {!hasQuery && (
          <p className="px-2 py-6 text-center text-sm text-ink-muted">
            Type at least {MIN_QUERY_LENGTH} characters to search.
          </p>
        )}

        {hasQuery && !isSearching && available.length === 0 && (
          <div className="px-2 py-5 text-center">
            <p className="text-sm text-ink-muted">
              No one found for <span className="font-medium text-ink">“{debounced}”</span>.
            </p>
            <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-ink-faint">
              Names match from the start of a word and are case-sensitive. Phone numbers
              only match if typed exactly, and numbers stored with a “+” can&apos;t be
              searched at all.
            </p>
          </div>
        )}

        <ul className="flex flex-col">
          {available.map((u) => {
            const isSelected = selected.some((s) => s.id === u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => toggle(u)}
                  aria-pressed={isSelected}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                    isSelected ? 'bg-vermilion-soft' : 'hover:bg-paper-sunken',
                  )}
                >
                  <Avatar name={u.name} id={u.id} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{u.name}</span>
                    <span className="truncate text-xs text-ink-muted">{u.phone}</span>
                  </span>
                  {isSelected && (
                    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-vermilion" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/*
        A ruled, right-aligned action row rather than a button floating at the bottom-left:
        the rule gives the dialog a real footer edge, and the primary action lands where the
        eye finishes reading. `justify-end` with cancel first keeps the destructive-free
        ordering conventional.
      */}
      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={selected.length === 0}
          loading={busy}
          onClick={() => onConfirm(selected)}
        >
          {confirmLabel}
          {selected.length > 0 && ` (${selected.length})`}
        </Button>
      </div>
    </div>
  );
}
