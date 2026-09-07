'use client';

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
