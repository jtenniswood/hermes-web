# Browser startup regression: diagnosis and repair plan

Status: implementation and deployment applied. The browser-only startup,
overlay, connection, settings, fixture, and behavior repair is built into the
Tailscale-facing 4174 container and verified through the rebuilt nginx image.
Authenticated gateway behavior still requires a signed-in user session.

## Confirmed cause

Removing the desktop layout also removed the `DesktopController` re-export from
`apps/web-desktop/src/upstream/browser-api.tsx` and its import/use in
`browser-root.tsx`. Previously, that import evaluated upstream
`app/contrib/controller.tsx` even when the browser layout was selected.

The upstream module combines a desktop layout component with essential shared
initialization at module scope. Removing the import therefore also removed:

- Registration of the workspace, sessions, Files and Review panes.
- Default layout-tree initialization and contributed-pane adoption.
- Bundled plugin discovery, including Bots, its roster and saved avatar metadata.
- Session, route and preview pane watchers.
- Workspace title/status synchronization, panel visibility bindings and open/close handlers.
- Layout presets, command contributions, pin synchronization and unread guards.

`ContribWiring` still boots the gateway and fetches sessions. However,
`BrowserWorkspace` requires both a layout tree and registered pane renderers.
The Bots tab requires the `hermes-bots:pane` contribution. Importing bot stores
and avatar components directly does not register the plugin or hydrate its metadata.

## Runtime evidence

An isolated Vite instance used the repository's synthetic preview gateway and a
fresh Playwright browser. The production gateway and user data were not used.
In the same browser session, importing the removed controller module produced:

| Observation | Current startup | After diagnostic import |
| --- | --- | --- |
| Gateway | Open | Open |
| Session records loaded | 2 | 2 |
| Failed API requests | 0 | 0 |
| Registered panes | 0 | 6, including workspace and Bots |
| Layout tree | null | Initialized |
| Visible chat editors | 0 | 1 |
| Expected chat transcript | Missing | Visible |
| Bots list | Unregistered | Hermes, Research and Writer visible |

This proves a rendering/bootstrap regression independent of authentication.
Earlier unauthenticated curl and clean-browser requests returning `401` did not
establish the state of the user's signed-in browser.

After the diagnostic import, Settings mounted two `data-overlay-surface` elements
for one window. Gateway settings and Keyboard Shortcuts rendered successfully.
The shortcut list still advertised terminal, HUD and chat-tab actions, so browser
capability filtering requires an explicit audit rather than assuming every
upstream control remains supported.

## Additional findings

- The browser shell previously added `OverlayView` for Settings and Command Center, although
  `ContribWiring` mounts their real overlays separately. Their `chatRoutes` entries
  render null, so the browser wrapper adds an empty overlay, rather than hosting
  the actual settings content. It also unmounts `BrowserWorkspace` while they are
  open. This added competing close/focus ownership and changed chat component
  lifetime. It has been removed; the built-image settings test now verifies one
  upstream overlay and draft preservation.
- The earlier `envOverride: false` change was not evidence of an auth repair:
  `rendererOverrides` replaces upstream GatewaySettings with our own component,
  whose sign-in button does not depend on that flag.
- The speculative cookie rewrite stripped Secure attributes/prefixes based on
  the proxy socket. It was unsupported by a captured failed authenticated login
  and has been removed.
- `tests/browser/browser.spec.mjs` previously required the removed Experience
  selector and old profile dropdown. It has been replaced with browser behavior
  coverage against the built nginx image.
- The browser entry was previously selected through the old
  legacy build flag. The flag and selector are now removed, so
  dev, Docker, preview, and CI all ship the browser root.
- The synthetic gateway needs fuller settings fixtures: Appearance hit
  `rankedGalleryPets` because the generic RPC fallback returned `{ ok: true }`
  for `pet.gallery`, without its required `pets` array. This is a test-fixture
  limitation, not evidence that the real gateway has the same failure.

## Ordered implementation

