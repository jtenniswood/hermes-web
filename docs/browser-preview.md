# Browser preview

This review build uses the browser-focused shell with the pinned Hermes Desktop
 renderer, gateway connection, providers, chat, composer, session surfaces, Bot
 contributions, settings, and plugin discovery. The browser-focused shell is
 now the only web entry point in dev, Docker, preview, and CI.

The browser shell supplies Sessions/Bots/Tools navigation, a profile selector,
and a drawer below 48rem. On narrow desktop windows, the drawer overlays the
chat at the saved sidebar width, capped to leave part of the chat visible.
Click outside it, use its close button, or press Escape to return to the chat.
Mobile navigation still fills the screen. Narrow desktop windows keep desktop sizing,
right-click menus, and hover submenus; compact touch devices use larger touch
targets and action sheets. Its main area reuses the upstream workspace tree for
the chat, composer, streaming, and contributed panel bodies while keeping the
browser experience to one visible conversation. Desktop chat tabs, split
sessions, duplicate title bars, and browser-owned menu rewrites are not exposed.
Settings and contributed tools still use upstream bodies and actions. Browser
navigation and layout preferences are stored separately; theme, zoom and draft
storage remain shared.

Contributed panels have a close button even when opened alone. On desktop,
their Tools entries also toggle them open or closed and highlight the active
panel. On phones, Tools opens the panel as an overlay with its own close button.

The browser toolbar keeps gateway health and approval mode visible. Browser-owned
settings, Bots filters, and approval controls use the shared menu treatment while
the remaining upstream actions retain their callbacks. An available version
update still marks the relevant update control.

## Run the isolated preview

Add the `preview-image` label to a same-repository PR to run the
`browser-preview` workflow. It builds and tests the actual nginx image, then
publishes an immutable amd64 PR image and its synthetic gateway. This optional
job is separate from the required compatibility checks so ordinary edit/test
iterations do not wait for an image publication.
Download the `browser-preview-images-<commit>` artifact for the exact image names.
From this branch, start a separate Docker Compose project:

```sh
docker compose --env-file browser-preview-images.env -f compose.browser-preview.yml up -d
```

Open `http://localhost:4186/`. The preview always uses the browser-focused shell.
An operator can expose that loopback port through their normal HTTPS access
layer. `HERMES_PREVIEW_PORT` changes the loopback port. The Compose project has
its own network and containers; it does not restart or join production.

The default gateway contains synthetic conversations and three profiles. It
streams deterministic responses without calling an external model. Its state is
in memory and resets when that preview gateway restarts. Do not put real private
conversations into this fixture. To use a real gateway instead, set
`HERMES_GATEWAY_URL` and optionally `HERMES_GATEWAY_NAME` in an untracked local
environment file; the normal runtime configuration and sign-in flow apply.

Build locally when CI images are not needed:

```sh
docker build --build-arg HERMES_WRAPPER_REV="$(git rev-parse HEAD)" \
  --build-arg HERMES_RELEASE_CHANNEL=browser-preview -t hermes-web:browser-preview .
docker build --target preview-gateway -t hermes-web:browser-preview-gateway .
docker compose -f compose.browser-preview.yml up -d
```

Stop only this preview with:

```sh
docker compose -f compose.browser-preview.yml down
```

## Walkthrough

1. Open a seeded session and send a message. Watch the shared streaming behavior.
2. Start a response, or attach a file without sending it. Recording and pending
   uploads continue through the shared browser safety coordinator.
3. Open Research and Writer under Bots, then reopen a session. Try the Profile
   picker, settings, and contributed Tools. On a phone, opening a session or Bot
   closes navigation and returns focus to the conversation.
5. Compare phone and desktop widths, themes, zoom and keyboard navigation.

Build identity is available at `/build-info.json` and through the app's build
metadata. It identifies the wrapper commit, renderer commit, dependency lock,
build time and browser-preview channel; backend version is reported separately.

## Verification and compatibility

```sh
corepack pnpm typecheck
corepack pnpm test:foundation
corepack pnpm exec playwright install chromium webkit
HERMES_TEST_IMAGE=hermes-web:browser-preview \
  corepack pnpm exec playwright test
HERMES_TEST_IMAGE=hermes-web:browser-preview \
  corepack pnpm exec playwright test --project=webkit tests/browser/webkit.spec.mjs
```

Playwright starts an isolated synthetic gateway and tests through the actual
built nginx image. CI retains screenshots, test results and failure traces.
An explicit `HERMES_BROWSER_PREVIEW_URL` can instead test an already running synthetic
preview. The ordinary compatibility workflow separately verifies the stable
build.

The adapter checks exact upstream shell entrypoint, wiring, controller,
titlebar, and storage contracts before enabling composition overrides. A changed
contract fails the browser preview build for review. Fetched sources stay untouched.
This preview remains isolated from the stable production rollout.

The build also checks a narrow compatibility fix for the locked nanostores
1.4.0 package: its `batch()` annotation incorrectly permits the bundler to remove
state-changing callbacks. The adapter removes that annotation in memory. A
regression test builds the same callback both without and with the fix, proving
that profile updates survive the production bundler. Neither the installed
package nor the fetched renderer is modified.

See [captured screenshots and verification evidence](screenshots/browser-preview/README.md)
for the reviewed application identity, phone/desktop views and executed checks.

During a controlled reload, an aborted initial module download receives one
bounded startup retry before a composer mounts. A persistent failure stops at an
explicit Reload screen. The retry keeps the URL and stored draft and is disabled
when its per-tab retry marker cannot be stored, preventing reload loops.
