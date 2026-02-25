# =============================================================================
# AntiClaw - Multi-stage Docker build
# =============================================================================
# Builds the Next.js client and Express server into a single production image.
# Optionally includes code-server for browser-based code editing.

FROM node:22-alpine AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# --- Build ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Production ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install code-server (optional, for /code route)
RUN apk add --no-cache curl bash \
  && curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/usr/local \
  || true

# Copy built assets
COPY --from=builder /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src

EXPOSE 3000

# Start server (code-server started as a subprocess if available)
CMD ["node", "--import", "tsx", "src/server/index.ts"]
