import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The core and the puzzle modules are deliberately headless: no DOM, no canvas, no
    // browser APIs. If a test of either needs jsdom, the boundary has leaked and that is
    // the bug, not the test setup.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
