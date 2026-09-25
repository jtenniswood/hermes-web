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

## Docker self-hosting

The Docker image contains the built web UI and nginx. It does not contain a
Hermes gateway or model runtime. At startup, nginx reads the gateway settings
from environment variables and proxies the browser’s REST, login, and
WebSocket requests to that gateway.

### 1. Build the image

From the repository root:

```bash
docker build -t hermes-web:local .
```

The build fetches the renderer revision pinned in `flake.lock`. For a release
or CI image, pass the wrapper revision and release channel explicitly:

```bash
docker build \
  --build-arg HERMES_WRAPPER_REV="$(git rev-parse HEAD)" \
  --build-arg HERMES_RELEASE_CHANNEL=local \
  -t hermes-web:local .
```

### 2. Create an environment file

Keep deployment settings outside the repository. Start with the supplied
template:

```bash
cp apps/web-desktop/.env.example .env.hermes-web
```

For a gateway running on the Docker host, use:

```dotenv
HERMES_GATEWAY_URL=http://host.docker.internal:9119
HERMES_GATEWAY_NAME=Local Hermes
HERMES_HOME=/data/hermes
```

For a gateway reachable over Tailscale, replace the URL with its Tailscale IP
or MagicDNS hostname:

```dotenv
HERMES_GATEWAY_URL=http://100.64.0.40:9119
HERMES_GATEWAY_NAME=Hermes over Tailscale
HERMES_HOME=/data/hermes
```

The gateway value must be an HTTP(S) origin only. Do not include credentials,
a path, query string, or fragment. Examples such as
`http://host.docker.internal:9119/api` are invalid; the container adds the
`/api`, `/auth`, and `/login` routes itself.

### 3. Start the container

Mount the host Hermes directory so the web app can serve installed plugins and
desktop plugins. On Linux, `--add-host` makes `host.docker.internal` resolve
to the Docker host; it is harmless when the configured gateway is elsewhere.

```bash
docker run -d \
  --name hermes-web \
  --restart unless-stopped \
  --env-file .env.hermes-web \
  --add-host host.docker.internal:host-gateway \
  -p 4174:80 \
  -v "$HOME/.hermes:/data/hermes" \
  hermes-web:local
```

Open <http://localhost:4174/> on the Docker host. From another device, use
the host’s LAN or Tailscale address, for example
`http://dev.example.ts.net:4174/`. Keep the device on the same tailnet when
using a Tailscale address.

For microphone recording and other browser features that require a secure
context, put the container behind HTTPS or use Tailscale Serve. Plain HTTP is
supported for normal chat but browsers generally block microphone access.

### 4. Verify and manage the container

Check the container and its startup configuration:

```bash
docker ps --filter name=hermes-web
docker logs --tail 100 hermes-web
curl http://localhost:4174/build-info.json
curl http://localhost:4174/runtime-config.js
```

Change the gateway or any other environment setting by editing the env file,
then recreate the container. A restart is not enough if the environment was
changed in the `docker run` command itself.

```bash
docker rm -f hermes-web
docker run -d \
  --name hermes-web \
  --restart unless-stopped \
  --env-file .env.hermes-web \
  --add-host host.docker.internal:host-gateway \
  -p 4174:80 \
  -v "$HOME/.hermes:/data/hermes" \
  hermes-web:local
```

To stop it without removing the container:

```bash
docker stop hermes-web
```

### Docker environment settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `HERMES_GATEWAY_URL` | No (recommended) | HTTP(S) origin of the Hermes gateway. Defaults to `http://127.0.0.1:9119` inside the image, which usually means the container itself. |
| `HERMES_GATEWAY_NAME` | No | Label shown for the configured gateway. Defaults to `Hermes`. |
| `HERMES_HOME` | No | Container path for mounted Hermes configuration and plugins. Defaults to `/data/hermes`. |
| `HERMES_BIND` | No | nginx bind address. Defaults to `0.0.0.0`. Normally leave this unchanged when using Docker port publishing. |
| `HERMES_PORT` | No | nginx port inside the container. Defaults to `80`; the left side of `-p 4174:80` is the host port. |

