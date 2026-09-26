# AGENTS.md — for AI coding agents working in this repo

This file is addressed to AI coding agents (e.g. the Hermes agent). It is NOT
user-facing documentation; keep user-facing content in `README.md`.

## Project

Hermes Web — the **Hermes Desktop chat UI** as a web app / PWA
(`apps/web-desktop`). An **unofficial community wrapper** of
`NousResearch/hermes-agent` (not affiliated). The renderer sources
(`apps/desktop`, `apps/shared`) are **not in this repo** — they are fetched from
the pinned `hermes-agent` at build time.

## Non‑negotiable rules

- **English only** — every comment, doc, description and commit message in English.
- **Never edit `apps/desktop/` or `apps/shared/`** — they are upstream renderer
  sources fetched at build time (read‑only in the nix store). Change rendering
  only through our files: `apps/web-desktop/src/`, `src/web-bridge/`,
  `src/overrides/`, `vite.config.ts`, `web.css`.
- **Never force‑push / rewrite history.** `origin` is the GitHub repository for
  this project. Keep `main` and feature branches on that repository, and open
  all pull requests there.
- **Never commit secrets or VPS‑identifying data.** `.env` is gitignored and
  stays local; `.env.example` holds placeholders only; `PLAN.md` is gitignored
  (internal); do not add LAN IPs, tailnet hostnames or `/home/ubuntu` paths to
  tracked files.
- **The VPS never builds nix locally** (house rule) — real builds run on GitHub
  Actions (`release.yml`). `nix eval` / `nix flake
  show` locally is fine.

## Remotes & push discipline

- `origin` — GitHub (`https://github.com/jtenniswood/hermes-desktop-web-mobile-pwa.git`) — **primary** and the target for all pull requests.
- The upstream of `main` is `origin/main`.

After every meaningful commit:
```bash
git push origin <branch>
```

## Build & dev

- **Docker (primary image, NIX-FREE):** `docker build -t hermes-web .` fetches
  the exact renderer revision in `flake.lock`, typechecks, and builds the UI.
- **Dev loop:** `pnpm prepare:renderer` → `pnpm install --frozen-lockfile` →
  `pnpm dev` (port 5174). `nix develop` is an optional development environment;
  do not run Nix builds on the VPS.
- **Verify:** `pnpm typecheck` and `pnpm build`, then manually exercise the
  affected workflow. Report checks that could not be completed.

## Development scope

This is a personal project in early development. Prefer small, reversible changes
and a short feedback loop. Do not require a full test suite, staged image
promotion, release evidence records, or physical-device acceptance for routine
changes. Existing tests are optional tools; use targeted checks for meaningful
risks such as draft loss, conversation-selection races, authentication, and PWA
activation. Do not add tests that merely mirror a styling or low-impact change.

Keep the current framework and upstream chat engine. Add small adapters when a
feature needs them, consolidate repeated browser interactions incrementally, and
avoid speculative architecture or a second mutable conversation store. Preserve
draft, recording, selection, and safe-update behavior while simplifying code.

`docs/releases.md` describes the current build/deploy/rollback process. Earlier
reset/evolution plans and renderer automation checklists are historical, not
additional acceptance gates. Keep automated renderer activation parked unless
explicitly requested. Do not alter repository settings as part of routine work.

## Fixing problems

Diagnose the reported symptom, make the smallest useful fix, and check the
affected workflow. Images build in GitHub Actions; a push to `main` publishes
and deploys the image with container-health rollback. Keep feature work on a
branch and open a PR on `origin`. Do not merge or deploy unless requested.

Use the previous immutable image digest for rollback if a deployed change breaks
behavior. Keep browser storage, runtime configuration, and data volumes intact.
