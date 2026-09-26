FROM node:24-bookworm-slim AS dependencies
ENV COREPACK_HOME=/corepack
RUN corepack enable \
    && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-network-retries \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM dependencies AS build
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/converter/package.json packages/converter/package.json
RUN for attempt in 1 2 3; do \
      corepack pnpm install --frozen-lockfile && exit 0; \
      test "$attempt" -eq 3 && exit 1; \
      sleep 5; \
    done

COPY . .
RUN corepack pnpm --filter @subscription-converter/web build

FROM dependencies AS prod-deps
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/converter/package.json packages/converter/package.json
RUN for attempt in 1 2 3; do \
      corepack pnpm install --prod --frozen-lockfile && exit 0; \
      test "$attempt" -eq 3 && exit 1; \
      sleep 5; \
    done

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/app/data/subscription-converter.sqlite \
    STATIC_ROOT=/app/public
WORKDIR /app

COPY --from=prod-deps /workspace/node_modules/ ./node_modules/
COPY --from=prod-deps /workspace/apps/server/node_modules/ ./apps/server/node_modules/
COPY --from=prod-deps /workspace/packages/shared/node_modules/ ./packages/shared/node_modules/
COPY --from=prod-deps /workspace/packages/converter/node_modules/ ./packages/converter/node_modules/
COPY package.json ./
COPY apps/server/ ./apps/server/
COPY packages/shared/ ./packages/shared/
COPY packages/converter/ ./packages/converter/
COPY --from=build /workspace/apps/web/dist/ ./public/

RUN mkdir -p /app/data && chown -R node:node /app
USER node
WORKDIR /app/apps/server
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/index.ts"]
