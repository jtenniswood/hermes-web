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
| 1. Update foundation | PR #36 merged; activation prerequisites inventoried | Required compatibility and preview checks passed on `57b6854`; merge `c282dc0`. Read-only audit confirms strict compatibility and renderer-update-policy checks; App credentials and activation remain outstanding. |
| 2a. Interruptions | [PR #37](https://github.com/jtenniswood/hermes-web/pull/37) merged; required CI passed | Strict fixture operations, controllable delay/rejection/disconnection; Bot A/B out-of-order completion, profile changes during Bot activation, reconnect, rejected archive/delete/approval, and draft isolation exercised in the real UI. |
| 2b. Real upgrades | [PR #38](https://github.com/jtenniswood/hermes-web/pull/38) merged; required CI passed | Previous supported image to candidate with the real composer, multiple tabs, active responses, unsent attachments, retained protocol tests, and preserved drafts. |
| 3. Compatibility registry | [PR #39](https://github.com/jtenniswood/hermes-web/pull/39) merged; required CI passed | Every transform, replacement, and dependency workaround records ownership, purpose, ordering, fingerprints where applicable, behavioral test, and removal condition; inventory and coverage generated from the registry. |
| 4. Behavioral contracts | Models, commands, ordered writes, and shared session entry points merged | Session/Bot/group/profile commands and archive/delete/pin/unread/approval actions owned by adapters; authoritative upstream state; stale writes prevented at commit ownership; visible action failures; corrective effects removed only after race coverage passes. |
| 5. Shared interaction surfaces | Profile, navigation, settings, mounted tool workspaces, Bots toolbar and roster actions merged; sidebar styling/touch refinement under verification | Shared action definitions for desktop menus and phone sheets; profile/navigation/settings/Bots migration; mobile reorder disabled, desktop order retained; shell decomposition; brittle selectors removed with owned surfaces; viewport/scale, focus, and draft evidence. |
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
- [x] Require the strict `renderer-update-policy` Actions check alongside `compatibility` (read-only setup audit reconfirmed September 22).
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
each tested viewport/scale. PR #48 passed all required checks on its refreshed
head `4dc4947` and merged as `bc0ccb2`.

This is the first stage 5 slice. Navigation, settings, and Bots controls, further
shell extraction, and physical-device touch validation remain outstanding.
Updater App setup remains deferred and automation remains disabled.

## Shared navigation controls

Navigation preferences, tab selection, drawer focus/dismissal, and resizing now
have browser-owned components and a dedicated hook outside the shell. The shell
composes the existing panes without changing their mounted lifetime. The old
manual tab-menu listeners and styles are replaced by
the shared action surface, extended with checked actions that can stay open.

A visible navigation-actions button exposes the same tab-visibility commands as
the desktop context menu through a phone sheet. Both surfaces enforce at least
one visible tab and switch to a visible tab when the current one is hidden.
Stored tab visibility, active tab, and panel width retain their existing keys.

A regression reproduced the previous divider moving 135 physical pixels after
a 90-pixel drag at 150% UI scale. Resizing now converts pointer motion to the
scaled layout coordinates; keyboard resizing retains its bounds and saved width.

Validation: the production build, typechecking with no baselined diagnostics,
and all 16 adapter checks passed. Five navigation journeys passed through the
local image: menu/sheet parity at 390px/1440px and 100%/150% scale, retained
drafts and routes, persisted tab visibility, last-tab protection, arrow-key
navigation, focus restoration, and scaled pointer/keyboard resizing. Seven
existing profile and drawer journeys also passed on the same candidate. Initial
desktop keyboard checks moved focus before menu dismissal restored it; the tests
now wait for that required focus state before exercising arrow navigation.
PR #49 passed all required checks on refreshed head `5385fd4` and merged as
`13d9b81`.

Settings and Bots controls, shared navigation sections/modal composition, and
physical-device verification remain stage 5 work. This does not enable updater
automation or change the renderer pin.

## Session entry points, profile, and navigation merges

PR #47 passed required compatibility, preview, and update-policy CI on
`c191df1` and merged as `d60651b`. A compatibility run had stopped before its
reconnect scenario because an initial asset request hit `ERR_NETWORK_CHANGED`;
the trace identified that startup failure, and the unchanged commit passed on
rerun. Stage 4's browser commands and shared selection owners are now merged.

PR #48 passed all required checks on `c69d74c`. After PR #47 merged, the
repository required its branch to be up to date with `main`. The branch was
refreshed with a history-preserving merge as `4dc4947`; all required checks passed
again before merge `bc0ccb2`. PR #49 likewise refreshed to `5385fd4`, passed its
required checks, and merged as `13d9b81`. No branch protection was bypassed.


## Shared settings and overlay focus

Settings now defines one action list for desktop menus and phone sheets, with
shared groups, icons, checkbox state, and toolbar controls. An adapter projects
activity notifications and contributed panel visibility from their upstream
stores and rereads those stores when invoking a command. Contributed panels
retain their existing lifecycle and narrow-screen reveal behavior. The More/Less
disclosure and Gateway modal now use shared browser components.

Actions that open another surface run after the old menu or sheet has released
its focus scope. Workspace overlays own initial focus, nested-surface-aware Tab
containment, and return focus. A real-browser regression exposed the composer's
automatic visibility effect overriding the restored toolbar button. That effect
now yields while the overlay's return target retains focus; blur releases the
claim, and explicit composer focus commands remain available. Both source
interventions have reviewed registry fingerprints and removal conditions. The
renderer pin and existing reviewed transform fingerprints are unchanged.

Validation: 52 adapter/registry checks, 23 browser composition checks,
typechecking, and the production build passed. All 25 targeted Chromium journeys
passed on the final development image, including settings, contributed panels,
notifications, disclosure, Gateway, profile/navigation controls, full-page modal
route return, and Command Center. The new focus matrix covers both viewport sizes
and scales, draft preservation, Tab wrapping, toolbar focus restoration, and an
explicit composer focus shortcut. Required CI for the committed image is pending.

Stage 5 remains incomplete. Bots action surfaces still need migration. The
full-page Capabilities, Messaging, and Artifacts modal routes unmounted the
workspace when this settings slice began. The following slice addresses composer
DOM identity and unsent attachments with separate ownership and real-composer
tests. Do not
infer composer-lifetime proof from text-draft restoration alone. Physical-device
touch verification remains pending. Updater App setup is deferred and scheduling
and stable promotion remain disabled.

## Mounted composer behind browser tools

The workspace now remains mounted behind Capabilities, Messaging, and Artifacts.
A browser route adapter keeps the previous workspace location beneath browser
and upstream overlays, while the tool page receives the current route in its own
context. The background workspace is inert while covered. This preserves one
conversation instance, contributed panels, text, attachments, and recording state
without copying the upstream conversation into a second store.

The tool-modal component owns its return path outside the shell, including query
and fragment state. The sidebar and modal share the tool route definitions.
A reviewed compatibility-registry entry replaces only the workspace surface's
route component; existing source/output fingerprints and the renderer pin remain
unchanged.

The previous image reproduced a detached composer on both phone and desktop.
The candidate passed all four 390px/1440px, 100%/150% lifetime journeys through
Capabilities, Messaging, Artifacts, Settings, and Command Center. These assert
actual DOM identity, one composer, an unsent file, inert background content, and
keyboard focus restoration. A fake-device recording journey verified that the
same microphone stream stays live until explicit stop, then produces a transcript
and releases its tracks. This is browser-API evidence, not a physical-device test.

Typechecking, the production build, and 76 adapter/registry/composition checks
passed. Nine route/conversation regressions passed, including complete-URL
history, a cold tool entry, delayed Bot/profile selection, reconnect, fresh chat,
Command Center selection, and contributed panels. Existing settings focus and
full-page return journeys also passed. The first previous-image upgrade run
passed the conflicting-draft refusal but postponed activation in the successful
upgrade journey; its trace contains initial `ERR_NETWORK_CHANGED` asset errors.
Both real-composer upgrade journeys then passed on the unchanged candidate,
including blocked activation during work/attachments, two-tab draft preservation,
and conflicting-draft refusal. PR #51 passed all required checks on refreshed
head `c945f06` and merged as `af70a27`.

PR #50's initial preview failed because the approval-menu test had accidentally
received the new settings-group selector. Restoring its existing upstream label
selector passed the focused approval journey against the settings image. The
correction `9ded4fc` passed all required checks and PR #50 merged as `6d1e0a8`.
The failure did not justify changing approval behavior or weakening its assertion.
PR #51 was retargeted to main and refreshed with that ancestry as `c945f06`; its
required checks passed before merge `af70a27`.


## Shared Bots toolbar actions

The Bots toolbar defines filters and creation actions once for desktop menus and
phone sheets. Single-choice action groups expose radio semantics and phone
keyboard navigation; filters remain open for combined changes and clear through
the existing roster callbacks. Hidden-Bot visibility retains its session-only
upstream store. The new Bot/group/section actions wait for the old surface to
release focus before opening their upstream dialogs. Browser-owned toolbar CSS
provides touch targets while retaining the filter/add ordering.

Validation exposed controlled upstream creation dialogs that did not restore the
opening button on cancellation. Browser focus ownership is added at the Bot/group
creation and section-dialog boundaries through reviewed registry entries. Their
form behavior and commands remain upstream-owned. Viewport checks additionally
reproduced creation dialogs extending offscreen at 150% scale. Owned attributes
now cap normal and advanced dialog sizes in scaled viewport coordinates, retaining
the upstream inner scroll box and popover portal.

Validation: all 78 adapter/registry/composition checks, typechecking, and the build
passed. Eight Bots journeys passed for toolbar ordering, filter state, keyboard
selection, creation-dialog focus, retained drafts/routes, touch taps, and hidden
visibility across navigation/reload. Thirteen existing settings, navigation, and
profile surface journeys passed. All four final matrix cases passed normal and
advanced creation-dialog bounds checks; one passed on retry after startup
`ERR_NETWORK_CHANGED` errors with unchanged assertions. The four remaining
final-image control journeys passed. Required compatibility, policy, and image
checks passed on `0743498`; PR #52 merged as `72bae0f`.

This toolbar slice does not complete all Bots interactions. Bot/group row and
section context menus still need an accessible touch entry point and shared
browser action surfaces. Physical-device validation and stage-6 live rollout
evidence remain outstanding; updater App setup is deferred and automation stays
disabled.


## Shared roster row and section actions

Bot, group, and section rows now expose an explicit action button alongside
right-click and keyboard context-menu access. One action definition drives the
desktop menu and phone sheet. Bot metadata commands remain behind the browser
adapter; upstream metadata stores, profile ownership, section persistence,
selection commands, and form callbacks remain authoritative. A gateway that
explicitly rejects metadata persistence produces a visible browser error while
retaining the upstream local fallback. Existing older-gateway fallback semantics
are preserved.

Owned section headings retain collapse, rename, ordering, and deletion. Bot menus
retain pin, hide, edit, groups, duplicate, section filing, and deletion. Group
menus keep their existing open and disband callbacks. Creation/edit/group and
confirmation dialogs release the action surface first, restore focus on close,
and fit scaled viewports. Five reviewed registry entries cover these boundaries;
the renderer revision and previously reviewed fingerprints are unchanged.

Verification reproduced lost focus when creating a section remounted the Bot row.
Focus restoration now resolves the current row using its source-qualified key,
or returns to the active navigation tab when the row has been removed. The
registry pipeline test now runs browser and renderer prerequisites in actual
Vite order. The strict gateway fixture validates pin, hide, and section fields
and rejects malformed metadata without mutation.

Validation: 94 adapter/registry/fixture checks, typechecking, and the build passed.
All 18 final-image surface journeys passed: four row viewport/scale cases, two
canonical-menu regressions, and twelve settings/profile/Bots toolbar regressions.
Three final-image interruption journeys passed for tap-only Bot/group actions,
unconfirmed metadata saves, and rejected Bot duplication/deletion. Five existing
selection/group-creation/conversation-failure journeys also passed before the
final focus refinement. Required committed-image CI is pending. Physical-device
validation and stage-6 live rollout evidence remain required. App setup remains
deferred and scheduled proposals/stable promotion stay disabled.


PR #53's full preview exposed a desktop navigation context-menu regression in
focus restoration. Its anchor is a non-focusable wrapper, so calling `focus()`
must not prevent trying the explicit button fallback. Restoration now checks
that the browser actually moved focus before returning. Existing navigation
viewport tests retain their focus assertions. All eight navigation/roster
viewport journeys, typechecking, and the production build passed after the fix;
required compatibility, policy, and preview checks passed on `fcb2b84`; PR #53
merged as `fefb723`.


## Release configuration and rollback evidence

The read-only setup audit found that `renderer-update-policy` existed in CI but
was not required by branch protection. After inspecting the additive ruleset,
`configure-repository.mjs --automation --apply` added that strict Actions check
and preserved existing protection. Readback confirms both `compatibility` and
`renderer-update-policy` are required. App ID/login/private key remain missing
by the user's deferral; scheduling and promotion remain disabled.

Release run `35734286692` at wrapper `af70a27` passed compatibility and native
amd64/arm64 candidate browser jobs. The registry's combined manifest was read
back and verified to contain each tested platform manifest. The immutable
candidate and baseline identities are recorded in
[the release evidence](release-evidence/2026-09-22-candidate-rollback.json).
A new real-image round trip passed locally: previous image to candidate, then
back to the previous tested image with two live tabs. Active responses and unsent
attachments postponed rollback; candidate-edited drafts and selected sessions
survived activation and reload. The gateway was synthetic-preview-v1.

Publication now retains a machine-readable combined-digest record, including
whether stable promotion completed. CLI tests exercise disabled promotion,
verified stable tags, partial tag-verification failure, stale main, and missing
architecture evidence. These changes improve the release evidence but do not
complete live renderer proposal/merge demonstrations, real-gateway smoke, or
physical-device verification. All three real-image upgrade/rollback journeys
passed against the published amd64 digest, and 14 release-policy/updater/evidence
checks passed. Required compatibility, policy, and preview CI passed on
`e477ecc`; PR #54 merged as `a811d26`. No running deployment was changed.

## One-off updater validation

The release audit exposed an activation ordering problem: manual updater dispatch
was gated by the same variable as recurring proposals, yet live validation was
required before enabling that variable. Manual dispatch from `main` now uses the
real configured App without changing scheduling or promotion. An optional exact
upstream revision makes compatible/incompatible runs reproducible; automatic
triggers continue to resolve upstream `main` only after enablement.

The CLI rejects unsupported events, non-main workflow refs, malformed revisions,
and automatic-trigger revision overrides before external operations. A manual
exact revision will not act on an unrelated passing/pending proposal. Existing
failed-proposal replacement, head-guarded refresh, source metadata checks,
renderer-only lock policy, and protected auto-merge remain in force. App setup
is still deferred; this prepares the validation path but is not evidence of a
live App run. The runbook records the dispatch, refresh, and retry steps and the
remaining evidence required before activation.

All 20 updater, release-policy, and release-evidence checks passed locally. The
workflow parsed successfully; required CI and live App validation are pending.

## Browser fixture network readiness

The release audit found that run `35736691937` at wrapper `72bae0f` passed the
required compatibility job and native amd64 candidate, but its arm64 candidate
failed two of 109 browser journeys. The traces show `ERR_NETWORK_CHANGED` before
the affected assertions: an authentication-ticket request failed during unread
fixture startup, and the previous image's `index.html` precache request failed
before the conflicting-draft upgrade test. Promotion was skipped. This is failed
release evidence, not a passing native candidate.

Launching Chromium after Docker reports nginx ready did not fully settle delayed
interface notifications. Interruption and upgrade fixtures now require two
seconds of uninterrupted browser requests to uncached build metadata, within a
15-second limit, before creating the clean application context. A disposable
context blocks service workers. Only `ERR_NETWORK_CHANGED` restarts the readiness
window; HTTP/identity errors, unrelated network failures, and continuing churn
fail setup. Probe counts and network changes are attached to the test report.
Application navigation and behavioral assertions are unchanged. Native arm64
verification remains required after this fixture change.

Local verification: three readiness checks and four Chromium image journeys
passed, including both affected scenarios, delayed Bot selection, and two-tab
rollback. These development-image results do not replace native arm64 evidence.

## Preserve update-handshake evidence across reloads

PR #56 passed required compatibility, policy, and preview checks at `2cbc26c`
and merged as `dc92321`. PR #57 passed those checks at `488b2c4` and merged as
`1e88875`. Native release verification containing the readiness fix is pending.

Release runs `35743272526` and `35745406364` stalled at the final rollback
activation after active work and attachments were resolved. Run `35747697284`
instead postponed the initial upgrade in the round-trip journey. Their browser
checks failed and promotion was skipped. These are unresolved observations:
three local round trips against a release-style Docker build passed, but do not
establish the cause of the CI failures.

The real-image upgrade fixture now attaches a bounded `update-protocol` report
with tab identifiers, notices, worker states, lock state, requests, and readiness
acknowledgments. The report lives outside page documents and survives activation
and reload. It omits composer text, credentials, and URLs. Existing safety
assertions and application behavior are unchanged.

All three upgrade journeys passed locally with diagnostics and network readiness
against `hermes-web:rollback-verification` (wrapper `dc92321`, pinned renderer,
synthetic gateway). Report inspection confirmed both tabs, conflict abort, and
both round-trip verifications, with no dropped events or draft/URL fields.
Committed-image CI and diagnosis of any recurring activation stall remain open.

## Touch access to sidebar visibility and explicit styling hooks

Pinned-section visibility now uses one browser command model shared by the
Navigation tabs menu/phone sheet and the Sessions pane context menu. Touch users
can hide and restore the section through the explicit toolbar control. The
existing storage key and actual session pins are preserved. Closing the surface
returns focus to its opening control, or to the toolbar when the hidden heading
is no longer focusable. Nested session-row menus keep their own commands.

Session search and the recents/search-results sections now carry explicit browser
styling classes. The browser stylesheet no longer identifies these elements by
placeholder text or upstream flex/min-height utility classes. The existing
sidebar-composition registry entry keeps its reviewed source/input fingerprints;
only the reviewed output fingerprint changes. Fetched renderer sources and the
renderer revision are unchanged.

The first browser run exposed upstream interception of the new pane context
menu. Restoring the coordinator marker preserves the browser surface's right-click
ownership; the regression test retains desktop right-click and nested Unpin checks.
Physical-device validation and live updater/gateway rollout evidence remain
outstanding. App setup is deferred; scheduling and stable promotion stay disabled.

Validation: 83 adapter/registry/composition checks, typechecking, and the production
build passed. All eight final-image Chromium journeys passed at 390/1440px:
pinned visibility and nested row actions, search/disclosure alignment at
100/125/150%, and navigation selection/draft/focus at 100/150%. Required
committed-image CI remains pending.

The final navigation styling audit adds two reviewed registry entries for the
Sessions/messaging and Cron section headers. They expose browser-owned header
and label attributes; upstream disclosure callbacks and content remain intact.
The browser stylesheet now uses those attributes instead of upstream group
utility classes. A redundant icon-based rule targeted the empty-state project
button, whose own upstream class already supplies the same color; it is removed.
The registry now contains 83 interventions with explicit verification paths.

The read-only setup audit reconfirmed both strict required checks, merge commits,
and repository auto-merge capability. App ID, login, and key are absent as
expected; scheduling and promotion are disabled. No setup settings changed.

The populated-Cron viewport journey exposed a pre-existing phone drawer overflow
at 150% UI scale: its viewport width was scaled twice and could hide the action
control beyond the screen edge. The drawer now compensates its width for the UI
scale. Navigation tests check drawer and trigger bounds before clicking, so
Playwright's automatic scroll-into-view cannot conceal the clipping. This is a
browser-emulation result; physical-device acceptance remains outstanding.

Final refinement validation: 85 adapter/registry/composition checks, typechecking,
and the production build passed. All ten final-image Chromium journeys passed:
the prior eight navigation journeys plus Sessions/Cron disclosure, focus, bounds,
and draft retention at 390/1440px and 100/150% scale. Captured 150% screenshots
confirm the phone drawer and action controls remain within the viewport. Fresh
committed-image CI is required after this refinement.

## Preserve concurrent drafts during update flushes

PR #58 merged as `04f887c`. Its release run `35752108986` passed 118 browser
journeys but failed the final rollback activation; candidate publication and
promotion were skipped. The new protocol evidence showed both tabs accepting
the flush, followed by the second tab rejecting verification. A local real-image
repeat reproduced that outcome. The second tab had saved two drafts, then the
first tab rewrote its stale one-draft cache, removing the second draft from
storage. The verification guard correctly refused activation.

The reviewed composer integration now saves only the changed conversation keys
during an update flush, using an exclusive browser lock shared by the tabs. The
existing storage key, JSON shape, draft limit, and upstream in-memory stash remain
in use. Ordinary saves and page-unload saves remain synchronous. Pending update
saves cannot overwrite newer ordinary edits, and storage events retain pending
drafts and attachment-only stashes. No fetched renderer source or pin changes.

The update handshake waits for queued saves, refreshes the shared stash, and
checks activity and persistence again. Verification still rejects changed or
missing prepared drafts; an independently persisted draft arriving from another
tab or a change in key ordering is allowed. Abort and timeout checks prevent late
asynchronous completions from relocking or reloading the page. Missing lock
support or failed storage leaves the live composer usable and refuses unsafe
activation. The lock covers the synchronous read/modify/write callback, following
the [Web Locks specification](https://www.w3.org/TR/web-locks/).

The deterministic regression runs the actual transformed composer in two stale
tabs: main loses the first tab's draft; the new integration retains both. Tests
also cover pending writes, cancellation by a newer edit, failed storage and retry,
unchanged ordinary saves, and attachment preservation. Three complete repetitions
of the existing real-image upgrade/conflict/rollback journeys passed with the
core fix. A further journey checks conflicting drafts in the candidate itself
and retries rollback after the conflicting tab closes. Final local validation
passed all four real-image journeys and the existing busy-tab/attachment safety
fixture, plus 177 foundation checks, typechecking, and the production build.
Exact committed-image CI and native release validation remain required. Earlier
indefinite-checking observations are not all explained by this diagnosed write race.

App setup remains deferred. Live updater demonstrations, real-gateway smoke tests,
physical-device acceptance, and automation activation remain outstanding.

### Stable conversation selection for mobile navigation

The mobile drawer could close immediately after opening because the browser
model included background Bot metadata in its selection key. A traced local
reproduction showed `web-single::default` becoming `default` while the selected
session and route stayed unchanged. The navigation effect treated that metadata
refresh as a conversation switch.

The key now follows the visible session or group. It remains stable while titles,
Bot identity, or unrelated roster state hydrate, and changes when the actual
conversation changes. Upstream stores remain authoritative. A regression against
the actual adapter failed on the earlier implementation and passes with this
change, including background session changes while a group remains selected.

Validation passed: 180 foundation checks, typechecking, the production build,
six repeated affected mobile flows with 2x CPU slowdown and no retries, eleven
existing navigation/profile interaction cases, and a new phone journey switching
sessions and Bots while preserving both session drafts. Temporary diagnostic
logging and CPU throttling were removed. Committed-image CI remains required;
physical-device acceptance and the separate update activation investigation are
still outstanding.
