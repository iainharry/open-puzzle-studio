import './shell/style.css';
import { App } from './shell/app.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing from index.html');
const app = new App(root);

// Exposed so `scripts/smoke.mjs` can drive the real app rather than a stub. Deliberately
// not a public API, and the reason the smoke test can assert what a player would see
// instead of asking the app whether it thinks it worked.
(globalThis as unknown as { __ops?: App }).__ops = app;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}
