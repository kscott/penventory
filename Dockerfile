# syntax=docker/dockerfile:1

# --- builder ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- production dependencies only -------------------------------------------
FROM node:22-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime -----------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

# node:22-slim bundles npm/corepack/yarn for the build stages above; the
# runtime CMD only ever calls `node` directly, so none of it is needed here.
# Removing it shrinks the image and drops CVEs that live in npm's own
# internal, frozen dependency versions (not this app's) — e.g. CVE-2026-33671
# and CVE-2026-48815, found nested under npm's own node_modules, not ours.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

USER node

CMD ["node", "build/index.js"]
