# syntax=docker/dockerfile:1

# ---- build: install, compile shared + server, bundle web ----
FROM node:22-alpine AS build
WORKDIR /opt/app
# Toolchain only for native modules that have no prebuilt binary for this platform.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
# Set by CI from the git tag (docker/metadata-action); falls back to package.json at runtime.
ARG APP_VERSION=""
LABEL org.opencontainers.image.title="image-organizer" \
      org.opencontainers.image.description="Self-hosted photo & video organizer: fix dates, timezones and GPS, rename by template" \
      org.opencontainers.image.source="https://github.com/ZeroOmar/image-organizer" \
      org.opencontainers.image.licenses="Apache-2.0"
# exiftool (perl) for metadata, ffmpeg for video/HEIC frames, su-exec for PUID/PGID, tzdata for zones.
# apk upgrade pulls Alpine security fixes newer than the base image snapshot.
RUN apk upgrade --no-cache \
 && apk add --no-cache exiftool ffmpeg su-exec tzdata libcap \
 && setcap cap_net_bind_service=+ep "$(command -v node)"
WORKDIR /opt/app
COPY --from=build /opt/app/package.json ./
COPY --from=build /opt/app/node_modules node_modules
COPY --from=build /opt/app/packages/shared/package.json packages/shared/
COPY --from=build /opt/app/packages/shared/dist packages/shared/dist
COPY --from=build /opt/app/apps/server/package.json apps/server/
COPY --from=build /opt/app/apps/server/dist apps/server/dist
COPY --from=build /opt/app/apps/web/dist apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/hash-password /usr/local/bin/hash-password
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/hash-password \
    && mkdir -p /media /trash /import \
    && chmod 777 /media /trash /import

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    APP_DIR=/app \
    PUID=1000 \
    PGID=1000
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-80}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/opt/app/apps/server/dist/main.js"]
