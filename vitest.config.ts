// Copyright (c) 2026 Arnob Rizwan Ahmad. Evaluation use only - see LICENSE.

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/*
 * Node environment, no jsdom.
 *
 * Everything under test here is pure: reconciliation, ordering, validation, wire-shape
 * normalisation, the tint hash. That is deliberate rather than a shortcut — the bugs three
 * rounds of review actually found in this codebase were nearly all in logic that had been
 * left inside components, and moving each one into `lib` to test it is what made it
 * testable at all. Rendering is covered by the browser session described in the README.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
