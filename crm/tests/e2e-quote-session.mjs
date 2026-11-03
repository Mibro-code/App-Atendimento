// Testes E2E da Fase 2 (lado CRM da integração CRM -> Shopify): geração do
// token de sessão de cotação, RBAC na criação, e resolução service-to-service
// via segredo compartilhado (uso único, expiração, segredo incorreto).
//
// Reaproveita os mesmos helpers de login/HTTP de tests/e2e-rbac.mjs. Requer
// a aplicação rodando (Docker Compose) com o seed aplicado.
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... \
//     CRM_SHOPIFY_SHARED_SECRET=... node tests/e2e-quote-session.mjs
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const SHARED_SECRET = process.env.CRM_SHOPIFY_SHARED_SECRET || "";

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`OK   - ${name}`);
  } else {
    failed++;
    console.log(`FAIL - ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`);
  }
}

function makeCookieJar() {
  const jar = new Map();
  return {
    apply(headers) {
      const parts = [];
      for (const [k, v] of jar) parts.push(`${k}=${v}`);
      if (parts.length) headers.set("cookie", parts.join("; "));
    },
    capture(res) {
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookie) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        jar.set(k, v);
      }
    },
  };
}

async function req(jar, path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  jar.apply(headers);
  const res = await fetch(BASE_URL + path, { ...opts, headers, redirect: "manual" });
  jar.capture(res);
  return res;
}

async function login(email, password) {
  const jar = makeCookieJar();
  const csrfRes = await req(jar, "/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  const body = new URLSearchParams({
    email,
    password,
    csrfToken,
    callbackUrl: BASE_URL + "/dashboard",
    json: "true",
  });

  const res = await req(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const location = res.headers.get("location") || "";
  const failedLogin = location.includes("error=");
  return { jar, ok: (res.status === 302 || res.status === 200) && !failedLogin, status: res.status, location };
}

function extractToken(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get("crm_session");
  } catch {
    return null;
  }
}

