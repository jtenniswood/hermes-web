# Optional renderer-update tooling

Automatic renderer proposals are parked during personal development. No GitHub
App, automation enablement checklist, or release evidence package is needed for
ordinary changes. See [releases and rollback](releases.md) for the active workflow.

## Manual renderer changes

`flake.lock` pins the exact `NousResearch/hermes-agent` revision supplying both
`apps/desktop` and `apps/shared`. Keep upgrades separate from unrelated UI work
where practical. Updating the lock metadata with `nix flake update hermes` does
not build Nix locally.

After changing the pin, prepare the renderer and inspect compatibility:

```sh
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm check:upstream
pnpm typecheck
pnpm build
```

Renderer preparation refuses to overwrite mismatched or modified source paths.
Resolve that mismatch before proceeding; never edit fetched renderer files.
Review changed contracts in `apps/web-desktop/src/upstream/compatibility-registry.json`.
Do not blindly refresh fingerprints to make an upgrade pass. Adjust wrapper-owned
adapters only where the reviewed upstream change requires it, then manually try
the affected chat workflows. Use an existing focused test if it helps diagnose a
selection, storage, or connection regression.

## Retained automation

The optional `renderer-update.yml` workflow and updater scripts remain available.
When configured, the workflow can propose an exact renderer pin every six hours,
after main changes, or on manual dispatch. It requires a repository-scoped GitHub
App and repository checks expected by the updater. Those checks are not currently
provided by the quick image publishing workflow; inspect the configuration before
choosing to restore automatic updates.

`node scripts/check-update-setup.mjs` audits the retained automation setup. Missing
App credentials or disabled switches are expected while it is parked and do not
block ordinary development. Do not apply `configure-repository.mjs` as routine
project setup; it changes repository rules for the older automation design.

The updater restricts proposals to renderer lock metadata and refreshes branches
with merge commits. It cannot repair adapters or bypass repository protection.
`HERMES_RENDERER_UPDATES_ENABLED` controls recurring proposals. The updater also
checks `HERMES_PROMOTION_ENABLED` as a readiness flag; neither variable disables
normal publication or deployment after a push to `main`.

To stop recurring proposals if they were previously enabled:

```sh
gh variable set HERMES_RENDERER_UPDATES_ENABLED --body false
```

An existing proposal may still have auto-merge enabled and needs separate
attention. Changing this variable does not roll back a deployed image.
