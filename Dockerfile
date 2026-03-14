# ─── Stage 1: build the SPA ───────────────────────────────────────────────────
FROM node:22-alpine AS app-builder
WORKDIR /build

# install sdk deps first (skip prepare so we don't need src yet)
COPY sdk/package.json sdk/
RUN cd sdk && npm install --legacy-peer-deps --ignore-scripts
COPY sdk sdk/
RUN cd sdk && npm run build

COPY demo/app/package.json demo/app/
RUN cd demo/app && npm install --legacy-peer-deps

COPY demo/app demo/app
RUN cd demo/app && npm run build

# ─── Stage 2: install server deps ─────────────────────────────────────────────
FROM node:22-alpine AS server-builder
WORKDIR /build

# install sdk deps first (skip prepare so we don't need src yet)
COPY sdk/package.json sdk/
RUN cd sdk && npm install --legacy-peer-deps --ignore-scripts
COPY sdk sdk/
RUN cd sdk && npm run build

COPY demo/server/package.json demo/server/
RUN cd demo/server && npm install --omit=dev --legacy-peer-deps

COPY demo/server demo/server

# ─── Stage 3: final image ─────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY --from=server-builder /build/sdk sdk/
COPY --from=server-builder /build/demo/server demo/server/
COPY --from=app-builder /build/demo/app/dist demo/app/dist/

WORKDIR /app/demo/server

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node_modules/.bin/tsx", "index.ts"]
