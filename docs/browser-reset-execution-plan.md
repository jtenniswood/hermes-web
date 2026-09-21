# Browser architecture reset: execution plan

Status: execution in progress; PR 1 browser verification work is underway.

Baseline: wrapper commit `2ccc9c5`, following merged PR #27. Recheck the branch,
renderer pin, and relevant contracts before starting each delivery. This plan
implements the expert-reset review through independently reviewable PRs.

## Outcome and scope

Hermes Web owns browser navigation, menus, controls, and presentation. A narrow
adapter connects those components to the existing Hermes chat engine and stores.
Browser workflow tests exercise the application image that will be released.
Startup failures leave a useful recovery screen.

Preserve the chat engine, composer, streaming, tool rendering, contributed panels,
authentication, and safe-update machinery. Deliver ordinary UI components for
browser-specific controls instead of constructing their JSX through source-string
replacement. Some guarded compatibility transforms will remain necessary.

This document authorizes no production deployment, repository-settings change,
renderer update, or automatic merge. It describes the work and its delivery gates.
Follow the user's execution authorization when those steps are subsequently run.

## Product contract to preserve

- Sessions and Bots remain the primary navigation tabs, with existing visibility,
  sizing, profile selection, and saved ordering preferences respected.
- The browser remains a single-conversation experience. Internal upstream pane
  lifecycles may remain, but desktop chat tabs and duplicate title bars stay absent.
- The chat toolbar has no visible conversation title. Bot/group identity remains
  accurate wherever the product actually displays or uses it.
- Bots filters contain Show and Filter by time submenus. Show hidden bots stays
  at the bottom. Revealing hidden bots does not change their saved hidden state;
  an explicit unhide action, if present, is a separate operation.
- The redundant Open Bot Chat action and new-session shortcut hint stay removed.
  Removing a hint must not silently remove the underlying shortcut behaviour.
- Settings retains Notifications, Panels, Systems, and Workspace in that order,
  compact group labels/separators, and distinct Files/Review icons.
- Manual, Smart, and Off retain distinct approval icons; the toolbar reflects
  the selected mode. Smart uses the concise description and the approval heading
  has no divider immediately beneath it. Backend permission semantics stay intact.
- Panels, menus, and settings preserve the active chat, drafts, attachments,
  recording lifetime, and focus behaviour.
- One operator-configured gateway remains the connection target. Browser loading,
  gateway reachability, authentication, and conversation readiness are distinct.
- Preserve stored themes, scale, browser preferences, credentials, and drafts.
  No storage reset is an acceptable migration or recovery mechanism.

The earlier `mobile-experience-plan.md` includes confirmed direction for touch
menus as sheets and disabled mobile profile reordering, alongside older proposed
header designs. Keep the shared action model compatible with that direction.
Do not implement a broad phone redesign or restore titles as part of this reset.
Resolve conflicting documentation against current implementation and the latest
user decisions; do not treat a historical plan as proof of delivered behaviour.

## Architecture and dependency rules

Use folders within the current application initially, not a new package tree.
Names below describe proposed modules, not existing APIs.

| Area | Proposed home | Responsibility |
| --- | --- | --- |
| Composition | `src/experience/browser-shell.tsx` | Assemble navigation, toolbar, workspace, and recovery/update surfaces |
| Browser features | `src/experience/navigation/`, `settings/`, `bots/`, `approval/` | Render product-owned controls and coordinate their local interaction state |
| UI patterns | `src/experience/ui/` | Shared menu rows, grouping, icon sizes, toolbar controls, and surface variants |
| Browser contracts | `src/experience/contracts/` | Plain domain types and action interfaces without upstream imports |
| Hermes adapters | `src/upstream/` | Read upstream state, translate identities, call actions, expose stable UI primitives |
| Browser services | `src/platform/`, `src/pwa/` | Transport, authentication, persistence, files, media, and update safety |
| Compatibility | `src/upstream/overrides.ts`, remaining transform modules | Resolve upstream modules to checked wrappers and preserve required integration hooks |
| Hosting and evidence | `scripts/`, `.github/workflows/`, `tests/browser/` | Runtime configuration, deterministic fixtures, image tests, preview, and release evidence |

