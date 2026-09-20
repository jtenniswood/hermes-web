#!/usr/bin/env bash
# Stage an already downloaded CI artifact. Never build or restart services here.
set -euo pipefail
: "${1:?usage: deploy.sh /absolute/path/to/extracted-ci-artifact}"
artifact_dir="$(cd "$1" && pwd)"
: "${HERMES_WEB_DIST_DIR:=$HOME/.hermes/desktop-web}"
test -f "$artifact_dir/index.html"
test -f "$artifact_dir/build-info.json"
revision="$(node -e 'const fs=require("node:fs"); const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!/^[a-f0-9]{40}$/.test(b.wrapperRevision)||!/^[a-f0-9]{40}$/.test(b.rendererRevision)) process.exit(1); process.stdout.write(b.wrapperRevision+"-"+b.rendererRevision)' "$artifact_dir/build-info.json")"
release_dir="$HERMES_WEB_DIST_DIR/releases/$revision"
mkdir -p "$HERMES_WEB_DIST_DIR/releases"
if [ ! -d "$release_dir" ]; then
  staging_dir="$(mktemp -d "$HERMES_WEB_DIST_DIR/releases/.staging.XXXXXX")"
  trap 'rm -rf "$staging_dir"' EXIT
  cp -r "$artifact_dir/." "$staging_dir/"
  mv "$staging_dir" "$release_dir"
  trap - EXIT
fi
link_dir="$(mktemp -d "$HERMES_WEB_DIST_DIR/.link.XXXXXX")"
trap 'rm -rf "$link_dir"' EXIT
ln -s "$release_dir" "$link_dir/current"
mv -Tf "$link_dir/current" "$HERMES_WEB_DIST_DIR/current"
echo "Staged $revision. Restart the configured web service separately to activate it."
