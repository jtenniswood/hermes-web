# Renderer updates and tested image releases

`flake.lock` is the only renderer pin. Normal Docker, development and Nix builds
use its exact commit; they do not resolve upstream `main`. The updater resolves
`main` once, obtains its Nix source metadata and proposes only the three
`nodes.hermes.locked` fields: `rev`, `narHash`, `lastModified`.

## Review and initial enablement

The foundation PRs require human review and sequential merges. The repository
setup command enables auto-merge as a repository capability, but does not enable
it on architecture/interface PRs. It creates an additive ruleset for `main`,
preserving other rulesets and legacy protection. The required checks are
`compatibility` and, after the release foundation lands, `renderer-update-policy`.
Force pushes and branch deletion are disallowed; branches must be current.

```sh
node scripts/configure-repository.mjs             # inspect the exact settings
node scripts/configure-repository.mjs --apply     # compatibility check first
# Only after the release foundation lands and its policy check exists on main:
node scripts/configure-repository.mjs --automation --apply
```

The repository owner must create and install a GitHub App. This cannot be
completed with a normal repository token alone:

1. Open [New GitHub App](https://github.com/settings/apps/new). Use a unique name
   such as `hermes-web-renderer-updater-OWNER`, the repository URL as homepage,
   no OAuth callback and no active webhook. Limit installation to your account.
2. Grant **Contents: Read and write** and **Pull requests: Read and write** only;
   metadata read access is implicit. Do not grant administration, actions,
   secrets, environments or organization permissions.
3. Install it on **only this repository**. Generate a private key and put the
   PEM contents directly in the repository Actions secret
   `HERMES_UPDATER_PRIVATE_KEY`. Never paste the key into a task or commit it.
4. Set Actions variables `HERMES_UPDATER_APP_ID` and `HERMES_UPDATER_LOGIN` (the
   App's bot login, ending in `[bot]`). The workflow scopes its installation
   token to this repository and those two write permissions. A separate
   read-only workflow token inspects check results.
5. Keep `HERMES_RENDERER_UPDATES_ENABLED` and `HERMES_PROMOTION_ENABLED` unset
   while validating the initial release. The schedule and stable promotion are
   independent switches. A manual release run can still build/test candidates.

The App token lets PR creation trigger ordinary checks automatically; using
`GITHUB_TOKEN` can require manual approval of those workflows. See GitHub's
[workflow-trigger guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
and [auto-merge documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request).

Before enabling either switch, record a passing candidate and a deliberately
incompatible candidate, verify the failing candidate cannot move stable tags,
exercise storage/update tests through the image, and smoke-test a real configured
Hermes gateway. Include new chat, cancellation, session reopen, Bot selection,
profile switching, file attachment, sign-out and sign-in. Synthetic tests do not
establish compatibility with every backend version. Record the backend version
separately from frontend build metadata. These are initial rollout gates; do not
set the switches merely because unit tests pass.

After those gates and required-check setup, set `HERMES_PROMOTION_ENABLED=true`,
then `HERMES_RENDERER_UPDATES_ENABLED=true`. The updater runs every six hours
and after changes to `main`. Use `node scripts/check-update-setup.mjs` to audit
configuration without changing it. See the [upstream update runbook](upstream-updates.md)
for branch refresh, compatibility reports, and the repair process.
No workflow restarts a running deployment.

## Failure handling and promotion

One updater proposal is open at a time. A pending or passing proposal remains
open; a branch behind `main` receives a history-preserving merge and fresh checks.
A failed proposal may be closed after a later revision is proposed on a new
branch; no branch is force-pushed or rebased. No automated dependency changes,
adapter fixes, transform-fixture updates or diagnostic-baseline updates are
allowed. The required policy check validates both filenames and the semantic
lockfile diff. Conservative transform fixtures deliberately stop updates when
an upstream assumption changes; humans review those changes.

`release.yml` is the only image publisher. It first runs compatibility checks,
then builds separate native amd64/arm64 candidates, tests nginx and browser
behavior against each exact digest, and combines the passing digests. Candidate
names contain both full revisions and a workflow run/attempt identity. Artifacts
include candidate evidence, screenshots and failure traces. `/build-info.json`
contains wrapper/renderer revisions, dependency-lock hash, timestamp and channel;
OCI labels identify wrapper and renderer too.

Promotion is serialized and refuses a source that is no longer current `main`.
Main releases move `main` and `latest`; a merged App renderer update also moves
`nightly`. Version tags such as `v1.2.3` publish `1.2.3` through the same checks and
must point to current main. Tags always reference the tested multi-architecture
digest. Candidate images are never used as moving stable aliases until all gates
pass. A failed build/test retains the last stable digest.

## Disable updates and roll back

Disable scheduling with:

```sh
gh variable set HERMES_RENDERER_UPDATES_ENABLED --body false
```

This leaves any already-open proposal visible; disable its auto-merge explicitly
if it must not land. Disable stable promotion separately with:

```sh
gh variable set HERMES_PROMOTION_ENABLED --body false
```

To roll back a deployment, select the previous tested digest from the release
summary, set the deployment's image to
`ghcr.io/OWNER/REPOSITORY@sha256:PREVIOUS_TESTED_DIGEST`, and use its normal rollout
procedure. Pulling a digest or publishing an image does not restart production.
Do not rebuild an old commit and call it the same artifact. Keep the current
configuration and volumes; the state migration retains legacy browser records.