Dependency direction: feature components consume browser contracts and adapter
entry points; adapters may import upstream code. Contracts cannot import upstream
stores. Presentation must not subscribe to new raw upstream atoms through a large
re-export barrel. Existing exceptions are migrated incrementally.

Do not create a second mutable conversation store. The initial browser model is
a read-only projection of authoritative upstream state. Introduce browser-owned
selection commands only after mapping the upstream asynchronous lifecycle.

Do not edit `apps/desktop/` or `apps/shared/`. A replacement module lives under
the wrapper and is resolved by the existing override mechanism. Prevent overrides
from resolving their own imports recursively. Verify relative and aliased callers.

## Sequence and PR boundaries

| PR | Delivery | Depends on | Effort | Exit gate |
| --- | --- | --- | --- | --- |
| 1 | Required browser workflow verification | None | Medium | Current product journeys run against the built image; missing setup fails clearly |
| 2 | Reusable menu patterns and settings/navigation menu migration | 1 | Medium | Shared visuals and keyboard/focus behaviour; accepted desktop/phone screenshots |
| 3 | Browser-owned Bots toolbar | 1, 2 | Medium | Filter/add/search parity and removal of the toolbar JSX rewrite |
| 4 | Browser-owned approval control | 1, 2 | Medium | Profile-scoped backend state and selected icon remain synchronized |
| 5 | Explicit conversation identity and selection boundary | 1; coordinate with 3/4 | Large | Out-of-order selection and draft-isolation scenarios pass |
| 6 | Shell decomposition and preference ownership | 2–5 | Medium–Large | Smaller composition root with unchanged pane and storage lifecycles |
| 7 | Independent startup recovery | 1; can proceed alongside 2–6 | Medium | Failure injection leaves useful recovery and preserves state |
| 8 | Architecture enforcement and preview/release alignment | 1–7 | Medium | Remaining patches documented; evidence tied to candidate identity |

Merge deliveries sequentially on fresh `codex/` branches based on current main.
Use history-preserving updates; do not force-push. Keep the renderer pin unchanged
during component migrations. If upstream has advanced, isolate that upgrade from
the feature PRs so failures have an attributable cause.

Parallel work is practical for recovery and read-only fixture inventories after
PR 1. Avoid concurrent edits to `browser-shell.tsx`, `browser-plugin.ts`, and shared
menu exports until their extraction boundaries are established.

## PR 1 — Restore meaningful browser verification

### Starting evidence

`tests/browser/browser.spec.mjs` skips without `HERMES_BROWSER_PREVIEW_IMAGE` or
`HERMES_BROWSER_PREVIEW_URL`. Ordinary compatibility and release workflows supply
`HERMES_TEST_IMAGE`. The preview workflow targets historical branch names. Browser
assertions still select Group chats only without entering Show, and expect the
removed Open Bot Chat item. The safety suite exercises real recovery plus focused
fixtures; it does not substitute for the interaction suite.

### Work

1. Enumerate the interaction tests, their scenarios, skips, and fixture needs.
   Reproduce the configured skip condition before changing it. Record baseline
   failures against the current image and distinguish stale expectations from
   actual application failures.
2. Introduce one shared test-image resolver. Use `HERMES_TEST_IMAGE` as the CI
   contract, accepting the preview image name as a temporary local alias. Conflicting
   values fail with an explanation. Keep an explicit URL mode for synthetic local
   review, but do not accept that mode as production-image CI evidence.
3. Make missing image configuration an actionable failure for required runs.
   Define required scenarios and fail if any is unexpectedly skipped. Preserve
   narrowly justified platform skips with explicit alternative coverage.
