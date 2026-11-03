import { createHash, randomBytes } from "node:crypto";

import db from "../db.server";
import { wholesalePortalLoginRateLimiter } from "./public-cnpj-policy.server";
import {
  hashWholesalePassword,
  validateWholesalePassword,
  verifyWholesalePassword,
} from "./wholesale-password.server";

const SESSION_HOURS = 8;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export class WholesalePortalAuthError extends Error {
  constructor(message, { code = "WHOLESALE_PORTAL_AUTH_ERROR", status = 401 } = {}) {
    super(message);
    this.name = "WholesalePortalAuthError";
    this.code = code;
    this.status = status;
  }
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeIdentifier(value) {
  const identifier = String(value || "").trim().toLowerCase();
  if (!identifier || identifier.length > 254) {
    throw new WholesalePortalAuthError("Informe seu CNPJ ou e-mail.", {
      code: "WHOLESALE_IDENTIFIER_REQUIRED",
      status: 422,
    });
  }

  return {
    identifier,
    cnpj: identifier.replace(/\D/g, ""),
  };
}

function activeMembershipWhere() {
  return {
    active: true,
    company: { active: true },
  };
}

async function findCandidates(shop, rawIdentifier) {
  const { identifier, cnpj } = normalizeIdentifier(rawIdentifier);
  const isCnpj = cnpj.length === 14;

  return db.wholesaleCustomer.findMany({
    where: {
      shop,
      active: true,
      ...(isCnpj
        ? {
            companies: {
              some: {
                ...activeMembershipWhere(),
                company: { active: true, cnpj },
              },
            },
          }
        : { emailNormalized: identifier }),
    },
    include: {
      credential: true,
      companies: {
        where: activeMembershipWhere(),
        include: { company: true },
        orderBy: { createdAt: "asc" },
      },
    },
    take: 20,
  });
}

async function registerFailure(candidate) {
  if (!candidate?.credential) return;

  const failedAttempts = candidate.credential.failedAttempts + 1;
  const lockedUntil =
    failedAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
      : null;

  await db.wholesaleCredential.update({
    where: { customerId: candidate.id },
    data: {
      failedAttempts: lockedUntil ? 0 : failedAttempts,
      lockedUntil,
    },
  });
}

async function issueSession(customerId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  await db.wholesalePortalSession.create({
    data: { customerId, tokenHash: tokenHash(token), expiresAt },
  });

  return { token, expiresAt };
}

export async function loginWholesalePortal({ shop, identifier, password, clientIp }) {
  const rateLimit = wholesalePortalLoginRateLimiter.consume({
    shop,
    clientIp,
    cnpj: identifier,
  });
  if (!rateLimit.allowed) {
    throw new WholesalePortalAuthError(
      "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
      { code: "WHOLESALE_LOGIN_RATE_LIMITED", status: 429 },
    );
  }

  const candidates = await findCandidates(shop, identifier);
  const now = new Date();
  let matched = null;
  let locked = false;
  const attempted = [];

  for (const candidate of candidates) {
    if (!candidate.credential || candidate.companies.length === 0) continue;
    if (candidate.credential.lockedUntil && candidate.credential.lockedUntil > now) {
      locked = true;
      continue;
    }
    attempted.push(candidate);
    if (await verifyWholesalePassword(String(password || ""), candidate.credential.passwordHash)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    await Promise.all(attempted.map(registerFailure));
    throw new WholesalePortalAuthError(
      locked
        ? "Acesso temporariamente bloqueado. Tente novamente em 15 minutos."
        : "CNPJ/e-mail ou senha incorretos.",
      { code: locked ? "WHOLESALE_LOGIN_LOCKED" : "WHOLESALE_LOGIN_INVALID" },
    );
  }

  await db.wholesaleCredential.update({
    where: { customerId: matched.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  await db.wholesalePortalSession.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { customerId: matched.id, expiresAt: { lte: now } }] },
  });

  const session = await issueSession(matched.id);
  return {
    ...session,
    mustChangePassword: matched.credential.mustChangePassword,
    customer: matched,
  };
}

function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export async function requireWholesalePortalSession(request, shop) {
  const token = bearerToken(request);
  if (!token) {
    throw new WholesalePortalAuthError("Sua sessao expirou. Entre novamente.", {
      code: "WHOLESALE_SESSION_REQUIRED",
    });
  }

  const session = await db.wholesalePortalSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      customer: {
        include: {
          credential: true,
          companies: {
            where: activeMembershipWhere(),
            include: { company: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (
    !session ||
    session.expiresAt <= new Date() ||
    !session.customer.active ||
    session.customer.shop !== shop ||
    session.customer.companies.length === 0
  ) {
    if (session) await db.wholesalePortalSession.delete({ where: { id: session.id } });
    throw new WholesalePortalAuthError("Sua sessao expirou. Entre novamente.", {
      code: "WHOLESALE_SESSION_EXPIRED",
    });
  }

  await db.wholesalePortalSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    token,
    session,
    customer: session.customer,
    memberships: session.customer.companies,
    companyIds: session.customer.companies.map(({ companyId }) => companyId),
  };
}

export async function changeWholesalePortalPassword({ request, shop, newPassword }) {
  const context = await requireWholesalePortalSession(request, shop);
  validateWholesalePassword(newPassword);
  const passwordHash = await hashWholesalePassword(newPassword);

  await db.$transaction([
    db.wholesaleCredential.update({
      where: { customerId: context.customer.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
    db.wholesalePortalSession.deleteMany({
      where: {
        customerId: context.customer.id,
        tokenHash: { not: tokenHash(context.token) },
      },
    }),
  ]);

  return context;
}

export async function logoutWholesalePortal(request, shop) {
  try {
    const { session } = await requireWholesalePortalSession(request, shop);
    await db.wholesalePortalSession.delete({ where: { id: session.id } });
  } catch (error) {
    if (!(error instanceof WholesalePortalAuthError)) throw error;
  }
}
