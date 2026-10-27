import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { auth } from "@/auth";
import type { SessionUser } from "@/lib/authz";
import type { CommercialBrand } from "@prisma/client";

/**
 * Helper para rotas de API: garante que existe uma sessão válida.
 * RBAC específico (ex.: admin-only) deve ser checado depois, na própria
 * rota, usando o role retornado aqui — nunca confiar apenas no middleware.
 */
export async function requireSession(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { user: null, error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  // auth() has already revalidated live account, role and credential proof.
  return { user: { id: session.user.id, role: session.user.role }, error: null };
}

export function forbidden(message = "Acesso negado.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

/**
 * Reduz um ZodError para uma mensagem por campo ({ email: "...", cpf: "..." }),
 * pronta para o frontend associar cada erro ao input correspondente — em vez
 * de só um resumo genérico ("Dados inválidos") sem indicar o que corrigir.
 */
export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const flat = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flat)) {
    if (messages && messages.length > 0) result[field] = messages[0];
  }
  return result;
}

/**
 * Resposta de validação com erro por campo. O resumo genérico nunca é a
 * única informação: `fieldErrors` sempre acompanha, para o formulário
 * destacar exatamente o(s) campo(s) problemático(s).
 */
export function validationFailed(fieldErrors: Record<string, string>, message = "Revise os campos destacados.") {
  return NextResponse.json({ error: message, fieldErrors }, { status: 400 });
}

export function notFound(message = "Não encontrado.") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Autenticação service-to-service para endpoints chamados por sistemas
 * externos (ex.: app Shopify), não por sessão de usuário do CRM. Compara o
 * Bearer token do header Authorization contra CRM_SHOPIFY_SHARED_SECRET
 * usando crypto.timingSafeEqual (nunca "===" direto em segredo).
 */
export function requireSharedSecret(
  req: Request,
  envVarName = "CRM_SHOPIFY_SHARED_SECRET"
): { ok: true; error: null } | { ok: false; error: NextResponse } {
  const expected = process.env[envVarName];
  if (!expected) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "SERVER_MISCONFIGURED", message: "Integração não configurada." },
        { status: 500 }
      ),
    };
  }

  const authHeader = req.headers.get("authorization") || "";
  const [scheme, provided] = authHeader.split(" ");
  if (scheme !== "Bearer" || !provided) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "Token de autenticação ausente." },
        { status: 401 }
      ),
    };
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  const matches =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (!matches) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "Token de autenticação inválido." },
        { status: 401 }
      ),
    };
  }

  return { ok: true, error: null };
}

function secretMatches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Identifica com segurança qual app Shopify chamou o CRM. Cada empresa usa
 * um segredo diferente; assim, `brand` nunca é aceito do JSON enviado pelo
 * cliente. O segredo legado continua válido apenas para a Mibro.
 */
export function requireShopifyBrand(
  req: Request
): { ok: true; brand: CommercialBrand; error: null } | { ok: false; error: NextResponse } {
  const mibroSecret = process.env.CRM_SHOPIFY_MIBRO_SHARED_SECRET || process.env.CRM_SHOPIFY_SHARED_SECRET;
  const sincrofitSecret = process.env.CRM_SHOPIFY_SINCROFIT_SHARED_SECRET;

  if (!mibroSecret && !sincrofitSecret) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "SERVER_MISCONFIGURED", message: "Integrações Shopify não configuradas." },
        { status: 500 }
      ),
    };
  }

  const authHeader = req.headers.get("authorization") || "";
  const [scheme, provided] = authHeader.split(" ");
  if (scheme !== "Bearer" || !provided) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "Token de autenticação ausente." },
        { status: 401 }
      ),
    };
  }

  const mibroMatch = secretMatches(provided, mibroSecret);
  const sincrofitMatch = secretMatches(provided, sincrofitSecret);
  if (mibroMatch && sincrofitMatch) {
    return {
      ok: false,
      error: NextResponse.json(
        { success: false, code: "SERVER_MISCONFIGURED", message: "As empresas precisam usar segredos distintos." },
        { status: 500 }
      ),
    };
  }
  if (mibroMatch) return { ok: true, brand: "MIBRO", error: null };
  if (sincrofitMatch) return { ok: true, brand: "SINCROFIT", error: null };

  return {
    ok: false,
    error: NextResponse.json(
      { success: false, code: "UNAUTHORIZED", message: "Token de autenticação inválido." },
      { status: 401 }
    ),
  };
}
