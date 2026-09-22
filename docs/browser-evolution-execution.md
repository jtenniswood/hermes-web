# Browser ownership and automatic upstream updates

Status: execution in progress. This record follows the September 22 reset review
and the accepted six-stage delivery plan. Completion requires the evidence below;
a merged PR alone does not establish an entire stage's acceptance criteria.

## Target and invariants

Hermes Web owns its browser experience through explicit conversation/action and
panel contracts. The upstream engine remains authoritative for chat state.
Compatible renderer changes must move through automatic proposal, verification,
merge, and tested-image publication without manual code changes. Incompatible
changes stop with repair evidence and preserve the last stable image.

Preserve credentials, storage keys, text drafts, composer/recording lifetime,
contributed panels, and the single-conversation experience. Do not modify fetched
renderer sources or create a second writable conversation store. Keep renderer
upgrades separate from architecture changes where feasible. Keep npm, Actions,
Nix, and gateway upgrades independently reviewed. Image publication and production
deployment remain separate. Never rewrite branch history or build Nix on the VPS.

## Delivery and evidence

| Stage | State | Required evidence |
| --- | --- | --- |
| 1. Update foundation | PR #36 merged; activation prerequisites inventoried | Required compatibility and preview checks passed on `57b6854`; merge `c282dc0`. Read-only audit identifies outstanding App and repository setup. |
| 2a. Interruptions | [PR #37](https://github.com/jtenniswood/hermes-web/pull/37) merged; required CI passed | Strict fixture operations, controllable delay/rejection/disconnection; Bot A/B out-of-order completion, profile changes during Bot activation, reconnect, rejected archive/delete/approval, and draft isolation exercised in the real UI. |
| 2b. Real upgrades | [PR #38](https://github.com/jtenniswood/hermes-web/pull/38) merged; required CI passed | Previous supported image to candidate with the real composer, multiple tabs, active responses, unsent attachments, retained protocol tests, and preserved drafts. |
| 3. Compatibility registry | Implemented; verification in progress | Every transform, replacement, and dependency workaround records ownership, purpose, ordering, fingerprints where applicable, behavioral test, and removal condition; inventory and coverage generated from the registry. |
| 4. Behavioral contracts | Outstanding | Session/Bot/group/profile commands and archive/delete/pin/unread/approval actions owned by adapters; authoritative upstream state; stale writes prevented at commit ownership; visible action failures; corrective effects removed only after race coverage passes. |
| 5. Shared interaction surfaces | Outstanding | Shared action definitions for desktop menus and phone sheets; profile/navigation/settings/Bots migration; mobile reorder disabled, desktop order retained; shell decomposition; brittle selectors removed with owned surfaces; viewport/scale, focus, and draft evidence. |
| 6. Enforcement and activation | Outstanding | No new raw store dependencies in browser features; existing image gates retained; compatible and incompatible update demonstrations, branch refresh/retry/rollback evidence, real-gateway smoke and real-device touch verification; activation only after evidence is recorded. |

The user explicitly deferred updater App setup. Continue independent code and
verification work while App setup and final activation remain pending. Do not
treat simulated CLI tests as a live proposal/merge/publication demonstration,
browser emulation as physical-device verification, or synthetic gateway tests as
an authenticated gateway smoke test.

## Implementation order

1. Establish the interruption fixture and reproduce current behavior. Fix proven
   regressions in reviewable commits without weakening the assertions.
2. Add the real-composer previous-image upgrade fixture as a separate delivery.
3. Consolidate compatibility metadata, then migrate commands using the behavioral
   tests. Introduce selection guards at the state commit owner, not only callers.
4. Migrate UI feature by feature: profiles, navigation, settings, and Bots. Keep
   contributed content and composer lifecycles stable throughout.
5. Enforce boundaries and gather release evidence. Prepare App setup independently;
   do not enable the switches until its installation and rollout gates pass.

Use fresh `codex/` branches and reviewable PRs. Record actual image identities,
commands, outcomes, and remaining gaps in each delivery. Keep the renderer pin
fixed during structural changes. See [the upstream update runbook](upstream-updates.md)
for operation/repair and [release setup](releases.md) for credentials and rollback.

## Interruption evidence

The strict gateway exposes holds, one-shot rejections, and disconnects only to
its in-process test controller. Unexpected HTTP/RPC operations fail and are
attached to the Playwright report. Each journey has an isolated gateway and
nginx container; response barriers observe the actual browser WebSocket reply.

The seven Chromium journeys passed with the real composer: out-of-order Bot
responses and independent drafts; profile choice during delayed activation;
reconnect; rejected archive, delete, and approval changes; and a delayed archive
finishing after navigation. These tests exposed silent failures and stale profile
publication. The fixes display dismissible errors, guard profile publication at
the upstream adapter, and preserve a newer selected conversation when a mutation
finishes. Browser commands and shell decomposition remain stage 4 work.

Local verification: five gateway tests, fourteen adapter tests, typechecking,
Vite build, and all twenty-nine source fingerprints passed. The local nginx test
image was `sha256:ca40ab5b8994dbac16b764a8d83516c3777e965f7b81a8da618362faf6dfe47f`,
using renderer `03b0c7947262b220f5148b75a30bb7a3faddcbb2` and synthetic gateway
`synthetic-preview-v1`. Its assets contain the working-tree changes on base
`c282dc0`; this is development evidence, not an exact-commit release attestation.
CI must build and test the committed revision before merge.

Reproduce against a built nginx image:

```sh
node --test scripts/preview-gateway.test.mjs scripts/adapter.test.mjs
HERMES_TEST_IMAGE=hermes-web:verification pnpm exec playwright test tests/browser/interruptions.spec.mjs --project=chromium
```

## Real-composer upgrade evidence

Both Chromium upgrade journeys passed locally through the two actual nginx
images. The baseline is the verified PR #36 digest recorded in
`tests/fixtures/upgrade-baseline.json`; the candidate is the development image
identified above. One journey starts a response through the real composer in a
second tab, verifies blocked activation, resolves the response, attaches an
actual text file through the picker, verifies blocked activation again, removes
the file, then activates and verifies both tabs' drafts and selected sessions.
The other journey confirms conflicting edits to the same conversation prevent
activation while preserving each tab's in-memory text.

The fixture launches its browser after both Docker containers are ready, switches
a stable origin between images, and records image IDs, platforms, wrapper and
renderer revisions, and synthetic gateway version. It checks the candidate's
actual entry asset after reload. The existing lower-level protocol suite remains
in the required jobs. Required compatibility and preview CI passed on `b26bee0`; merge `52cf968`.
Native release-candidate validation remains pending; these tests do not establish
a real-gateway or physical-device result. See [release setup](releases.md#previous-image-upgrade-gate)
for baseline maintenance and the initial arm64 emulation distinction.

## Activation checklist

- [ ] Install the repository-scoped updater App; set App ID, bot login, and key secret in GitHub (deferred by user).
- [ ] Require the strict `renderer-update-policy` Actions check alongside `compatibility`.
- [ ] Verify a compatible update through proposal, tests, merge, and exact-digest image publication.
- [ ] Verify a deliberately incompatible candidate cannot move stable image tags.
- [ ] Exercise branch refresh and retries; demonstrate rollback to the previous tested digest without clearing user state.
- [ ] Smoke-test the real configured gateway and record its version.
- [ ] Verify the touch journeys on physical devices and record device/browser versions.
- [ ] Record wrapper revision, renderer revision, dependency-lock hash, test results, and tested image digest together.
- [ ] Enable scheduling and stable promotion after the evidence is complete.

The implementation and goal remain incomplete while any required item lacks
authoritative evidence, even if all currently implemented tests pass.

## Compatibility registry evidence

The unified registry declares 65 compatibility entries and 52 distinct input
fingerprints. It drives browser transform sequences, module replacements,
renderer/Vite aliases, and dependency workarounds. Each entry identifies an owner,
purpose, order, behavioral verification path, and removal condition. Source
contracts also cover the shared renderer modules and installed dependencies.

`docs:compatibility` generates the inventory and TypeScript aliases without
changing reviewed fingerprints. The extended preflight emits the affected owners
and interventions plus a declared verification coverage report. Missing
install-time dependencies are identified separately from missing renderer files;
the build requires every dependency fingerprint after installation.

Local verification: 100 foundation tests, typechecking with no upstream baseline,
a production Vite build, all 52 input contracts, seven interruption journeys,
and both previous-image real-composer upgrades passed. Broader browser surface
checks and exact-commit CI remain pending. The renderer pin remains unchanged.

## Browser command migration

The first command slice moves selected-session archive, delete, pin, unread, and
approval-mode reads/writes out of feature components into adapters with browser
contracts. The adapters continue to use authoritative upstream stores, preserve
newer navigation when a mutation finishes, and display failed or unconfirmed
operations. The chat action menu now receives the persisted unread state.

This slice does not complete stage 4: selection commands, profile/navigation
models, remaining raw store consumers, and removal of corrective effects still
need their own migration and interruption evidence. Additional journeys cover
unread rejection, delayed deletion, and negative mutation acknowledgments.