1. **Restore explicit shared startup first.** Add a named browser initialization
   adapter under `src/upstream/`, imported before rendering the browser root.
   Initially use an explicit side-effect import of the checked upstream controller
   module to recover its shared registrations without mounting its desktop layout
   or restoring the selector. Document why it is required. Verify fresh startup,
   existing stored layout and a production bundle. Keep one `ContribWiring` owner.

2. **Separate initialization from desktop presentation.** Move the adapter onto a
   checked wrapper transform that retains required initialization while excluding
   the unused controller component, or use a dedicated upstream initialization
   entry if one becomes available. Do not duplicate hundreds of registration lines
   or edit fetched renderer sources. Check single initialization and HMR behavior.
   Retain internal session/pane lifecycle support used by Bots while disabling
   user-facing chat-tab creation.

3. **Repair modal ownership.** Let existing overlay routes use their upstream
   overlay exactly once. Wrap only full-page views that need browser modal
   presentation, such as Capabilities, Messaging and Artifacts. Preserve the
   workspace/composer lifecycle and return route, including query parameters.
   Verify Escape, close buttons, back/forward, settings deep links and drafts.
   Audit settings and shortcut controls against browser bridge capabilities;
   remove obsolete desktop-only actions and wire retained actions to the browser
   shell. Do not infer that restoring initialization fixes every setting.

4. **Remove unsupported auth workarounds.** Restore the intended server-configured
   connection semantics and remove the speculative cookie rewrite unless an
   authenticated reproduction demonstrates a separate cookie problem. Test login,
   session renewal, websocket tickets and reconnect independently from rendering;
   never use a healthy public status endpoint as proof that private APIs work.

5. **Replace browser tests with browser behavior tests.** Use the synthetic
   gateway to assert fresh-load transcript/editor, nonempty required registrations,
   bot selection, avatar metadata, profile switching and panel open/close. Exercise
   settings sections using complete response fixtures, modal return/draft
   preservation and disabled chat-tab gestures
   on desktop and mobile widths. Include a saved layout containing old chat tabs.
   Keep transform contracts and typecheck as additional checks.

6. **Align the shipped entry point and verify deployment.** Once the focused repair
   passes, remove the obsolete build-time choice or make browser startup consistent
   across dev, Docker, preview and CI. Build the deployable artifact and exercise
   its browser tests. Refresh the Tailscale demo with that verified code, then check
   authenticated chat history, Bots, profile images, settings and reconnect against
   the real gateway before declaring the problem fixed.

## Final verification evidence

- `corepack pnpm --filter web-desktop run build` and the Docker runtime build
  both completed successfully.
- `node scripts/browser.test.mjs` passed all 12 transform and contract tests.
- `corepack pnpm test:foundation` passed all 44 foundation, compatibility, and
  state-safety tests.
- `HERMES_TEST_IMAGE=hermes-web:browser-repair node
  apps/web-desktop/scripts/test-gateway-proxy.mjs` passed dev, preview, and
  nginx auth-cookie, gateway-routing, and WebSocket checks.
- `node scripts/typecheck.mjs` passed with no diagnostics.
- The rebuilt nginx image passed all six browser behavior tests against the
  synthetic gateway: fresh chat/Bots startup, settings and gateway overlay,
  browser keybind filtering, mobile Files panel draft preservation, full-page
  modal return, and startup chunk recovery.
- The Tailscale-facing `hermes-web-pr13` container now serves the rebuilt image
  on port 4174 with the existing gateway target.
- The real gateway's public status endpoint responds, while protected profile
  and session endpoints correctly return `401` without a browser session; no
  credentials are available to this repair run, so those authenticated checks
  remain a user-session smoke test.

## Completion criteria

A fresh browser and a browser with saved state must both open existing chats,
switch bots and profiles, preserve drafts through settings/modals, and operate
Files/Review controls without restoring the desktop layout or chat-tab workflow.
The browser end-to-end suite must pass against the built artifact. Real gateway
authentication and data loading remain a separate final verification requirement.
