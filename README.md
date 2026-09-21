# Hermes Web

Hermes Desktop’s chat UI as a web app and installable PWA, with a Docker image
for self-hosting. The renderer is fetched from
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at
build time.

> This is an unofficial, AI-generated project. It is intended for private
> networks such as Tailscale and is not hardened for the public internet.

## Repository

- `apps/web-desktop/` — web app, bridge, styles, and overrides
- `flake.nix` — Nix development and production build
- `Dockerfile` — Nix-free frontend image using nginx
- `apps/web-desktop/.env.example` — local and Docker configuration template

The upstream renderer is supplied by the Nix flake or fetched by Docker. Do
not add or edit `apps/desktop/` or `apps/shared/`; those directories contain
upstream renderer sources.

## Development

```bash
corepack enable
pnpm prepare:renderer
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5174/>. Run the focused type check with:

```bash
pnpm typecheck
```

## Build and deploy

Release builds and Nix dependency verification run in GitHub Actions. Download
and extract the `web-dist-<commit>` artifact to stage a static deployment:

```bash
HERMES_WEB_DIST_DIR="$HOME/.hermes/desktop-web" \
  apps/web-desktop/scripts/deploy.sh /absolute/path/to/extracted-artifact
```

The script validates build identity, preserves immutable release directories,
and atomically changes the `current` link. It does not build or restart anything.
Restart the configured web service separately to activate a staged release.
The Nix home-manager module serves these artifacts with nginx; `directory` now
means the extracted artifact directory, not a source checkout.

## Docker

Build and run the frontend image:

```bash
docker build -t hermes-web .

docker run --rm --name hermes-web \
  -p 4174:80 \
  --env-file apps/web-desktop/.env \
  --add-host host.docker.internal:host-gateway \
  -v "$HOME/.hermes:/data/hermes" \
  hermes-web
```

The example environment file sets:

- `HERMES_GATEWAY_URL` — gateway address; in Docker, use
  `http://host.docker.internal:9119` when the gateway runs on the host.
- `HERMES_HOME` — container path for the mounted Hermes configuration and
  plugins. The default is `/data/hermes`.
- `HERMES_WEB_URL` — URL used by the Nix deploy health check.
- `WEB_ALLOWED_HOSTS` — additional hostnames allowed by Vite during local
  development.

Docker, development, and Nix use the exact Hermes revision in `flake.lock`.
`pnpm prepare:renderer` fetches that revision into an ignored cache and creates
the source links. It refuses to overwrite existing or modified renderer sources.
Use `pnpm check:renderer` to verify a checkout.

The application emits `build-info.json` with the wrapper revision, renderer
revision, dependency-lock hash, timestamp, and release channel. CI supplies the
wrapper identity to Docker; local image builds can supply `HERMES_WRAPPER_REV`.
The frontend version is separate from the connected gateway version.

Microphone recording requires HTTPS when opening the app from another device.
Use an HTTPS reverse proxy (or Tailscale Serve for a private demo); an HTTP LAN
or tailnet address cannot request microphone permission. Local development on
`http://localhost` also supports recording. Click the microphone and allow access
when the browser asks. If access was previously blocked, enable Microphone in
the browser's site permissions and try again.

Pull requests run strict wrapper and reachable-renderer typechecking, foundation
tests, gateway regression tests, and a production build. Upstream diagnostics
are not broadly ignored; the explicit diagnostic baseline is currently empty.

### Connecting to a remote gateway

Set `HERMES_GATEWAY_URL` to one HTTP(S) origin, without credentials or a path.
Restart development or recreate the container to apply a server change. The
browser connects through the web server for HTTP, login, and WebSockets.
Connection settings offer browser sign-in or a session token, connection testing,
and sign-out. Changing the gateway address is an operator setting.

Additional gateway whitelists and browser routing selectors are no longer used.
`HERMES_GATEWAY_NAME` optionally sets the connection label. Runtime configuration
is validated before nginx starts and excluded from the PWA cache. The previous
`gateway-config.js` endpoint remains available for older installed clients.
Docker accepts environment variables through `--env-file`; it no longer evaluates
an executable mounted `/app/.env` file.

The nginx image includes Node only for the shared configuration generator at
startup; nginx handles all requests. The same generator and route contract are
used by development and the Nix service.

GitHub Actions publishes multi-architecture images to GHCR after changes are
merged to `main` and for version tags.

## Editing the UI

Change only this repository’s files:

- CSS overrides: `apps/web-desktop/src/web-overrides.css`
- Web bridge behavior: `apps/web-desktop/src/web-bridge/`
- Component swaps: `apps/web-desktop/src/overrides/` plus an alias in
  `vite.config.ts`
- New components and helpers: `apps/web-desktop/src/components/` and
  `apps/web-desktop/src/lib/`

After updating the upstream renderer with `nix flake update hermes`, verify
that any configured aliases still match its module paths.

## Browser integration boundaries

Browser services live in `apps/web-desktop/src/platform/`. Only the
`src/upstream/` adapter imports renderer internals. The public browser bridge
keeps the desktop API shape while composing transport, files, clipboard,
notifications, and display services. Native terminal and git APIs remain absent.

The renderer transforms have named, reviewed source/output fingerprints. A
change to a targeted upstream module stops the compatibility build until the
transform is reviewed; the updater must never regenerate these fixtures itself.
This deliberately favors a delayed upstream update over silently changed chat
routing. `pnpm test:foundation` checks the transforms, import boundary, and
shared TypeScript/Vite alias mappings.

### Browser state and application updates

Credentials are stored under `hermes-web.connection.v2.<gateway identity>`.
Only an explicitly matching active legacy connection can migrate a token;
ambiguous records remain untouched and require sign-in. Theme, zoom, desktop
layout and upstream text-draft keys remain unchanged. When storage is blocked,
sign-in remains in memory and the connection screen explains the limitation.

A waiting service worker shows **Update when safe**. It flushes upstream text
drafts and checks all open app tabs before activation. Active responses, file
selection/uploads, recording, unsent attachments, unsaved text, conflicting
cross-tab drafts and unresponsive older tabs postpone the update. Finish that
work or close older tabs, then retry. This does not add offline chat: cached
application assets still need the configured gateway for chat and sign-in.
Runtime configuration, authentication, API responses and plugin files are not
part of the application precache.

Run browser checks against a built image:

```sh
pnpm exec playwright install chromium webkit
HERMES_TEST_IMAGE=hermes-web pnpm exec playwright test
```

The tests use a local synthetic backend without model requests. They cover
browser recovery, credential migration and the all-tab update protocol through
nginx. CI retains screenshots and failure traces. Full chat/Bot parity and a
real-gateway smoke test are additional rollout gates.

### Renderer release automation

See [release setup and rollback](docs/releases.md) for the repository-scoped
GitHub App, required checks, separate enablement switches, image promotion and
rollback by digest. Daily renderer proposals use the exact upstream commit and
can change only renderer lock metadata. `release.yml` is the single publisher;
a release publishes an image without restarting the production deployment.

### Browser-focused preview

The preview build uses the browser-focused shell backed by the upstream chat
engine. See the [preview guide](docs/browser-preview.md) for the isolated
Compose stack and exact PR images. The browser-focused shell is the only web
entry point in stable and preview builds; preview images add only the synthetic
gateway and review fixtures.
