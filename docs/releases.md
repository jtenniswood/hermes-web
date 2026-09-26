# Releases and rollback

Hermes Web is a personal project in early development. The normal loop is:
make a small change, typecheck and build, try the affected workflow, then merge.
A full browser suite, staged image promotion, and release evidence records are
not required for routine changes.

## Build and deploy

`release.yml` publishes a native `linux/amd64` image on pushes to `main`, version
tags, and manual dispatch. Docker verifies the pinned renderer, runs typechecking,
and builds the frontend. Every successful publication updates `latest` and
`sha-<revision>`; main builds also update `main`, and version tags publish their
version. The renderer revision comes from `flake.lock`.

A push to `main` also deploys that run's exact image digest through Docker Compose.
The deployment waits for the nginx health check and restores the previous image
if it fails. Version tags and manual builds do not deploy. The health check proves
that nginx responds; manually try the changed feature to check its behavior.

## Deployment setup

Configure these repository Actions secrets:

- `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET`: a Tailscale OAuth client with
  `auth_keys` write scope and permission to create `tag:ci` nodes. Tailnet ACLs
  must allow `tag:ci` to reach the deployment host on SSH.
- `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_PRIVATE_KEY`,
  and `PRODUCTION_SSH_KNOWN_HOSTS`: the tailnet host, a dedicated deploy account,
  its private key, and the pinned SSH host key. The account needs permission to
  use Docker and Docker Compose.

Set the repository Actions variable `PRODUCTION_DEPLOY_PATH` to an absolute
path without spaces, for example `/opt/hermes-web`. On the VPS, create that
directory and place these untracked files in it:

- `.env.hermes-web`: the container runtime settings, based on
  `apps/web-desktop/.env.example`.
- `.deploy.env`: set `HERMES_HOME_HOST` to the existing host Hermes data
  directory and optionally `HERMES_WEB_PORT` to the port used by the reverse
  proxy (default `4174`). Set `HERMES_WEB_BIND` if the existing container binds
  only to a specific host interface. Preserve the same data directory and port
  used by the current container so user data and the reverse proxy remain
  connected.

The workflow copies the Compose definition and deployment script on each run.
The first deployment replaces an unmanaged `hermes-web` container with the
Compose-managed one; subsequent main merges pull and roll out the new digest.
Publishing still happens in GitHub Actions; the VPS only pulls and runs the
image.

## Roll back

For a functional regression after deployment, select the previous image digest
from the GitHub Actions build output or registry. On the deployment host, run the
same deployment script with that digest (replace the example image reference):

```sh
bash /opt/hermes-web/deploy.sh /opt/hermes-web \
  ghcr.io/OWNER/REPOSITORY@sha256:PREVIOUS_DIGEST
```

Use the configured deployment directory if it differs from `/opt/hermes-web`.
For a private image, sign in to GHCR first. The script uses the existing runtime
configuration and volumes. Do not clear browser storage or rebuild an old commit
to recover a previous release. Installed PWAs still coordinate activation with
open tabs so drafts and active work remain protected.

## Focused checks when useful

Use existing checks for the behavior being changed, rather than running every
suite for every edit. For example, draft persistence changes can use:

```sh
node --test scripts/draft-persistence.test.mjs
```

For changes to PWA activation or rollback, the existing real-composer upgrade
suite is available on demand with a built candidate image:

```sh
node scripts/prepare-upgrade-baseline.mjs
HERMES_TEST_IMAGE=hermes-web:verification pnpm exec playwright test tests/browser/upgrades.spec.mjs --project=chromium
```

This suite uses a synthetic gateway and an immutable previous image from
`tests/fixtures/upgrade-baseline.json`. It is optional diagnostic coverage, not a
release gate. Keep its baseline distinct from the candidate when using it.

## Renderer updates

Keep renderer upgrades separate from unrelated UI changes when practical. Review
changed compatibility assumptions, typecheck and build, then try the affected
chat workflows. Keep source fingerprints and draft/update protections intact.

Automatic renderer proposals are parked. They are not required to develop,
publish, or deploy this app. The [updater reference](upstream-updates.md) describes
the retained automation tooling; its historical activation checklist is not the
current development policy. Neither `HERMES_RENDERER_UPDATES_ENABLED` nor
`HERMES_PROMOTION_ENABLED` controls the normal image publisher or deployment.