`HERMES_WEB_URL` and `WEB_ALLOWED_HOSTS` are development/deployment settings;
they are not needed by the built nginx container. Docker reads environment
files as data and does not execute shell commands from them.

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

### Gateway configuration details

The browser connects to the configured gateway through nginx, keeping API,
authentication, and WebSocket traffic same-origin with the web UI. This avoids
requiring browser CORS configuration on the gateway and keeps gateway cookies
and WebSocket tickets on the web app’s origin.

Runtime configuration is validated before nginx starts and is excluded from the
PWA cache. The generated `/runtime-config.js` and legacy `/gateway-config.js`
endpoints are served with `Cache-Control: no-store`, so changing the gateway
does not require rebuilding the image. Recreate the container after changing
the environment file.

For a remote gateway, make sure the Docker host can reach the gateway address
and that the gateway accepts the host’s forwarded HTTP/WebSocket requests. A
gateway that is reachable from the host but blocked from Docker’s network will
still appear unavailable in Hermes Web.

When placing Hermes Web behind Cloudflare or another TLS-terminating proxy,
enable WebSocket proxying and preserve the original `X-Forwarded-Proto` header.
The bundled nginx forwards the original `http` or `https` scheme to the gateway
so OAuth redirects and secure session cookies use the browser-facing scheme.

The nginx image includes Node only for the shared configuration generator at
startup; nginx handles all requests. The same generator and route contract are
used by development and the Nix service.

GitHub Actions publishes `linux/amd64` images to GHCR after changes are merged
to `main` and for version tags.

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

The app checks for updates when you return to its tab or reconnect, and every
minute while visible and online. A waiting service worker shows **Update when
safe**. It flushes upstream text drafts and checks all open app tabs before
activation. Active responses, file
selection/uploads, recording, unsent attachments, unsaved text, conflicting
cross-tab drafts and unresponsive older tabs postpone the update. Finish that
work or close older tabs, then retry. This does not add offline chat: cached
application assets still need the configured gateway for chat and sign-in.
Runtime configuration, authentication, API responses and plugin files are not
part of the application precache.

If an HTTPS hostname shows an older UI than the direct HTTP address, its
browser may still be running a cached app shell. Use **Update when safe**, or
close all tabs and installed app windows for that hostname and reopen it. A
fresh private window can confirm whether the difference is browser-local.
For an older client that cannot update, unregister that hostname's service
worker and remove its Cache Storage entries in browser developer tools, then
close its tabs and reopen it. Save any unfinished work first; leave Local
Storage and cookies intact to preserve saved drafts, settings, and sign-in.

nginx prevents HTTP caching of the app shell, service-worker scripts, and build
metadata while keeping content-hashed assets cacheable. This does not forcibly
replace an already active service worker. Cloudflare Access callback paths and
`/build-info.json` bypass the service worker's navigation fallback. If using
custom Cloudflare cache rules, keep these mutable and authentication routes
out of any Cache Everything rule.

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
rollback by digest. Scheduled renderer proposals use the exact upstream commit and
can change only renderer lock metadata. `release.yml` is the single publisher;
a release publishes an image without restarting the production deployment.

The [automatic upstream update runbook](docs/upstream-updates.md) describes setup
auditing, automatic branch refresh, compatibility reports, and repairing blocked
updates. Run `node scripts/check-update-setup.mjs` to inspect readiness without
changing repository settings, or `pnpm check:upstream` to report local source
contract changes before a full build.

### Browser-focused preview

The preview build uses the browser-focused shell backed by the upstream chat
engine. See the [preview guide](docs/browser-preview.md) for the isolated
Compose stack and exact PR images. The browser-focused shell is the only web
entry point in stable and preview builds; preview images add only the synthetic
gateway and review fixtures.
