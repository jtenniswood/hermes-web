# Comparison evidence

Application revision: `c0674f79b9a643b4fd40aa47928311ba4402554e`.
Renderer revision: `03b0c7947262b220f5148b75a30bb7a3faddcbb2`.
Dependency-lock SHA-256: `1dfc0e470ed909f9f1085bd8fb172712b99e8beebd2bbcad8547318ace7b8e32`.
Release channel: `comparison`.

Captured from the actual built nginx image using the synthetic preview gateway,
Chromium, light theme, desktop 1440×960 at the wrapper's default 90% zoom, and
phone 390×844 with touch/mobile emulation at its default 125% zoom. Screenshots
wait for the viewport to paint and disable animation for a stable capture.

| Layout | Desktop | Phone |
| --- | --- | --- |
| Browser focused | [Screenshot](browser-desktop.png) | [Screenshot](browser-phone.png) |

Executed checks:

- `corepack pnpm typecheck`: passed, zero baseline exceptions.
- `corepack pnpm test:foundation`: 37 passed.
- Stable frontend build: passed; the browser shell is the only preview experience.
- `HERMES_COMPARISON_IMAGE=hermes-web:comparison corepack pnpm exec playwright test tests/browser/comparison.spec.mjs`: browser behavior suite passed.
- HTTPS preview smoke: session reopening and draft preservation.
- [Stable compatibility CI](https://github.com/jtenniswood/hermes-web/actions/runs/35400381186): passed, including the locked Nix dependency closure.

The browser journeys cover shared streaming/cancellation, reopening, new chat
workspace tabs, settings at desktop/phone sizes, repeated Bot selection, profile
restoration, file-picker and pasted-image reload protection, keyboard navigation,
reduced motion and zoom. The [comparison image job](https://github.com/jtenniswood/hermes-web/actions/runs/35400381163)
retains additional screenshots and failure traces. Synthetic review does not
claim live-model or real-gateway coverage; the separate real-gateway smoke test
remains required before enabling automatic stable promotion.