4. Fix stale test expectations to the product contract above. Exercise the new
   submenu, require the obsolete action to be absent, and verify that ordinary bot
   selection still opens the conversation. Do not weaken assertions to pass CI.
5. Extend `scripts/preview/gateway.mjs` only for the scenarios actually tested:
   group identity, activity filters, approval modes, delayed bot/profile selection,
   authentication failures, and reconnects. Each test gets a known initial state.
   Freeze or control activity time where filter boundaries depend on it.
6. Replace generic fixture success responses on tested operations with explicit
   responses that match the pinned contract. Record unknown RPCs and reject
   unexpected ones in strict test mode; explicitly allow known optional probes.
7. Add a shared browser error collector. Fail on unexpected page errors and
   startup/module-loading errors; label intentional failure-injection exceptions.
8. Add a separate strict cold-start check that never reloads to conceal a first-load
   failure. Keep bounded-retry tests separate from normal startup tests.
9. Activate the suite in both `typecheck-build.yml` and the release candidate jobs.
   Collect a machine-readable report alongside screenshots/traces. Retain the
   existing safety suite and routing tests.
10. Establish Chromium coverage for the complete suite and WebKit coverage for
    startup, menu placement/keyboard access, switching, panels, and drafts. Start
    the WebKit gate on a compatible CI runner; record unsupported architecture
    combinations without presenting Chromium emulation as Safari validation.

### Files and verification

Primary files: `tests/browser/browser.spec.mjs`, `safety.spec.mjs`, proposed shared
test fixtures/helpers, `scripts/preview/gateway.mjs`, `playwright.config.mjs`,
`.github/workflows/typecheck-build.yml`, and `.github/workflows/release.yml`.

Acceptance: the report identifies wrapper/renderer revisions, image identity,
browser, and passed/failed/skipped scenarios; required scenarios execute; current
product expectations pass. A deliberate module-load failure fails the startup
check, and omitted image configuration fails before reporting success.

If a genuine application regression blocks the baseline, make its smallest fix
in a separately reviewable commit or prerequisite PR. Keep the test gate intact.
No product-architecture migration starts until this baseline is trustworthy.

## PR 2 — One menu system

### Work

1. Inventory current dropdowns, right-click menus, toggles, submenus, and toolbar
   triggers. Record present fonts, row spacing, glyph sizes, colours, grouping,
   viewport limits, focus return, and disabled/checked states.
2. Add a narrow UI export boundary for the existing menu primitives. Reuse
   ActionsMenu/ActionsContextMenu and their common action-kit approach. Expose
   checkbox/radio variants where needed; do not mix dropdown-only items into a
   context-menu tree.
3. Define a small typed action model for shared action identity, icon, label,
   availability, selection, and optional children. Use direct React composition
   when an action model adds no reuse. Define icon/spacing conventions once, with
   explicit toolbar and menu variants.
4. Extract SettingsMenu from the shell. Preserve the current order, labels,
   separators, callbacks, checked panel state, and gateway-dialog focus return.
5. Replace handwritten profile and navigation-tab context menus with the common
   primitives. Preserve positioning and persistence without duplicating pointer
   coordinates, outside-click listeners, and Escape handlers.
6. Preserve tap-accessible entry points. Keep action definitions usable by a future
   touch-sheet renderer; do not force a desktop flyout interaction onto touch-only
   controls or expand this PR into the full mobile redesign.
7. Remove CSS only when its consumer has migrated. Do not recolour all menus
   globally to make one screenshot match.

Primary files: `browser-shell.tsx`, `browser.css`, new `experience/ui/` and
`experience/settings/` modules, `upstream/browser-api.tsx`, a narrow proposed UI
adapter, `browser-panel-button.tsx`, and `browser-activity-toasts-item.tsx`.

