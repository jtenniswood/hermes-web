#!/bin/sh
set -eu
# Docker --env-file is the supported source; never evaluate a mounted shell file.
node /opt/hermes/runtime-config.mjs
exec "$@"
