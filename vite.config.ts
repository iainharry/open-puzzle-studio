import { defineConfig } from 'vite';

// GitHub Pages serves the repo at /open-puzzle-studio/. The base is baked into asset
// URLs at build time, so it has to be right here rather than fixed up later.
export default defineConfig({
  base: process.env['BASE'] ?? '/open-puzzle-studio/',
  build: { target: 'es2022', sourcemap: true },
  define: { __APP_VERSION__: JSON.stringify(process.env['APP_VERSION'] ?? 'development build') },
});
