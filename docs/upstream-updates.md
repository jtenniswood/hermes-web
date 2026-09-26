# Automatic upstream updates

Hermes Web consumes `apps/desktop` and `apps/shared` from one exact
`NousResearch/hermes-agent` revision in `flake.lock`. Both move together. The
wrapper's UI, adapter, dependency lock, and reviewed compatibility fingerprints
stay owned by this repository.

The acceptance rule is: a compatible renderer update can be proposed, verified,
merged, and published without a manual code change. An incompatible update
must stop with evidence, while the last tested image remains available.

## Mechanisms

| Mechanism | Behavior |
| --- | --- |
| `renderer-update.yml` | Checks upstream every six hours and after changes to `main`; manual dispatch can validate one exact revision while recurring triggers remain disabled. |
| Proposal reconciliation | Keeps pending or passing work, refreshes branches behind `main` with a merge commit, and leaves conflicting or draft proposals for review. |
| Candidate policy | Only the three renderer lock metadata fields may change. Existing proposals are revalidated before updater actions. |
| Compatibility preflight | Reports every changed or missing source fingerprint from the compatibility registry, with expected/actual hashes, affected interventions, ownership, verification paths, and candidate identity. |
| Required compatibility job | Runs transform, type, dependency, routing, production-build, and browser checks after preflight passes. |
| Tested-image release | Tests each architecture's exact image digest before stable promotion. It does not restart a deployment. |

The updater uses a repository-scoped GitHub App so its pushes trigger ordinary
PR checks. Branch refresh uses GitHub's
[update-branch endpoint](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch)
with the inspected head SHA; it merges `main` and never force-pushes. Missing,
pending, skipped, or unknown required check results never count as success in
the updater's reconciliation decision. Repository protection remains the final
merge gate.

Failed proposals for the latest upstream revision remain open. A newer revision
may replace a completed failed proposal, but the replacement must be created
before the old proposal closes. Run attempts use distinct branch names. Drafts,
conflicts, multiple open proposals, and human edits outside the renderer-only
policy require review rather than automatic repair.

## Enablement

