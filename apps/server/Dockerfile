FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w @videocat/shared && npm run build -w @videocat/server

FROM base AS runtime
ENV NODE_ENV=production
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --chown=node:node --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=build /app/apps/server/dist ./apps/server/dist
COPY --chown=node:node --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --chown=node:node --from=build /app/apps/server/package.json ./apps/server/package.json
RUN mkdir -p /data/video-catalog/thumbnails && chown -R node:node /data
WORKDIR /app/apps/server
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
