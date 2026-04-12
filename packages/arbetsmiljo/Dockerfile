# ---------- builder ----------
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy workspace root package.json + lockfile
COPY package.json package-lock.json* ./

# Copy package.json files for dependency resolution
COPY packages/core/package.json packages/core/package.json
COPY packages/arbetsmiljo/package.json packages/arbetsmiljo/package.json

# Install all workspace dependencies
RUN npm install --workspace=packages/core --workspace=packages/arbetsmiljo

# Copy source
COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/arbetsmiljo/ packages/arbetsmiljo/

# Build core first, then agency package
RUN npm run build --workspace=packages/core && \
    npm run build --workspace=packages/arbetsmiljo

# ---------- production ----------
FROM node:20-slim

RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Copy built output
COPY --from=builder /build/packages/core/dist/ packages/core/dist/
COPY --from=builder /build/packages/core/package.json packages/core/package.json
COPY --from=builder /build/packages/arbetsmiljo/dist/ packages/arbetsmiljo/dist/
COPY --from=builder /build/packages/arbetsmiljo/package.json packages/arbetsmiljo/package.json

# Copy workspace root
COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/core/node_modules/ packages/core/node_modules/
COPY --from=builder /build/packages/arbetsmiljo/node_modules/ packages/arbetsmiljo/node_modules/

# Copy data directory (database)
COPY packages/arbetsmiljo/data/ packages/arbetsmiljo/data/

ENV PORT=3000
ENV DB_PATH=/app/packages/arbetsmiljo/data/database.db

USER nodejs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "packages/arbetsmiljo/dist/http-server.js"]
