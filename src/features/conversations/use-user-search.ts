'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchUsers } from '@/lib/api/endpoints';
import type { UserRef } from '@/lib/domain';

/** Below this the API returns its entire user directory (findings §2.2). */
export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function useUserSearch(rawQuery: string, selfId: string) {
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const enabled = debounced.length >= MIN_QUERY_LENGTH;

  const query = useQuery({
    queryKey: ['user-search', debounced],
    queryFn: ({ signal }) => searchUsers(debounced, signal),
    enabled,
    staleTime: 60_000,
  });

  /*
   * Search returns the caller (findings §2.4). Left in, selecting yourself would call
   * POST /conversations with your own id, which returns an unrelated conversation you
   * happen to be in (findings §4.3) — i.e. it silently opens someone else's chat.
   */
  const results: UserRef[] = (query.data ?? []).filter((u) => u.id !== selfId);

  return {
    results,
    isSearching: enabled && query.isFetching,
    hasQuery: enabled,
    tooShort: debounced.length > 0 && debounced.length < MIN_QUERY_LENGTH,
    error: query.error,
    debounced,
  };
}
