# Node 24: built-in node:sqlite, no native modules needed.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production PORT=10000 DB_PATH=/app/data/app.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package.json brand.config.json ./
COPY server ./server
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 10000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
