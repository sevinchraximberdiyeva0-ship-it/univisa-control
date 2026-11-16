FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
CMD ["node","apps/api/dist/src/server.js"]
