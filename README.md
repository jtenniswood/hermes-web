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

Build the web files with Nix:

```bash
nix build .#
```

To build, copy, and health-check the files served by the Nix-managed Hermes
dashboard:

```bash
cp apps/web-desktop/.env.example apps/web-desktop/.env
# Set HERMES_WEB_URL in apps/web-desktop/.env
apps/web-desktop/scripts/deploy.sh
```

The deploy script copies the build to `~/.hermes/desktop-web` by default. It
does not start or restart any processes.

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

Pull requests run strict wrapper and reachable-renderer typechecking, foundation
tests, gateway regression tests, and a production build. Upstream diagnostics
are not broadly ignored; the explicit diagnostic baseline is currently empty.

### Connecting to a remote gateway

Set `HERMES_GATEWAY_URL` in `apps/web-desktop/.env` to the remote gateway's
base URL, then restart the dev/preview server or recreate the Docker container
with the updated environment. The web server must be able to reach that URL.
In the connection settings, use that same URL or the web app's own origin.

The browser connects through the web server's proxy for HTTP, login, and
WebSockets. Unlike the Mac desktop app, a browser cannot directly fetch an
HTTP gateway from an HTTPS page. Entering a remote URL in settings alone does
not configure the server's proxy. For additional dev/preview gateways, set
`HERMES_GATEWAY_WHITELIST` to a comma-separated list in the same environment
file.

If an existing installed PWA still reports an unreachable gateway after an
update, close and reopen it after the new service worker activates. Runtime
gateway configuration is excluded from the app's offline cache.

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
