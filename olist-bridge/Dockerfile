# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl wget \
  && addgroup -S shopify \
  && adduser -S shopify -G shopify

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/validate-production-env.mjs ./scripts/validate-production-env.mjs
RUN npm ci --omit=dev \
  && npm exec prisma generate \
  && npm cache clean --force

COPY --from=build /app/build ./build

RUN chown -R shopify:shopify /app
USER shopify

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["npm", "run", "docker-start"]
