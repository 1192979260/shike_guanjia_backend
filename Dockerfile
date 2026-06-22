FROM node:24-bookworm-slim AS build

WORKDIR /app
ARG NPM_CONFIG_REGISTRY

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ARG NPM_CONFIG_REGISTRY

ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_MODE=mysql \
    NODE_OPTIONS=--use-system-ca \
    NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt

COPY package.json package-lock.json ./
COPY --from=build /app/dist ./dist

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    update-ca-certificates && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /var/lib/apt/lists/*

# Run as a non-root user for defense in depth.
RUN useradd -m -u 1001 appuser
USER appuser

EXPOSE 3000

CMD ["node", "dist/server.js"]
