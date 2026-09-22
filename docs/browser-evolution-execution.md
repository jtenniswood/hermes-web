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
| 3. Compatibility registry | [PR #39](https://github.com/jtenniswood/hermes-web/pull/39) merged; required CI passed | Every transform, replacement, and dependency workaround records ownership, purpose, ordering, fingerprints where applicable, behavioral test, and removal condition; inventory and coverage generated from the registry. |
| 4. Behavioral contracts | Models, commands, and pin/unread ordering merged; shared session entry points under verification | Session/Bot/group/profile commands and archive/delete/pin/unread/approval actions owned by adapters; authoritative upstream state; stale writes prevented at commit ownership; visible action failures; corrective effects removed only after race coverage passes. |
| 5. Shared interaction surfaces | Profile actions and shared toolbar/menu/sheet primitives under verification | Shared action definitions for desktop menus and phone sheets; profile/navigation/settings/Bots migration; mobile reorder disabled, desktop order retained; shell decomposition; brittle selectors removed with owned surfaces; viewport/scale, focus, and draft evidence. |
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
and both previous-image real-composer upgrades passed. Required compatibility and preview CI passed on `015025d`; merge `d5c05ac`.
The committed production image passed the full browser suite. A redundant local
surface run was stopped after startup/reload timeouts under concurrent host load;
that partial run is not passing evidence. The renderer pin remains unchanged.

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

Command-slice validation: production build and typechecking pass. All new action
journeys passed, including negative acknowledgments, unread labels/rejection,
delayed deletion, and approval startup. Local full interruption runs encountered
startup network failures before some existing scenarios began; those runs are
not a complete passing suite. The fixture now starts an isolated browser after
Docker networking is ready. Required compatibility and preview CI passed on `3d4a61e`; PR #40 merged as `b166a5d`.


The profile slice introduces a read-only browser profile model with selection and
ordering commands, and extracts the profile rail from the shell. Delayed Bot
activation now respects the explicit scope at the SDK state write. Profile picks
commit the selected profile and its scope together, replacing the shell's
corrective effect. Startup restoration preserves the existing all-profiles flag
and tab profile key. Hidden-profile preferences retain their component lifetime
when switching navigation tabs.

Eleven targeted browser journeys passed on the development image: startup,
approval/profile behavior, profile menu placement, hide/show, ordering at both
viewports and multiple scales, delayed Bot selection, delayed profile activation,
and draft/scope persistence across reloads. The latter caught an all-profiles
restoration regression that was fixed and verified against the previous image.
Forty-two adapter/registry checks and typechecking passed. Only the two reviewed
SDK/profile transform output fingerprints changed; source hashes and renderer
pin remain fixed. Shared phone action sheets and disabling phone reordering are
still stage 5 work; these browser tests are not physical-device evidence.

The final extracted-component build and typecheck passed. Two final browser
journeys verified scope/draft reload and hidden-profile state across navigation
with preference writes deliberately unavailable. Twenty-three startup/composition
checks also passed. Required compatibility and preview CI passed on `581b394`; PR #41 merged as `5b0d98e`.


## Remaining browser model boundary

The shell now consumes conversation identity/selection, session action, profile,
and gateway-status models. The workspace adapter owns restoration of desktop
session-tile layouts and empty pin-section behavior. Gateway polling remains
mounted for the shell lifetime. The Bots toolbar uses a visibility command
instead of mutating its raw store. No raw store symbols are exported from the
feature-facing UI compatibility module.

The required adapter tests reject raw store imports (including renamed imports),
namespace/dynamic access to upstream modules from features, and raw store exports
from the UI module. Local application error state remains browser-owned. This is
an early stage-6 boundary gate; live updater activation and rollout evidence are
still outstanding. Session/Bot/group selection commands remain stage-4 work.

Local validation: 16 adapter checks, 23 browser composition checks, final
typechecking with no baselined diagnostics, and the production Vite build passed.
Twelve targeted browser journeys passed for pins, panels, navigation, Bots,
gateway dialogs, delayed selection, reconnect, and hidden-Bot visibility across
navigation and reload. The renderer pin and compatibility fingerprints are
unchanged. Required compatibility and preview CI passed on `5b652fe`; PR #42
merged.

## Session selection and interrupted Bot activation

A new real-browser regression reproduced a late Bot activation replacing a newer
session-row selection on the preceding model-boundary image. After selecting
“All profiles” and the ordinary conversation, releasing Research's held profile
listing navigated back to Research.

The browser session command preserves the clicked row's connection and profile,
clears stale owner hints for untagged rows, and invalidates older Bot intent
before invoking the existing engine navigation. Bot navigation now checks that
intent at the SDK commit point instead of bypassing cancellation. Canonical Bot
lookup and retry retain the caller's selection guard; returning to a Bot while
its earlier activation is pending can resolve the newest intent.

The renderer revision and source fingerprints remain fixed. Three generated
transform outputs were reviewed for these changes. This slice covers session-row
selection; browser-owned Bot/group commands remain outstanding. Validation of
the candidate passed: 66 adapter/composition/registry checks, three command
checks, typechecking with no baselined diagnostics, and a production build. Six
targeted browser interruption journeys passed, including the reproduced
Bot-to-session regression and returning to a Bot while its earlier activation is
pending. The latter initially used a session ID where the browser contract
exposes a Bot identity; the corrected identity and transcript assertions passed.
Required compatibility and preview CI passed on `f70b0a5`; PR #43 merged as
`ae4c47d`.

## Bot and group selection commands

Roster clicks now resolve the exact Bot key through the current
engine roster and open it through a browser command. Missing owners and current
activation failures reach the shared error surface; failures from superseded
operations stay quiet. Existing and newly created groups use the same browser
command and retain the engine's authoritative room and composer state.

The group interruption journey exposed a shell effect that always revealed the
ordinary workspace after selection, hiding the group pane the engine had just
opened. Removing that corrective effect lets the selection owner control which
conversation is visible. Returning to an ordinary session also clears group
selection without deleting the retained room or its draft.

Validation: 67 command, fixture, browser composition, and compatibility checks
passed. Final typechecking and the production build passed. The final image
passed Bot A/B ordering, interrupted group activation with both drafts retained,
creating a group through the real dialog, and navigation/draft checks at 390px
and 1440px. Adjacent panel, modal, rejected
Bot activation, and Bot-to-session journeys passed on the preceding candidate.
Local startup failures were traced to `ERR_NETWORK_CHANGED` while fetching React;
those failed runs are not full-suite passing evidence. Required compatibility,
preview, and update-policy CI passed on `4b5b856`; PR #44 merged as `dc09019`.

The registry now has 67 owned entries, including two reviewed group callback
integrations. Renderer revision and existing source fingerprints remain fixed.
Other session entry points and concurrent persisted-action writes still need
stale-operation review before stage 4 is complete.

## Ordered unread writes

A browser regression reproduced an older failed unread request rolling the UI
back after newer toggles had succeeded on the gateway. The browser adapter now
serializes backend writes per session/profile, shares the queue with automatic
read-on-open, and lets only the latest intent commit rollback or report failure.
A latest failure restores the last confirmed value; a negative acknowledgment
is a failure. The browser action model retains pending intent through stale list
refreshes, while the engine's session rows and unread guard remain authoritative.

The replacement is registered with the reviewed upstream module fingerprint.
Both relative and aliased imports resolve to this one owner. Existing renderer
revision and source fingerprints remain fixed.

Validation: 37 unread and registry checks passed, along with typechecking and
the production build. Six targeted Chromium journeys passed against the local
candidate image, including manual overlap, delayed backend writes, negative
acknowledgments, and automatic read-on-open. The automatic-read journey initially
used an incorrect exact button locator; it passed after using the established
session-title locator. Required compatibility, preview, and update-policy CI
passed on `14389fe`; PR #45 merged as `de6db1b`. Pin persistence and remaining
selection entry points still need review before stage 4 is complete.

## Ordered pin persistence

Two browser regressions reproduced the remaining pin failures: a rejected pin
showed no error, and an older delayed pin could reach the gateway after a newer
unpin, leaving the gateway pinned. The browser write owner now serializes writes
per session/profile, rejects negative acknowledgments, and restores the last
confirmed choice with a visible error when the latest intent fails. Superseded
failures cannot change mirror bookkeeping or report a false failure.

A registered transform connects the existing engine reconciliation to this
owner. It retains saved order, durable lineage IDs, active-profile resolution,
remote-pin adoption, and deferred resolution through all session slices. Pending
writes fence stale list pages; a gateway rescope discards queued requests and
invalidates older callbacks. A failed unpin restores its position in the saved
order; the corresponding regression failed before that fix. An explicit retry
remains available after rollback.

Validation so far: 41 pin-owner and registry checks passed, typechecking passed
with no baselined diagnostics, and the production build passed. Four targeted
Chromium journeys passed against the candidate image, covering pin rejection,
unpin rejection and retry, delayed writes, and negative acknowledgments. Existing
pinned-section visibility checks also passed at 390px and 1440px. Required
compatibility, preview, and update-policy CI passed on `213e289`; PR #46 merged
as `fb6770b`. The renderer revision and existing compatibility fingerprints
remain fixed.

## Shared session entry points

Browser regressions reproduced delayed Bot activation replacing both a session
chosen from the picker and a fresh-chat draft. Cancellation and group-identity
release now belong to the shared session-opening and fresh-draft entry points.
The row command retains its explicit owner-hint policy. Bot-scoped opens keep
their own generation and workspace ownership.

Typed `/resume` now requests navigation through the shared opener before the
route-resume owner loads the session. Directly loading it under the previous
route allowed that route to restore the old conversation. Command Center also
reproduced opening a desktop-style tab while leaving the browser route unchanged;
ordinary tab, window, and stack intents now use the browser's single conversation
surface.

The fixture explicitly supports slash completion and the Command Center's empty
read-only catalogs, and separates archived session queries. Unsupported writes
remain errors. Registry entries cover the two additional engine entry points;
the reviewed wiring output changes while its pinned input remains unchanged.

Validation: 52 selection-owner, fixture, and registry checks passed, along with
typechecking with no baselined diagnostics and the production build. Seven
targeted Chromium journeys passed on the final local image: picker, fresh chat,
typed resume, Command Center, Bot A/B ordering, returning to a pending Bot, and
group selection with retained drafts. Local host process exhaustion and
network-change asset failures interrupted earlier attempts; those runs do not
count as passing application evidence. Required CI must verify the committed
production image before merge.

The first full CI run caught a fixture regression in Settings: enabling schema
reads exposed an optional model-preset endpoint returning an incomplete object.
The fixture now returns a valid empty auxiliary-model catalog and an explicit
unavailable response for unsupported mixture-of-agents presets. Both affected
Settings journeys pass locally; the updated commit still requires full CI.

## Shared profile interaction surfaces

Profile actions now use one browser-owned action list, rendered as an anchored
desktop menu or a modal phone sheet. A visible actions button provides access
without a right-click or long press; desktop profile context menus remain
available. The profile heading leaves the existing avatar rail width intact.

A shared toolbar control and viewport hook replace the shell's local versions.
The action surface owns keyboard navigation, sheet focus trapping, scaled
positioning, and dismissal. Escape and selection restore the opening control
(or the actions button when the profile disappears); clicking another control
retains that new focus target. Closing a sheet does not close the navigation
drawer. The old profile-specific manual menu listeners and CSS are removed.

Phone profiles disable native dragging and reject drag/drop commands. Desktop
reordering and saved order remain intact, including after viewport changes.
Hidden-profile state retains its existing mounted lifetime and storage key.

Validation: typechecking and the production build passed. All 16 adapter checks
passed, including the browser raw-store boundary check. Eleven targeted Chromium
journeys passed on the final local image, covering desktop dragging and context
menus, action parity at 390px/1440px and 100%/150% scale, focus and drafts,
emulated touch taps, saved-order preservation, and unavailable preference
storage. An initial layout regression and an outside-click focus regression
were caught and fixed before this passing run. Screenshots were captured at
each tested viewport/scale. Required CI is still needed for the committed image.

This is the first stage 5 slice. Navigation, settings, and Bots controls, further
shell extraction, and physical-device touch validation remain outstanding.
Updater App setup remains deferred and automation remains disabled.
