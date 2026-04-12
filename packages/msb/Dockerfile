# ---------- builder ----------
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/package.json
COPY packages/msb/package.json packages/msb/package.json

RUN npm install --workspace=packages/core --workspace=packages/msb

COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/msb/ packages/msb/

RUN npm run build --workspace=packages/core && \
    npm run build --workspace=packages/msb

# ---------- production ----------
FROM node:20-slim

RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

COPY --from=builder /build/packages/core/dist/ packages/core/dist/
COPY --from=builder /build/packages/core/package.json packages/core/package.json
COPY --from=builder /build/packages/msb/dist/ packages/msb/dist/
COPY --from=builder /build/packages/msb/package.json packages/msb/package.json

COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/core/node_modules/ packages/core/node_modules/
COPY --from=builder /build/packages/msb/node_modules/ packages/msb/node_modules/

COPY packages/msb/data/ packages/msb/data/

ENV PORT=3000
ENV DB_PATH=/app/packages/msb/data/database.db

USER nodejs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "packages/msb/dist/http-server.js"]
