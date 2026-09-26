#!/usr/bin/env bash
set -Eeuo pipefail

cleanup() {
  docker logout ghcr.io >/dev/null 2>&1 || true
}
trap cleanup EXIT

deploy_path=${1:?Usage: deploy.sh DEPLOY_PATH IMAGE_REF}
image_ref=${2:?Usage: deploy.sh DEPLOY_PATH IMAGE_REF}
compose_file="$deploy_path/compose.yml"
deploy_env="$deploy_path/.deploy.env"
runtime_env="$deploy_path/.env.hermes-web"

[[ -f "$compose_file" ]] || { echo "Missing $compose_file" >&2; exit 1; }
[[ -f "$deploy_env" ]] || { echo "Create $deploy_env with HERMES_HOME_HOST and optional HERMES_WEB_PORT" >&2; exit 1; }
[[ -f "$runtime_env" ]] || { echo "Missing runtime settings file $runtime_env" >&2; exit 1; }

export HERMES_WEB_IMAGE="$image_ref"
compose=(docker compose --env-file "$deploy_env" -f "$compose_file")
"${compose[@]}" config -q
previous_image=""
docker pull "$image_ref"

if docker inspect hermes-web >/dev/null 2>&1; then
  previous_image=$(docker inspect --format '{{.Config.Image}}' hermes-web)
  compose_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' hermes-web)
  if [[ "$compose_project" != hermes-web ]]; then
    docker rm -f hermes-web >/dev/null
  fi
fi
"${compose[@]}" up -d --remove-orphans

healthy=false
for _ in {1..30}; do
  state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hermes-web 2>/dev/null || true)
  if [[ "$state" == healthy || "$state" == running ]]; then
    healthy=true
    break
  fi
  if [[ "$state" == unhealthy || "$state" == exited || "$state" == dead ]]; then
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  echo "New container failed its health check; rolling back." >&2
  docker logs --tail 100 hermes-web >&2 || true
  if [[ -n "$previous_image" ]]; then
    HERMES_WEB_IMAGE="$previous_image" "${compose[@]}" up -d --force-recreate
  else
    "${compose[@]}" down
  fi
  exit 1
fi

echo "Deployed $image_ref"
