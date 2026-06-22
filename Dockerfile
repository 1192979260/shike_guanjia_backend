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
    STORAGE_MODE=mysql

COPY package.json package-lock.json ./
COPY --from=build /app/dist ./dist

RUN npm ci --omit=dev

EXPOSE 3000

CMD ["node", "dist/server.js"]
