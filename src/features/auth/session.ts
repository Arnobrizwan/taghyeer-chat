'use client';

// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { create } from 'zustand';
import type { UserRef } from '@/lib/domain';
/*
 * The expiry rule lives in `lib/jwt` because the socket needs it too: a locally-expired
 * token should not produce a handshake any more than it should produce a request. We still
 * verify against `/auth/me` on boot — a locally-valid token can have been invalidated
 * server-side, and trusting an unverified client-side decode is how you end up rendering a
 * shell for a user who isn't signed in.
 */
import { isTokenUsable } from '@/lib/jwt';

const TOKEN_KEY = 'taghyeer-chat:token:v1';
const USER_KEY = 'taghyeer-chat:user:v1';
/*
 * Deliberately *not* cleared on sign-out.
 *
 * `POST /auth/login` takes phone and name together and has no "does this number exist"
 * probe, so the form cannot ask for the name only when it is genuinely new. What it can do
 * is stop asking the same person to retype it: this survives sign-out so a returning user
 * on the same device finds the field already filled. It holds a display name the user
 * chose for themselves — nothing secret, and nothing that identifies them if the token is
 * gone.
 */
const LAST_NAME_KEY = 'taghyeer-chat:last-name:v1';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

type SessionState = {
  status: SessionStatus;
  token: string | null;
  user: UserRef | null;
  /** Set when a session ended because the server rejected the token, not by choice. */
  expired: boolean;
  signIn: (token: string, user: UserRef) => void;
  signOut: (reason?: 'expired' | 'manual') => void;
  hydrate: () => void;
  setUser: (user: UserRef) => void;
};

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the session stays in memory for this tab only.
  }
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  token: null,
  user: null,
  expired: false,

  signIn: (token, user) => {
    write(TOKEN_KEY, token);
    write(USER_KEY, user);
    write(LAST_NAME_KEY, user.name);
    set({ token, user, status: 'authenticated', expired: false });
  },

  signOut: (reason = 'manual') => {
    write(TOKEN_KEY, null);
    write(USER_KEY, null);
    set({ token: null, user: null, status: 'anonymous', expired: reason === 'expired' });
  },

  setUser: (user) => {
    write(USER_KEY, user);
    set({ user });
  },

  hydrate: () => {
    const token = read<string>(TOKEN_KEY);
    const user = read<UserRef>(USER_KEY);
    if (!user || !isTokenUsable(token)) {
      write(TOKEN_KEY, null);
      write(USER_KEY, null);
      set({ token: null, user: null, status: 'anonymous' });
      return;
    }
    set({ token, user, status: 'authenticated' });
  },
}));

export const sessionToken = () => useSession.getState().token;

/** The display name last signed in with on this device, so the form can prefill it. */
export function lastUsedName(): string {
  return read<string>(LAST_NAME_KEY) ?? '';
}
