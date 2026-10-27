import "server-only";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { CommercialBrand, ProposalMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { QUOTE_SESSION_TTL_MINUTES } from "@/lib/config";

// Fase 2 — Integração CRM → Shopify (lado CRM).
//
// Gera e resolve o token de sessão de cotação: um JWT curto, assinado com
// HS256 e de uso único, que o CRM entrega ao usuário (via querystring, na
// nova aba aberta para o app Shopify) e que o app Shopify troca por dados de
// cliente/vendedor chamando POST /api/integrations/shopify/session/resolve.
//
// Regra explícita do dono do produto: o token NUNCA carrega CNPJ, e-mail,
// telefone ou qualquer outro dado pessoal — só ids internos (customerId,
// sellerId, jti). Os dados pessoais só saem do CRM no momento em que o app
// Shopify resolve o token pelo endpoint service-to-service, autenticado pelo
// segredo compartilhado.

function getSecretKey(brand: CommercialBrand): Uint8Array {
  const secret = brand === "SINCROFIT"
    ? process.env.CRM_SHOPIFY_SINCROFIT_SHARED_SECRET
    : process.env.CRM_SHOPIFY_MIBRO_SHARED_SECRET || process.env.CRM_SHOPIFY_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      `Segredo Shopify da empresa ${brand} não está definido. Configure essa variável de ambiente ` +
        "(veja .env.example) antes de gerar/resolver tokens de sessão de cotação."
    );
  }
  return new TextEncoder().encode(secret);
}

interface CreateQuoteSessionTokenInput {
  brand: CommercialBrand;
  customerId: string;
  sellerId: string;
  createdById: string;
  mode: ProposalMode;
  // Preenchido para "abrir novamente na calculadora" (mesma proposta) ou
  // para "transformar em cotação real" (aponta para a SIMULATION de
  // origem). Nunca aceito cegamente do frontend sem validar antes que a
  // Quote pertence ao mesmo cliente (ver rota que chama esta função).
  resumeQuoteId?: string | null;
}

interface CreateQuoteSessionTokenResult {
  token: string;
  expiresAt: Date;
}

/**
 * Cria o registro CrmSessionToken (não usado) e retorna o JWT assinado
 * correspondente. Chamado por POST /api/customers/[id]/quote-session.
 *
 * O modo (SIMULATION/REAL) e o resumeQuoteId ficam gravados no banco e são
 * devolvidos ao app Shopify só quando ele resolve o token pelo endpoint
 * service-to-service — nunca embutidos de forma legível/editável na URL.
 */
export async function createQuoteSessionToken(
  input: CreateQuoteSessionTokenInput
): Promise<CreateQuoteSessionTokenResult> {
  const jti = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_SESSION_TTL_MINUTES * 60_000);

  await prisma.crmSessionToken.create({
    data: {
      jti,
      customerId: input.customerId,
      sellerId: input.sellerId,
      createdById: input.createdById,
      mode: input.mode,
      brand: input.brand,
      resumeQuoteId: input.resumeQuoteId ?? null,
      expiresAt,
    },
  });

  const token = await new SignJWT({ sellerId: input.sellerId, brand: input.brand })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.customerId)
    .setJti(jti)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSecretKey(input.brand));

  return { token, expiresAt };
}

export type ResolveQuoteSessionErrorCode =
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "TOKEN_ALREADY_USED"
  | "TOKEN_NOT_FOUND"
  | "BRAND_MISMATCH"
  | "QUOTE_DELETED"
  | "CUSTOMER_OR_SELLER_NOT_FOUND";

export class ResolveQuoteSessionError extends Error {
  code: ResolveQuoteSessionErrorCode;
  constructor(code: ResolveQuoteSessionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ResolveQuoteSessionError";
  }
}

export interface ResolvedQuoteSession {
  brand: CommercialBrand;
  mode: "simulation" | "real";
  customer: {
    id: string;
    contactName: string;
    legalName: string | null;
    tradeName: string | null;
    cnpj: string | null;
    cpf: string | null;
    email: string | null;
    phone: string | null;
  };
  seller: {
    id: string;
    name: string;
  };
  // Presente só quando a sessão foi criada para reabrir/converter uma
  // proposta existente. products vem do snapshot salvo (productsSummary),
  // nunca recalculado — a calculadora Shopify deve tratar isso como
  // sugestão de mix a restaurar (por SKU/variant id), não como valores
  // finais já confirmados.
  resumeQuote: {
    id: string;
    mode: "simulation" | "real";
    quoteToken: string | null;
    couponCode: string | null;
    notes: string | null;
    products: unknown;
  } | null;
}