Acceptance: settings and context-menu rows share the intended visual treatment;
keyboard navigation, Escape, checked states, edge collisions, focus return, and
touch entry points work. Check 390px and 1440px layouts at 100%, 125%, and 150% app
scale, using deterministic screenshot fixtures. Preserve glyph size separately
from the touch target size. Review long labels and a no-panels configuration.

First experiment: migrate SettingsMenu and one profile menu before generalizing
every menu. Revert just those component replacements if interaction parity fails.

## PR 3 — Replace the Bots toolbar rewrite

### Work

1. Inventory every `renderRosterToolbar` input and action in the pinned renderer:
   search, visibility, kind/activity/gateway filters, active-count calculation,
   clear filters, bot/group creation, and section creation.
2. Define presentation props for BrowserBotsToolbar and BrowserBotsFilterMenu.
   Keep roster calculation and action ownership upstream. The adapter converts
   original toolbar props and hidden-bot state into the browser contract.
3. Resolve the upstream toolbar module to a wrapper-owned export through
   `upstream/overrides.ts`. Preserve its callable export/signature, even if the
   exported props interface is unavailable. A regular React child component must
   own any hooks; do not add hooks to an ordinary render helper.
4. Implement the toolbar directly in TSX. Preserve Show, Filter by time, gateway
   options when applicable, clear filters, search, add actions, and hidden-bot
   visibility. Confirm precisely which filters contribute to the active badge.
5. Remove `layoutBrowserRosterToolbar` and its dedicated rewrite assertions only
   once callers resolve to the replacement. Split any shared transform dispatcher
   carefully: notification behaviour and roster derivation still have consumers.
6. Retain the separate hidden-roster derivation compatibility change until there
   is a safe data-level replacement. This PR need not eliminate every Bots patch.

Primary files: proposed `experience/bots/` controls, an upstream toolbar adapter,
`upstream/overrides.ts`, `browser-plugin.ts`, and the browser integration tests.

Acceptance: normal startup and production bundling succeed; every toolbar action
works with real callbacks; hidden bots can be shown without modifying hidden
metadata; fresh and saved filters work; submenus fit the viewport and support
keyboard/touch entry. No string-generated JSX remains for this toolbar.

Risk control: verify both relative and aliased imports and the replacement module's
exports. Do not import the overridden module at runtime from its own replacement.
Keep the old component and replacement selectable only during development of the
PR; ship one implementation. Roll back by reverting the PR's override and component.

## PR 4 — Replace approval presentation transforms

### Work

1. Map the existing profile-scoped approval store, synchronization request, setter,
   and statusbar item contract. Preserve the backend's Manual/Smart/Off semantics.
2. Create one ApprovalMode presentation definition for label, description, icon,
   and selected state. Both the menu and toolbar consume it.
3. Replace the upstream approval presentation module through a checked local
   adapter, or adapt its presentation through an explicit extension point if one
   is available. Continue using the upstream store and request functions.
4. Remove `addBrowserApprovalModeIcons` after the replacement is exercised.
   Avoid a second synchronization effect or a second permission-setting request.
5. Handle rejected changes visibly; the displayed icon must reflect the accepted
   state after failure. Capture profile identity when initiating a request so a
   response cannot be attributed to a different selected profile.

Primary files: proposed `experience/approval/` components and upstream approval
adapter, `browser-statusbar.tsx`, `overrides.ts`, and `browser-plugin.ts`.

Acceptance: mode selection sends the correct profile/value; toolbar and menu
agree after success, failure, reload, and profile switching; keyboard radio-menu
behaviour works. No approval presentation JSX is injected into source strings.

First experiment: replace only the existing statusbar item's presentation while
preserving its location and lifetime. Delay removal of the portal mechanism until
the shell migration if it would broaden this PR.

## PR 5 — Explicit conversation identity and selection

### Work

1. Trace session, bot, group, profile, URL, focus, and canonical-session ownership
   through upstream routing. Document when each becomes authoritative during
   startup and switching. Do not derive identity from the display title Bot Chat.
