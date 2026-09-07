'use client';

import { create } from 'zustand';

export type ServerStatus = 'idle' | 'waking' | 'ready' | 'unreachable';

type ServerStatusStore = {
  status: ServerStatus;
  /** When the current wake attempt began, for a live elapsed counter in the UI. */
  wakingSince: number | null;
  setStatus: (status: ServerStatus) => void;
};

/**
 * Tracks whether the API is responding.
 *
 * The API is hosted on Render's free tier, which spins down after ~15 minutes idle; the
 * next request then blocks while a container boots. Warm latency is already ~1s
 * (findings §8), so a slow request is not by itself unusual — but a request that has been
 * outstanding for several seconds almost certainly means a cold start, and that deserves
 * an explanation rather than a spinner that looks identical to a hang.
 */
export const useServerStatus = create<ServerStatusStore>((set) => ({
  status: 'idle',
  wakingSince: null,
  setStatus: (status) =>
    set((prev) => ({
      status,
      wakingSince:
        status === 'waking' ? (prev.wakingSince ?? Date.now()) : null,
    })),
}));

export const serverStatus = {
  set: (s: ServerStatus) => useServerStatus.getState().setStatus(s),
  get: () => useServerStatus.getState().status,
};