1. Merge the automation changes through normal review and compatibility checks.
2. Follow [release setup](releases.md#review-and-initial-enablement) to install
   the repository-scoped App and configure its ID, bot login, private-key secret,
   required checks, and repository auto-merge. Merge commits must be allowed.
3. Run `node scripts/check-update-setup.mjs` from an authenticated checkout.
   It only reads repository settings, variables, and secret names. It reports
   missing items and exits unsuccessfully until all settings and switches are
   ready. Before activation, the two disabled switches are expected findings.
   An inaccessible setting is an inspection failure, never a passing result.
4. Use the one-off validation procedure below for the compatible and deliberately
   incompatible candidates while scheduling and stable promotion remain disabled.
   Complete state/update tests and a real-gateway smoke test.
   Retain the workflow links, candidate digest, renderer revision, and tested
   gateway version in the release evidence. The setup audit cannot verify App
   key validity, installation permissions, or this behavioral evidence.
5. Enable `HERMES_PROMOTION_ENABLED`, then `HERMES_RENDERER_UPDATES_ENABLED`,
   and manually dispatch `renderer-update.yml`. Check its summary and the
   resulting proposal. Subsequent scheduled runs continue automatically.

Do not enable these switches just because a setup audit or source preflight
passes. A renderer update reaches production only after it passes the required
checks, merges to `main`, and the main-branch image publish and deployment
complete.

## One-off validation before activation

After the App is configured and both strict Actions checks are required, dispatch
from `main` without enabling scheduled proposals. The same App identity, token
scope, renderer-only policy, compatibility jobs, and protected auto-merge apply.
A passing proposal can merge into `main` and publish a tested candidate. Stable
promotion still requires its separate switch. Once an accepted proposal merges
to `main`, the normal main-branch deployment workflow updates production.

Choose a reviewed full upstream commit and set `REVIEWED_RENDERER_SHA` to that
40-character revision. Then run:

```sh
gh workflow run renderer-update.yml --ref main --field renderer_revision="$REVIEWED_RENDERER_SHA"
gh run list --workflow renderer-update.yml --event workflow_dispatch --limit 5
```

Leave the input empty to resolve upstream `main` once. Exact revision overrides
are accepted only for manual runs from this repository's `main`. Scheduled and
push-triggered runs remain disabled until `HERMES_RENDERER_UPDATES_ENABLED=true`;
the updater script also enforces this when invoked directly. Manual dispatch
does not alter either enablement variable or supply missing App credentials.

There is still at most one proposal. A manual exact revision cannot silently
merge or refresh an unrelated passing/pending proposal: finish or retire that
proposal first. A completed failed proposal may be replaced using the existing
create-before-close policy. If the requested revision itself fails, retain its
compatibility artifact and stable-tag observations before proceeding.

To exercise refresh, advance `main` through a normal reviewed change, then
redispatch the same exact candidate. The updater requests a merge of `main` into
the proposal using its inspected head SHA; fresh checks must pass. To retry a
transient CI failure, rerun that proposal's failed workflow using
`gh run rerun RUN_ID --failed`, then redispatch the same candidate if protected
auto-merge needs to be restored. Do not change fingerprints to make a retry pass.
Retain the actual proposal, checked heads, run attempts, merge, publication, and
stable-tag observations as described in [release evidence](releases.md#retained-release-identity-and-rollback-verification).

## Reading a blocked update

Open the proposal's `compatibility` run. Its summary and
`upstream-compatibility-<commit>` artifact contain the source preflight report.
The JSON records wrapper/renderer identity, dependency-lock hash, manifest,
contract purpose, expected source hash, observed hash, and result. The preflight
uses the existing manifests; it does not claim to cover every browser-plugin
rewrite or to prove runtime compatibility. Later build and behavior checks remain
mandatory. A preparation failure can prevent a report from being generated;
inspect the failed preparation step in that case.

| Failure | Process |
| --- | --- |
| Changed/missing source contract | Review the PR's upstream comparison and affected modules. Determine whether the adapter still preserves the documented behavior. |
| Dependency, type, transform, or build failure | Inspect the failed step; propose the required wrapper/dependency repair with focused regression coverage. |
| Browser or gateway failure | Use retained screenshots/traces and reproduce the failing journey. Keep stable on the previous tested digest. |
| Temporary CI or network failure | Rerun the failed checks on the same proposal; do not edit fingerprints. |
| Behind `main` | The next updater run requests a merge of `main`, triggering fresh checks. Manual dispatch can expedite this. |
| Conflict or human-modified proposal | Review and repair through a manual PR, or retire the obsolete proposal after preserving its evidence. Do not force-push. |
| Missing checks or permission failure | Run the setup audit and inspect the workflow logs. Restore the App/check configuration before retrying. |

## Repairing compatibility

Use a normal developer-authored PR when an update needs adapter, dependency,
or fingerprint changes. Keep fetched renderer directories untouched. Review
each changed fingerprint against the upstream diff; change a transform only
with a test for its behavior. Automatic fingerprint regeneration and automatic
diagnostic-baseline expansion are prohibited.

If the repair supports the current pin as well, merge it first and let the
updater refresh/retry. If it only works with the new renderer, make the pin and
repair one manual-review PR, then retire the obsolete bot proposal. The next
scheduled run starts from the merged pin. This prevents an intermediate broken
main branch and keeps renderer-only automatic PRs narrow.

Local entry points:

```sh
node scripts/check-update-setup.mjs
node scripts/renderer.mjs --check
node scripts/renderer-compatibility-report.mjs
corepack pnpm typecheck
corepack pnpm test:foundation
```

Reports default to ignored `test-results/upstream/`. A report never edits
upstream sources, manifests, or locks. CI performs full builds and image tests;
do not build Nix locally on the VPS.

## Scope and rollback

Npm packages, GitHub Actions, Nix inputs, and the separately deployed gateway
are not silently upgraded by the renderer updater. Review those independently
through the same relevant compatibility checks. Record supported gateway
versions from actual smoke tests rather than assuming the renderer pin also
updates the running backend.

To pause proposals, disable `HERMES_RENDERER_UPDATES_ENABLED`. Also disable
auto-merge on an already-open proposal if it must not land. Disable
`HERMES_PROMOTION_ENABLED` separately to stop stable tag movement. Roll a
deployment back to its previous tested digest using the
[release rollback procedure](releases.md#disable-updates-and-roll-back), keeping
configuration and browser state intact.

## Maintaining compatibility entries

`apps/web-desktop/src/upstream/compatibility-registry.json` is the source of truth
for renderer transforms, browser transforms, module replacements, resolution
workarounds, runtime assets, and composition contracts. Each entry identifies its
owner, purpose, application order, behavioral verification, and removal condition.
Source fingerprints cover both renderer and shared modules. Dependency inputs
are reported as pending before installation and required by the production build
after installation.

The generated [inventory](browser-transform-inventory.md) and preflight
`compatibility-coverage.json` describe declared verification paths. They are not
measured code coverage or proof that a test passed. Required CI supplies execution
evidence. Browser transform inputs and outputs are checked, including the
renderer-then-activity-filter sequence; generated TypeScript aliases and Vite
resolution read the same registry.

When reviewing an intentional compatibility change, inspect the source and
behavior, update only the relevant reviewed fingerprint, then run:

```sh
pnpm docs:compatibility
pnpm check:compatibility-registry
pnpm check:upstream
```

Documentation generation never recalculates fingerprints or accepts upstream
changes. A changed dependency, missing test reference, invalid ordering, stale
inventory, or incomplete transform must be repaired explicitly. Keep the
behavioral tests required by each affected entry in the verification run.