2. Define a browser-facing model with a discriminated conversation kind, stable
   identifiers, profile identity, display name, and explicit loading/unknown state.
   Include connection identity where upstream requires it. Distinguish loading
   from genuinely empty/new conversations.
3. Implement a read-only adapter projection using the current stores. Replace
   shell-side title/name heuristics without adding a writable mirror store.
4. Define commands for selecting a session, bot, group, or profile. Reuse upstream
   sequencing/cancellation if available. Where missing, add a narrowly scoped
   request-generation guard at the owner of the state commit. A guard only in a
   wrapper cannot prevent stale upstream writes; prove the commit path first.
5. Route browser selection entry points through these commands. Reconcile URL,
   profile, and conversation identity as one documented transition. Remove the
   shell's corrective profile effect only once the race it handles is covered.
6. Return action failures to a visible error surface; replace silent catches in
   migrated selection actions without changing unrelated action semantics.

Primary files: new `experience/contracts/conversation.ts`, upstream conversation
adapter/selectors, `browser-shell.tsx`, `browser-api.tsx`, `browser-bootstrap.ts`,
and delayed-response scenarios in the synthetic gateway.

Acceptance scenarios: session → bot → session; bot A → bot B before A completes;
profile selection during delayed bot activation; group → ordinary session; renamed
bot/session; reload/deep link; unavailable identity; gateway reconnect. The active
identity and actions refer to the chosen target, and drafts never cross sessions
or profiles. Previously selected identity must not leak into an unresolved target.

Risk control: keep upstream stores and storage keys authoritative. Start with the
read-only model as its own commit; command ownership is a separate commit or PR
if mapping reveals substantial lifecycle changes. Do not rewrite the gateway protocol.

## PR 6 — Decompose the shell and consolidate preferences

### Work

1. Extract NavigationShell, NavigationTabs, ProfileRail, ChatToolbar, SettingsMenu,
   UpdateNotice, and WorkspaceHost as needed by actual responsibility. Extract
   resize/focus/interaction hooks with them; avoid arbitrary file-size targets.
2. Move browser preference read/validate/write logic into a small preference service.
   Keep existing keys and defaults first. Audit absent, malformed, and unavailable
   storage; distinguish a missing numeric preference from an intentional value.
3. Document whether each preference is per deployment, per browser, or per tab.
   Preserve those scopes. Centralization does not require a storage-schema change.
4. Keep one ContribWiring instance and the controller initialization side effect
   until explicit replacement is proven. Preserve plugin/pane registrations,
   preview lifetimes, draft flushing, and route overlays.
5. Make browser layout choose which owned surfaces render. Remove matching CSS
   selectors that hide those replaced surfaces. Retain documented CSS integration
   rules for upstream-owned bodies until their contracts can be improved.
6. Remove obsolete menu CSS and raw-store exports only after checking consumers.
   Reduce the browser-api barrel toward focused adapter entry points.

Acceptance: sidebar resize/visibility, profile reorder/hide, pinned sections,
Files/Review open/close, settings/command-center overlays, and browser Back behave
as before. One editor/overlay owner remains. Existing state and legacy layouts
load correctly, including a layout containing old session tiles.

Risk control: do not replace the workspace tree in this phase. Extraction must
not alter React identity or remount the composer. Test drafts and pending
attachments while opening panels and navigating, not only after fresh startup.

## PR 7 — Renderer-independent startup recovery

### Work

1. Define startup stages: document/entry load, runtime configuration, bridge
   installation, upstream module loading/initialization, and application-ready.
   Track gateway authentication and connectivity separately after UI startup.
2. Build a minimal recovery surface without upstream imports or heavy UI
   dependencies. Place a static loading/fallback shell in `index.html` if required
   to cover failure of the entry module itself, before its try/catch can execute.
3. Identify readiness through an explicit application signal, not merely a
   completed dynamic import. Cover exceptions before/during renderer mounting.
