FROM node:24-trixie-slim AS base
WORKDIR /app
# Security updates for the base packages on every build.
RUN apt-get update -y \
  && apt-get upgrade -y \
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
# npm only creates a workspace node_modules when a dependency cannot be hoisted to the root;
# keep the directory so the runtime stage can always copy it.
RUN npm run build -w @videocat/shared && npm run build -w @videocat/server \
  && mkdir -p apps/server/node_modules

FROM base AS runtime
ENV NODE_ENV=production
# The server never runs a package manager: drop the ones bundled with the Node image
# (and the advisories that come with their own dependencies).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
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
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
