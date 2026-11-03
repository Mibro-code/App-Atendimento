import { createHash } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_PER_SHOP_LIMIT = 120;
const DEFAULT_PER_IP_LIMIT = 20;
const DEFAULT_PER_CNPJ_LIMIT = 10;
const DEFAULT_MAX_BUCKETS = 5_000;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function digest(value) {
  return createHash("sha256")
    .update(String(value || "unknown"))
    .digest("base64url")
    .slice(0, 24);
}

function bucketState(buckets, key, now) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    return { count: 0, resetAt: 0 };
  }
  return current;
}

function pruneExpiredBuckets(buckets, now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function trimBuckets(buckets, maxBuckets) {
  while (buckets.size > maxBuckets) {
    buckets.delete(buckets.keys().next().value);
  }
}

export function requestClientIp(request) {
  // O Caddyfile sobrescreve X-Forwarded-For com {http.request.remote.host}
  // (o peer TCP observado pelo proxy), entao o ultimo valor da lista e o
  // unico confiavel: nao pode ser forjado pelo cliente que faz a requisicao.
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const segments = forwardedFor.split(",");
  const address = String(segments[segments.length - 1] || "").trim();

  return isIP(address) ? address : "unknown";
}

export function createPublicCnpjRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  perShopLimit = DEFAULT_PER_SHOP_LIMIT,
  perIpLimit = DEFAULT_PER_IP_LIMIT,
  perCnpjLimit = DEFAULT_PER_CNPJ_LIMIT,
  maxBuckets = DEFAULT_MAX_BUCKETS,
} = {}) {
  const normalizedWindowMs = positiveInteger(windowMs, DEFAULT_WINDOW_MS);
  const limits = {
    shop: positiveInteger(perShopLimit, DEFAULT_PER_SHOP_LIMIT),
    ip: positiveInteger(perIpLimit, DEFAULT_PER_IP_LIMIT),
    cnpj: positiveInteger(perCnpjLimit, DEFAULT_PER_CNPJ_LIMIT),
  };
  const bucketLimit = positiveInteger(maxBuckets, DEFAULT_MAX_BUCKETS);
  const buckets = {
    shop: new Map(),
    ip: new Map(),
    cnpj: new Map(),
  };
  let nextPruneAt = 0;

  return {
    consume({ shop, clientIp, cnpj, now = Date.now() }) {
      if (now >= nextPruneAt) {
        for (const map of Object.values(buckets)) {
          pruneExpiredBuckets(map, now);
        }
        nextPruneAt = now + normalizedWindowMs;
      }

      const normalizedShop = String(shop || "unknown").toLowerCase();
      const descriptors = [
        { dimension: "shop", key: normalizedShop },
        { dimension: "ip", key: `${normalizedShop}:${digest(clientIp)}` },
        { dimension: "cnpj", key: `${normalizedShop}:${digest(cnpj)}` },
      ].map((descriptor) => ({
        ...descriptor,
        state: bucketState(buckets[descriptor.dimension], descriptor.key, now),
        limit: limits[descriptor.dimension],
      }));

      const blocked = descriptors.filter(
        (descriptor) => descriptor.state.count >= descriptor.limit,
      );
      if (blocked.length > 0) {
        return {
          allowed: false,
          limit: Math.min(...blocked.map((descriptor) => descriptor.limit)),
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (Math.max(
                ...blocked.map((descriptor) => descriptor.state.resetAt),
              ) -
                now) /
                1000,
            ),
          ),
        };
      }

      for (const descriptor of descriptors) {
        buckets[descriptor.dimension].set(descriptor.key, {
          count: descriptor.state.count + 1,
          resetAt: descriptor.state.resetAt || now + normalizedWindowMs,
        });
        trimBuckets(buckets[descriptor.dimension], bucketLimit);
      }

      return {
        allowed: true,
        limit: Math.min(...descriptors.map((descriptor) => descriptor.limit)),
        remaining: Math.min(
          ...descriptors.map(
            (descriptor) => descriptor.limit - descriptor.state.count - 1,
          ),
        ),
        retryAfterSeconds: 0,
      };
    },
    reset() {
      for (const map of Object.values(buckets)) {
        map.clear();
      }
      nextPruneAt = 0;
    },
  };
}

export const publicCnpjRateLimiter = createPublicCnpjRateLimiter({
  windowMs: process.env.PUBLIC_CNPJ_RATE_WINDOW_MS,
  perShopLimit: process.env.PUBLIC_CNPJ_RATE_PER_SHOP,
  perIpLimit: process.env.PUBLIC_CNPJ_RATE_PER_IP,
  perCnpjLimit: process.env.PUBLIC_CNPJ_RATE_PER_CNPJ,
});

// Limita tentativas de login do Portal do Revendedor por IP (alem do
// bloqueio por credencial em wholesale-portal-auth.server.js), para que um
// atacante nao contorne o bloqueio por conta so alternando o identificador.
export const wholesalePortalLoginRateLimiter = createPublicCnpjRateLimiter({
  windowMs: process.env.WHOLESALE_LOGIN_RATE_WINDOW_MS,
  perShopLimit: process.env.WHOLESALE_LOGIN_RATE_PER_SHOP,
  perIpLimit: process.env.WHOLESALE_LOGIN_RATE_PER_IP,
  perCnpjLimit: process.env.WHOLESALE_LOGIN_RATE_PER_IDENTIFIER,
});