4. Display clear stage-specific guidance with Retry and optional Copy diagnostics.
   Expose wrapper/renderer identity when available. Use a whitelist of diagnostic
   fields; exclude tokens, cookies, query credentials, conversation text, and
   private deployment addresses. Keep raw technical details out of the main message.
5. Preserve bounded startup retry. Repeated failure or blocked storage must show
   recovery without a loop. Automatic retries end before user work can begin.
6. Keep existing post-start gateway sign-in/reconnect handling and the safe-update
   coordinator. Recovery must not introduce a second authentication flow or an
   unconditional reload during active work. Runtime configuration is still uncached.

Primary files: `index.html`, `src/entry.ts`, `platform/startup-recovery.ts`, proposed
recovery UI, `build-info.ts`, and relevant browser/safety tests.

Acceptance: block the entry/module fetch, inject an initialization failure,
invalidate runtime config, return 401/502 from the gateway, and deny storage.
Each failure has the appropriate recoverable state without erasing drafts or
credentials. A second failure does not loop; a successful retry restores the
original route. Existing busy-tab and safe-update tests remain intact.

## PR 8 — Enforce boundaries and align previews/releases

### Work

1. Inventory every remaining transform with target module, reason, source/output
   guards, owner, behavioural coverage, and removal condition. Separate browser
   presentation patches from necessary startup, routing, storage, and dependency
   compatibility hooks. Do not delete a patch just to reduce the count.
2. Extend adapter-boundary enforcement to prevent new raw upstream imports or
   raw-store re-exports into migrated product modules. Keep explicit, scoped
   exceptions for unmigrated paths; prevent exceptions from growing unnoticed.
3. While transforms remain, add a validation path for their composed output.
   Prefer a TypeScript compiler host that overlays the same transformed source
   pipeline used by Vite, or an isolated temporary generated graph. Account for
   module overrides and virtual exports. Validate an intentionally invalid import
   and undefined binding in the checks themselves. Do not write generated files
   into fetched upstream directories or create a second transform implementation.
4. Update candidate evidence to record required suite outcomes, browser coverage,
   wrapper/renderer revisions, and exact image digest. Promotion rejects missing,
   mismatched, or skipped required evidence. Keep the existing two-architecture
   digest promotion model and test its negative cases.
5. Update preview workflow branch targeting for current main-based PRs. Run
   read-only verification for untrusted contributions; publish preview images
   only within the trusted repository policy. Keep publishing credentials out of
   untrusted PR execution and retain scoped package permissions.
6. Use the production frontend build and entry point for previews, changing runtime
   gateway configuration to the synthetic backend. Record the image identity served
   by the preview; verify the actual app, not just HTTP 200. Provide one documented
   preview command and explicit start/status/stop instructions for its containers.
7. Reconcile README, browser-preview.md, releases.md, and agent build guidance.
   Remove obsolete branch names and claims about selectors, Tools tabs, titlebars,
   floating upstream main, and completed test coverage where contradicted by code.
   Preserve historical repair evidence as historical rather than live status.

Acceptance: a PR reviewer can identify and open the tested preview, inspect its
matching test evidence, and reproduce it locally. Required behaviour cannot be
silently omitted from release evidence. A deliberately incompatible upstream
change fails the adapter gate. A previous known-good image remains deployable.

## Validation matrix