async function resolveToken(token, secret) {
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  const res = await fetch(BASE_URL + "/api/integrations/shopify/session/resolve", {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log(`Testando (Fase 2 - quote session) contra ${BASE_URL}\n`);

  if (!SHARED_SECRET) {
    console.log("AVISO: CRM_SHOPIFY_SHARED_SECRET não definido no ambiente do teste — abortando.");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Login do vendedor João (dono de clientes no seed) e da Maria (outro vendedor).
  const sellerLogin = await login("joao.vendedor@mibro.local", "vendedor123");
  ok("Login do vendedor (João) funciona", sellerLogin.ok, sellerLogin);
  const sellerJar = sellerLogin.jar;

  const otherSellerLogin = await login("maria.vendedora@mibro.local", "vendedor123");
  ok("Login do vendedor (Maria) funciona", otherSellerLogin.ok, otherSellerLogin);
  const otherSellerJar = otherSellerLogin.jar;

  // Cria um cliente para o João usar nos testes.
  const cnpj = `2233344400${String(Date.now()).slice(-4)}`;
  const createCustomerRes = await req(sellerJar, "/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contactName: "Cliente Quote Session E2E",
      tradeName: "Empresa Quote Session E2E",
      cnpjDigits: cnpj,
      email: `cliente.quote.e2e.${Date.now()}@example.com`,
      phoneDigits: `1198${String(Date.now()).slice(-7)}`,
      confirmDuplicate: false,
    }),
  });
  const createCustomerBody = await createCustomerRes.json();
  ok("Cliente de teste criado", createCustomerRes.status === 201, createCustomerBody);
  const customerId = createCustomerBody.customer?.id;

  // 1. Vendedor cria sessão de cotação para cliente próprio -> sucesso.
  let createdUrl = null;
  let createdToken = null;
  if (customerId) {
    const res = await req(sellerJar, `/api/customers/${customerId}/quote-session`, { method: "POST" });
    const body = await res.json().catch(() => null);
    createdUrl = body?.url;
    createdToken = createdUrl ? extractToken(createdUrl) : null;
    ok(
      "Vendedor cria sessão de cotação para cliente próprio (sucesso, url contém o token)",
      res.status === 200 && !!createdToken,
      body
    );
  } else {
    ok("Vendedor cria sessão de cotação para cliente próprio (sucesso, url contém o token)", false, "sem customerId");
  }

  // 2. Vendedor tenta criar sessão para cliente de outro vendedor -> bloqueado.
  if (customerId) {
    const res = await req(otherSellerJar, `/api/customers/${customerId}/quote-session`, { method: "POST" });
    ok(
      "Vendedor bloqueado ao criar sessão de cotação para cliente de outro vendedor",
      res.status === 403 || res.status === 404,
      { status: res.status }
    );
  }

  // 3. Resolver com segredo correto -> sucesso, devolve dados esperados.
  let resolvedOnce = false;
  if (createdToken) {
    const { status, body } = await resolveToken(createdToken, SHARED_SECRET);
    resolvedOnce =
      status === 200 &&
      body?.success === true &&
      body?.customer?.id === customerId &&
      body?.customer?.cnpj === cnpj &&
      !!body?.seller?.id;
    ok("Resolver token com segredo correto retorna dados esperados", resolvedOnce, { status, body });
  } else {
    ok("Resolver token com segredo correto retorna dados esperados", false, "sem token");
  }

  // 4. Resolver o MESMO token de novo -> falha (uso único).
  if (createdToken) {
    const { status, body } = await resolveToken(createdToken, SHARED_SECRET);
    ok(
      "Resolver o mesmo token uma segunda vez falha (uso único)",
      status === 409 && body?.success === false,
      { status, body }
    );
  }

  // 5. Resolver com segredo incorreto/ausente -> 401.
  {
    const wrongSecret = await resolveToken(createdToken || "qualquer", "segredo-errado-abc");
    ok("Resolver com segredo incorreto retorna 401", wrongSecret.status === 401, wrongSecret);

    const noSecret = await resolveToken(createdToken || "qualquer", null);
    ok("Resolver sem segredo retorna 401", noSecret.status === 401, noSecret);
  }

  // 6. Resolver um token expirado -> falha. Cria uma nova sessão e força a
  // expiração diretamente no banco (mais simples que esperar o TTL real).
  let expiredCustomerId = customerId;
  if (customerId) {
    const res = await req(sellerJar, `/api/customers/${customerId}/quote-session`, { method: "POST" });
    const body = await res.json().catch(() => null);
    const expiredToken = body?.url ? extractToken(body.url) : null;
    if (expiredToken) {
      // jti não é exposto na resposta HTTP de propósito (token opaco para o
      // frontend do CRM) — decodifica o payload do JWT localmente só para
      // achar o registro no banco (base64url do segundo segmento).
      const payloadB64 = expiredToken.split(".")[1];
      const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
      const jti = JSON.parse(payloadJson).jti;
      await prisma.crmSessionToken.update({
        where: { jti },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const { status, body: resolveBody } = await resolveToken(expiredToken, SHARED_SECRET);
      ok("Resolver token expirado falha", status === 401 && resolveBody?.success === false, {
        status,
        resolveBody,
      });
    } else {
      ok("Resolver token expirado falha", false, "não foi possível gerar token para o teste de expiração");
    }
  }

  // 7. Confirma via Prisma direto que os eventos de auditoria foram gravados.
  if (customerId) {
    const createdLogs = await prisma.auditLog.findMany({
      where: { action: "QUOTE_SESSION_CREATED", entityType: "Customer", entityId: customerId },
    });
    ok("AuditLog registra QUOTE_SESSION_CREATED", createdLogs.length > 0, { count: createdLogs.length });

    const resolvedLogs = await prisma.auditLog.findMany({
      where: { action: "QUOTE_SESSION_RESOLVED", entityType: "Customer", entityId: customerId },
    });
    ok("AuditLog registra QUOTE_SESSION_RESOLVED com actorId nulo (ator externo)", resolvedLogs.length > 0 && resolvedLogs[0].actorId === null, {
      count: resolvedLogs.length,
      actorId: resolvedLogs[0]?.actorId,
    });
  }

  await prisma.$disconnect();

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
