# ---------- builder ----------
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy package files for dependency resolution
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/stralsakerhet/package.json packages/stralsakerhet/package.json

# Install all dependencies (hoisted to root node_modules)
RUN npm ci

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/stralsakerhet/tsconfig.json packages/stralsakerhet/tsconfig.json
COPY packages/stralsakerhet/src/ packages/stralsakerhet/src/

RUN npm run build -w packages/core && npm run build -w packages/stralsakerhet

# ---------- production ----------
FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/stralsakerhet/package.json packages/stralsakerhet/package.json
RUN npm ci --omit=dev && npm cache clean --force && \
    apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy built output
COPY --from=builder /build/packages/core/dist/ packages/core/dist/
COPY --from=builder /build/packages/stralsakerhet/dist/ packages/stralsakerhet/dist/

# Copy data (database built during CI ingestion step)
COPY packages/stralsakerhet/data/ packages/stralsakerhet/data/

ENV PORT=3000
ENV DB_PATH=/app/packages/stralsakerhet/data/database.db

USER nodejs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "packages/stralsakerhet/dist/http-server.js"]