| Layer | Required evidence | Timing |
| --- | --- | --- |
| Renderer integrity | Exact pin and untouched fetched sources | Each implementation PR |
| Static checks | Typecheck, boundary checks, whitespace checks; composed transform validation when delivered | Each relevant PR |
| Unit/contract checks | Identity projections, race handling, storage defaults/migration, adapter mapping | Changes affecting those contracts |
| Application smoke | Strict cold start, transcript/editor, Bots registrations, no unexpected runtime errors | Each implementation PR, built image |
| Interaction | Filters, menus, approval, selection, panels, draft preservation | Affected journeys plus required core suite |
| Visual/accessibility | Representative menu screenshots, keyboard/focus/checked state, long labels, clipping | UI migrations |
| Safety | Credential isolation, reload blocking, multi-tab updates, recording/uploads | State/startup changes and final release |
| Browser coverage | Full Chromium suite and focused WebKit suite | Normal PR/release gates after PR 1 |
| Real devices | iPhone Safari/installed mode and Android keyboard, resume, files/media, touch controls | Before claiming phone rollout complete |
| Real gateway | Auth, actual session/bot/group switching, send/cancel, reconnect, mode setting, draft continuity | Before production rollout |

Use the existing synthetic gateway for deterministic UI tests, adding only the
contract shapes needed. Synthetic results do not prove every real gateway version.
Record the backend version separately. Real-gateway checks use designated test
conversations and restore changed test settings; do not delete user conversations.

Routine commands remain:

```sh
node scripts/renderer.mjs --check
corepack pnpm run typecheck
corepack pnpm test:foundation
git diff --check
```

After PR 1, run the production-image browser harness with `HERMES_TEST_IMAGE`
pointing to the candidate built by CI. Browser installation and Docker/Nix build
steps belong in the appropriate CI jobs. Do not build Nix on the VPS. A local
research or documentation-only change does not require these expensive checks.

Test product behaviour rather than source-string appearance. Keep structural
assertions only where they enforce a real compatibility boundary. Do not add a
unit test for each reversible style adjustment. Once required checks pass, repeat
them only after relevant changes or when resolving a specific uncertainty.

## Release, rollback, and evidence

- Each PR records its baseline, changed ownership boundary, removed transforms,
  preserved keys/contracts, commands actually run, browser results, and remaining
  manual checks. Use screenshots of the actual candidate, not design mockups.
- A migration PR changes one surface or ownership boundary. Do not combine a
  renderer upgrade, backend protocol change, and presentation migration.
- Review the isolated preview before promoting changed navigation or menus.
  Keep demo runtime configuration local; never commit private deployment addresses.
- Publishing an image and deploying it are separate steps. Production rollout
  uses the authorized deployment workflow after candidate and real-gateway checks.
- Revert a faulty PR through a new commit, or redeploy the previous verified image
  digest. Do not force-push, clear browser storage, or regenerate compatibility
  fingerprints blindly to make a rollback/build pass.
- This plan avoids storage migration. If implementation makes one unavoidable,
  isolate it, retain old keys, version new records, test forward/backward behaviour,
  and demonstrate rollback before shipping it.
- Real-device or authenticated checks requiring unavailable access remain named
  rollout dependencies. Complete independent code/CI work and report the precise
  missing evidence; do not silently waive the check or infer failure from an
  unauthenticated request.

## Completion criteria

- Required browser journeys execute in ordinary PR and release jobs, with no
  unexplained skips or stale UI expectations.
- Bots toolbar and approval presentation compile as wrapper-owned components.
- Shared menu components cover settings and the migrated context menus.
- The shell consumes an explicit conversation identity rather than title heuristics;
  delayed selections cannot overwrite a newer user selection.
- Navigation, preferences, and panels have clear owners, while chat/composer and
  contribution lifecycles continue to work through the upstream adapter.
- Startup failures yield a usable independent recovery surface.
- Remaining compatibility transforms have a documented purpose and validation.
- Existing drafts, credentials, saved preferences, and safe updates survive the
  migration; rollback has been demonstrated with the previous artifact.
- Documentation, tested preview identity, and release evidence describe the same
  delivered product.

## First implementation task

Start PR 1 from current main: reproduce the browser-suite skip, unify image input,
correct the two known stale menu expectations, and run the interaction suite against
the built candidate. Record genuine baseline defects and fix them before replacing
any product component. That establishes the evidence needed to migrate confidently.
