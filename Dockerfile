FROM node:24-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build node node_modules/prisma/build/index.js generate

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json server.js ./
COPY prisma ./prisma
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN mkdir -p /app/storage/media && chown -R node:node /app/storage
USER node
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
