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

ENV NODE_ENV=production

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

EXPOSE 3000

# Run pending migrations then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
