# Renderer updates and quick image builds

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
   while validating renderer-update automation. The quick image workflow does
   not read either variable: successful builds publish `latest` directly. A
   manual renderer-update dispatch from `main` can validate a proposal without
   enabling recurring triggers. The App remains required.

The App token lets PR creation trigger ordinary checks automatically; using
`GITHUB_TOKEN` can require manual approval of those workflows. See GitHub's
[workflow-trigger guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
and [auto-merge documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request).

Use [one-off validation](upstream-updates.md#one-off-validation-before-activation)
to exercise the real App-driven proposal path while both switches remain disabled.
Before enabling either switch, record a passing candidate and a deliberately
incompatible candidate, verify the failing candidate cannot move stable tags,
exercise storage/update tests through the image, and smoke-test a real configured
Hermes gateway. Include new chat, cancellation, session reopen, Bot selection,
profile switching, file attachment, sign-out and sign-in. Synthetic tests do not
establish compatibility with every backend version. Record the backend version
separately from frontend build metadata. These are initial rollout gates; do not
set the switches merely because unit tests pass.

After those gates and required-check setup, set `HERMES_PROMOTION_ENABLED=true`,
then `HERMES_RENDERER_UPDATES_ENABLED=true` to enable renderer-update automation.
The updater runs every six hours and after changes to `main`. Use
`node scripts/check-update-setup.mjs` to audit configuration without changing it.
See the [upstream update runbook](upstream-updates.md) for branch refresh,
compatibility reports, and the repair process. No workflow restarts a running
deployment.

## Failure handling and promotion

One updater proposal is open at a time. A pending or passing proposal remains
open; a branch behind `main` receives a history-preserving merge and fresh checks.
A failed proposal may be closed after a later revision is proposed on a new
branch; no branch is force-pushed or rebased. No automated dependency changes,
adapter fixes, transform-fixture updates or diagnostic-baseline updates are
allowed. The required policy check validates both filenames and the semantic
lockfile diff. Conservative transform fixtures deliberately stop updates when
an upstream assumption changes; humans review those changes.

`release.yml` is the quick image publisher. It runs on pushes to `main`, version
tags, and manual dispatch. It builds and publishes one native `linux/amd64`
image directly without waiting for compatibility or browser tests. Every
successful build updates `latest` and a commit-specific `sha-<revision>` tag.
Builds from `main` also update `main`; version tags such as `v1.2.3` also publish
`1.2.3`. Docker builds still compile the frontend and use the exact renderer
revision in `flake.lock`. The workflow does not deploy or restart a running
container.

## Disable updates and roll back

Disable scheduling with:

```sh
gh variable set HERMES_RENDERER_UPDATES_ENABLED --body false
```

This leaves any already-open proposal visible; disable its auto-merge explicitly
if it must not land. `HERMES_PROMOTION_ENABLED` controls renderer-update
automation readiness. It does not disable quick image builds or updates to
`latest`.

To roll back a deployment, select a previous immutable image digest from the
registry, set the deployment's image to
`ghcr.io/OWNER/REPOSITORY@sha256:PREVIOUS_TESTED_DIGEST`, and use its normal rollout
procedure. Pulling a digest or publishing an image does not restart production.
Do not rebuild an old commit and call it the same artifact. Keep the current
configuration and volumes; the state migration retains legacy browser records.

## Previous-image upgrade gate

`tests/browser/upgrades.spec.mjs` remains available for manual validation. It
boots the immutable previous image in `tests/fixtures/upgrade-baseline.json`,
opens the real composers in two browser tabs, and switches a stable local origin
to a candidate nginx image. The quick publishing workflow does not run this
suite. It verifies that an active response, unsent file, or conflicting same-session
drafts prevents activation. Once work is safe, both tabs must activate the new
worker, load the candidate's actual entry asset, and retain independent drafts
and conversation selections.

If an older client refuses draft verification, the waiting worker aborts that
transaction and retries the complete handshake once. Every tab must still be
safe, every draft from the first attempt must remain unchanged, and the tab set
must remain the same through final verification. Busy tabs, unsent files,
conflicting drafts, or another refusal keep the update waiting. The real-image
suite injects one refusal and checks that both drafts survive activation and
reload; this retry does not bypass the safety checks.

The initial baseline is the tested PR #36 image, immediately preceding the
browser interruption work. Its digest, wrapper and renderer revisions, and
verification run are recorded together. Baseline changes require review of the
published image's existing test evidence; never replace the baseline with the
candidate under test or a moving tag. The fixture rejects identical wrapper
revisions and image IDs. `scripts/prepare-upgrade-baseline.mjs` fetches the fixed
digest before CI tests, and Playwright records both image IDs and build metadata.

The release workflow targets `linux/amd64`. Its immutable upgrade baseline is
also an amd64 image, so the browser upgrade checks compare images built for the
same platform.

To reproduce locally with a built candidate:

```sh
node scripts/prepare-upgrade-baseline.mjs
HERMES_TEST_IMAGE=hermes-web:verification pnpm exec playwright test tests/browser/upgrades.spec.mjs --project=chromium
```

The tests use a synthetic gateway and do not deploy either image. The separate
real-gateway smoke test and physical-device checks remain release requirements.


## Build identity and rollback verification

The quick image workflow publishes the revision and tags to GHCR directly. Read
the workflow summary for the image digest; pull the `sha-<revision>` tag when a
fixed build is needed, or `latest` for the newest completed build.

The upgrade suite also switches the actual nginx origin from the candidate back
to the immutable previous-image baseline. It requires active responses and
unsent attachments to postpone rollback activation, then verifies both tabs load
the previous entry asset and retain candidate-edited drafts after reload.
`rollback-result` records the tested image references and build identities.
This verifies browser rollback against the synthetic gateway; it does not restart
production or establish compatibility with an arbitrary older renderer/backend.

The [initial candidate and rollback record](release-evidence/2026-09-22-candidate-rollback.json)
identifies a published candidate with passing native amd64/arm64 jobs and a local
amd64 rollback verification. Stable promotion stayed disabled. It explicitly lists
remaining rollout gates and does not claim an automatic renderer-update run or a
real-gateway smoke test.

Before enabling automation, retain a release record plus these observations:

- The compatible renderer-only proposal URL, exact checked head, merge commit,
  publication run, and tested digest; any branch-refresh and retry run links.
- The incompatible proposal and compatibility report, plus stable tag digests
  observed before and after failure.
- The actual gateway version, candidate digest, and observed smoke-test results
  for new chat, cancellation, session reopen, Bot selection, profile switching,
  attachment, sign-out, and sign-in. Keep credentials and private deployment
  addresses out of tracked evidence.
- Physical-device model, OS/browser versions, viewport/scale, and observed results
  for shared actions, focus, drafts, safe update activation, and rollback.

Unavailable evidence remains outstanding. Workflow success, a synthetic gateway,
or touch emulation cannot fill those gaps.
