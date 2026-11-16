# syntax=docker/dockerfile:1

# CreApp Diffusion API (NestJS) for Dokploy: build type "Dockerfile", context = this folder.
# Built and run like EXPENZO's API (creapp-api-v2). Runtime environment (see .env.example), at least:
#   NODE_ENV=production
#   PORT             4000 (the default), the port the UI's API_URL, the core's APP_API_URLS and the
#                    gateway's DIFFUSION_API_URL point to
#   DATABASE_URL     Diffusion's PostgreSQL database (migrations are applied at every start)
#   CORE_URL         the core API as this container reaches it, e.g. http://creapp-core-api:4200
#   CORE_ISSUER      the core's APP_URL exactly (the admin console's public https address)
#   CORE_APP_ID      diffusion
#   CORE_APP_KEY     Diffusion's API key from the console (Platform → Apps → Diffusion → API keys)
#   REDIS_URL        the session store shared with the core, e.g. redis://creapp-redis:6379
#   CORS_ORIGINS     the Diffusion UI's public address
#   APP_URL          the Diffusion UI's public address (links in emails)
#   S3_BUCKET (+ S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_KEY_PREFIX…)  documents
#   MCP_TOOL_LEVELS  what Whass may do, e.g. READ,WRITE,DECISION
# The API has no public address: browsers reach it through the UI (/api/v1 rewrite), the core and
# the AI gateway through the internal network.

FROM node:22-alpine AS build
# Prisma's engines (migrations) need OpenSSL on Alpine, also to pick the right build at install.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
# The build needs the dev tools (Nest CLI, TypeScript), even if the platform sets NODE_ENV or
# NPM_CONFIG_PRODUCTION for the build.
RUN npm ci --include=dev
COPY . .
# prisma.config.ts needs a DATABASE_URL to load; `prisma generate` never connects to it.
# The Prisma client is generated into src/generated and compiled with the app into dist/.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
# OpenSSL for Prisma's schema engine (migrate deploy at start).
RUN apk add --no-cache tzdata openssl
ENV NODE_ENV=production TZ=Africa/Douala
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Migrations and prisma.config.ts, applied at start (CMD).
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health > /dev/null || exit 1
# At every start: apply pending migrations, then serve (the permission catalogue is brought up to
# date by the app itself at boot). A failed migration stops the start rather than serving a
# half-ready database.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main"]
