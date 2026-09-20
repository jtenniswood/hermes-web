# syntax=docker/dockerfile:1
# The renderer revision is read from flake.lock by every build path.
FROM node:24-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml flake.lock ./
COPY scripts ./scripts
COPY apps/web-desktop/package.json apps/web-desktop/package.json
RUN node scripts/renderer.mjs \
 && pnpm install --frozen-lockfile
COPY apps/web-desktop ./apps/web-desktop
ARG HERMES_WRAPPER_REV=unknown
ARG HERMES_RELEASE_CHANNEL=local
ARG SOURCE_DATE_EPOCH
ENV HERMES_WRAPPER_REV=$HERMES_WRAPPER_REV \
    HERMES_RELEASE_CHANNEL=$HERMES_RELEASE_CHANNEL \
    SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH
RUN node scripts/renderer.mjs --check \
 && pnpm --filter web-desktop run build

# ---- runtime stage: nginx -------------------------------------------------------
FROM nginx:alpine
# Node runs only the shared configuration generator at startup; nginx serves requests.
RUN apk add --no-cache nodejs

# The gateway URL + HERMES_HOME are injected by docker-entrypoint.sh via
# the shared validated configuration generator at container start.
COPY nginx.conf.template /etc/nginx/hermes.conf.template
COPY scripts/runtime-config.mjs /opt/hermes/runtime-config.mjs
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY --from=build /app/apps/web-desktop/dist /usr/share/nginx/html

# Defaults — override with -e at runtime.
ENV HERMES_GATEWAY_URL=http://127.0.0.1:9119 \
    HERMES_HOME=/data/hermes

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
