FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run db:generate && npm run build -w apps/api

# Prisma CLI and full migration history are available only in this target.
FROM build AS migration
USER node
CMD ["npm","run","db:migrate"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/api/dist/src ./apps/api/dist/src
COPY scripts/worker-health.mjs ./scripts/worker-health.mjs
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
CMD ["node","apps/api/dist/src/server.js"]
