# Production image for any container host: builds the web app and serves it from the API server.
# Data (SQLite + uploaded files) lives in NC_DATA_DIR — mount a persistent volume there.
FROM node:26-slim
WORKDIR /app
# corepack no longer ships with Node 26: install the pinned pnpm (package.json "packageManager") directly
RUN npm install -g pnpm@10.32.1
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @nc/web build
ENV NODE_ENV=production HOST=0.0.0.0 NC_TRUST_PROXY=1 NC_DATA_DIR=/data
EXPOSE 3001
CMD ["node", "apps/server/src/main.ts"]