/**
 * Verifica a assinatura/expiração do JWT, confirma no banco que o
 * CrmSessionToken correspondente existe, não expirou (defesa em
 * profundidade — não confia só na expiração do JWT) e ainda não foi usado, e
 * marca o uso de forma atômica (updateMany com usedAt: null, checando
 * count === 1) para evitar corrida em uso duplicado simultâneo.
 *
 * Chamado por POST /api/integrations/shopify/session/resolve.
 */
export async function resolveQuoteSessionToken(
  rawToken: string,
  expectedBrand: CommercialBrand
): Promise<ResolvedQuoteSession> {
  let payload;
  try {
    const result = await jwtVerify(rawToken, getSecretKey(expectedBrand));
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new ResolveQuoteSessionError("TOKEN_EXPIRED", "Token de sessão de cotação expirado.");
    }
    throw new ResolveQuoteSessionError("INVALID_TOKEN", "Token de sessão de cotação inválido.");
  }

  const jti = payload.jti;
  if (!jti || typeof jti !== "string") {
    throw new ResolveQuoteSessionError("INVALID_TOKEN", "Token de sessão de cotação inválido.");
  }

  const record = await prisma.crmSessionToken.findUnique({ where: { jti } });
  if (!record) {
    throw new ResolveQuoteSessionError("TOKEN_NOT_FOUND", "Token de sessão de cotação não encontrado.");
  }
  if (record.usedAt) {
    throw new ResolveQuoteSessionError("TOKEN_ALREADY_USED", "Token de sessão de cotação já foi utilizado.");
  }
  if (record.brand !== expectedBrand || payload.brand !== expectedBrand) {
    throw new ResolveQuoteSessionError("BRAND_MISMATCH", "O token pertence a outra empresa.");
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new ResolveQuoteSessionError("TOKEN_EXPIRED", "Token de sessão de cotação expirado.");
  }

  // Marca o uso de forma atômica: só uma chamada concorrente consegue passar
  // de usedAt: null -> now(); as demais recebem count === 0.
  const { count } = await prisma.crmSessionToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count !== 1) {
    throw new ResolveQuoteSessionError("TOKEN_ALREADY_USED", "Token de sessão de cotação já foi utilizado.");
  }

  const [customer, seller, resumeQuote] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: record.customerId },
      select: {
        id: true,
        contactName: true,
        legalName: true,
        tradeName: true,
        cnpjDigits: true,
        cpfDigits: true,
        email: true,
        phoneDigits: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: record.sellerId },
      select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
    }),
    record.resumeQuoteId
      ? prisma.quote.findUnique({
          where: { id: record.resumeQuoteId, deletedAt: null },
          select: {
            id: true,
            mode: true,
            shopifyQuoteToken: true,
            couponCode: true,
            notes: true,
            productsSummary: true,
            customerId: true,
            brand: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (record.resumeQuoteId && !resumeQuote) {
    throw new ResolveQuoteSessionError("QUOTE_DELETED", "A simulação foi excluída e não pode ser reaberta.");
  }
  if (!customer || !seller) {
    throw new ResolveQuoteSessionError(
      "CUSTOMER_OR_SELLER_NOT_FOUND",
      "Cliente ou vendedor associado ao token não foi encontrado."
    );
  }

  return {
    brand: record.brand,
    mode: record.mode === "SIMULATION" ? "simulation" : "real",
    customer: {
      id: customer.id,
      contactName: customer.contactName,
      legalName: customer.legalName,
      tradeName: customer.tradeName,
      cnpj: customer.cnpjDigits,
      cpf: customer.cpfDigits,
      email: customer.email,
      phone: customer.phoneDigits,
    },
    seller: {
      id: seller.id,
      // SellerProfile.displayName é o nome comercial "de verdade"; User.name
      // é só o fallback mínimo (ver comentário no schema).
      name: seller.sellerProfile?.displayName ?? seller.name,
    },
    // resumeQuote.customerId já foi implicitamente validado na criação da
    // sessão (ver rota quote-session, que checa customerId === resumeQuote.customerId).
    resumeQuote:
      resumeQuote && resumeQuote.customerId === record.customerId && resumeQuote.brand === record.brand
        ? {
            id: resumeQuote.id,
            mode: resumeQuote.mode === "SIMULATION" ? "simulation" : "real",
            quoteToken: resumeQuote.shopifyQuoteToken,
            couponCode: resumeQuote.couponCode,
            notes: resumeQuote.notes,
            products: resumeQuote.productsSummary,
          }
        : null,
  };
}
