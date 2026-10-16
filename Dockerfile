# syntax=docker/dockerfile:1

# ── Build: compile the frontend and the backend ─────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 build-base && corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile
COPY packages/ ./packages/
RUN pnpm build

# ── Production dependencies of the backend only ─────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 build-base && corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile --prod --filter @nexotv/backend

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=build /app/packages/backend/package.json ./packages/backend/
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/frontend/dist ./packages/frontend/dist
COPY config/ ./config/
RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- "http://localhost:${PORT:-7000}/health" || exit 1

CMD ["node", "packages/backend/dist/server.js"]
