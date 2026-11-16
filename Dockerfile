# ─── Stage 1: deps ────────────────────────────────────────────────────────────
# Install production + dev dependencies so we can build and generate Prisma.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install all deps (dev included) so `prisma generate` and `nest build` work.
RUN npm ci

# ─── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Copy installed modules, generated Prisma client, and source.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./prisma.config.ts
COPY --from=deps /app/generated ./generated
COPY . .

RUN npm run build

# ─── Stage 3: production ──────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Time zone data and OpenSSL (Prisma's schema engine, migrate deploy at start), as EXPENZO.
RUN apk add --no-cache tzdata openssl
ENV NODE_ENV=production TZ=Africa/Douala

# Only production dependencies.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev

# Compiled app.
COPY --from=build /app/dist ./dist

# Prisma client is generated into generated/prisma (not node_modules),
# so copy it explicitly.
COPY --from=build /app/generated ./generated

# Runs unprivileged, as EXPENZO (the files above stay root-owned and read-only for it).
USER node

# The server listens on PORT (4000 when unset, see src/main.ts).
EXPOSE 4000
# The root route answers outside the /api/v1 prefix (manifest healthUrl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/" > /dev/null || exit 1

# Run pending migrations then start the server. The entry is dist/src/main: prisma.config.ts and
# generated/ (the Prisma client) sit beside src/, so the compiled tree keeps the src/ folder.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/src/main"]
