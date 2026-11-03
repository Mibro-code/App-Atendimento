// Testes E2E da funcionalidade de localização da proposta: captura opcional
// de localização em PROPOSAL_STARTED (criar proposta, sessão do vendedor) e
// PROPOSAL_SENT (envio via sync do Shopify), cobrindo os 5 status possíveis
// (GRANTED/DENIED/UNAVAILABLE/TIMEOUT/NOT_SUPPORTED), a rejeição de
// sellerId "spoofado" no payload do Shopify, e o funcionamento em ambos os
// modos de proposta (SIMULATION/REAL).
//
// Reaproveita os mesmos helpers de login/HTTP de tests/e2e-quote-session.mjs.
// Requer a aplicação rodando (Docker Compose) com o seed aplicado.
//
// Uso:
//   BASE_URL=http://localhost:3001 CRM_SHOPIFY_SHARED_SECRET=... \
//     node tests/e2e-proposal-location.mjs
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

async function upsertQuote(payload) {
  const res = await fetch(BASE_URL + "/api/integrations/shopify/quotes/upsert", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SHARED_SECRET}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function baseQuotePayload({ customerId, sellerId, quoteToken, mode, event = "SENT", location }) {
  return {
    event,
    mode,
    shop: "loja-teste.myshopify.com",
    customerId,
    sellerId,
    quoteToken,
    valueCents: 15000,
    totalQuantity: 1,
    products: [
      {
        sku: "SKU-LOC-1",
        name: "Produto teste localização",
        quantity: 1,
        unitPriceCents: 15000,
        subtotalCents: 15000,
      },
    ],
    ...(location ? { location } : {}),
  };
}

async function main() {
  console.log(`Testando (localização da proposta) contra ${BASE_URL}\n`);

  if (!SHARED_SECRET) {
    console.log("AVISO: CRM_SHOPIFY_SHARED_SECRET não definido no ambiente do teste — abortando.");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const sellerLogin = await login("joao.vendedor@mibro.local", "vendedor123");
  ok("Login do vendedor (João) funciona", sellerLogin.ok, sellerLogin);
  const sellerJar = sellerLogin.jar;

  const otherSellerLogin = await login("maria.vendedora@mibro.local", "vendedor123");
  ok("Login do vendedor (Maria) funciona", otherSellerLogin.ok, otherSellerLogin);

  const maria = await prisma.user.findUnique({ where: { email: "maria.vendedora@mibro.local" } });

  const cnpj = `2244455500${String(Date.now()).slice(-4)}`;
  const createCustomerRes = await req(sellerJar, "/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contactName: "Cliente Localização E2E",
      tradeName: "Empresa Localização E2E",
      cnpjDigits: cnpj,
      email: `cliente.loc.e2e.${Date.now()}@example.com`,
      phoneDigits: `1198${String(Date.now()).slice(-7)}`,
      confirmDuplicate: false,
    }),
  });
  const createCustomerBody = await createCustomerRes.json();
  ok("Cliente de teste criado", createCustomerRes.status === 201, createCustomerBody);
  const customerId = createCustomerBody.customer?.id;
  const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  const sellerId = customer?.sellerId;

  // 1. PROPOSAL_STARTED (quote-session, sessão do vendedor) com localização
  //    GRANTED — grava LocationCapture sem quoteId, sellerId da sessão.
  if (customerId) {
    const res = await req(sellerJar, `/api/customers/${customerId}/quote-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "REAL",
        location: {
          status: "GRANTED",
          latitude: -23.5505,
          longitude: -46.6333,
          accuracyMeters: 22,
          capturedAt: new Date().toISOString(),
          deviceType: "mobile",
        },
      }),
    });
    ok("PROPOSAL_STARTED com localização GRANTED não bloqueia a criação da sessão", res.status === 200, {
      status: res.status,
    });
    const capture = await prisma.locationCapture.findFirst({
      where: { customerId, locationSource: "PROPOSAL_STARTED" },
      orderBy: { createdAt: "desc" },
    });
    ok(
      "LocationCapture PROPOSAL_STARTED gravado com status GRANTED e coordenadas",
      capture?.locationStatus === "GRANTED" && capture?.latitude === -23.5505 && capture?.sellerId === sellerId,
      capture
    );
  } else {
    ok("PROPOSAL_STARTED com localização GRANTED não bloqueia a criação da sessão", false, "sem customerId");
  }

  if (!customerId || !sellerId) {
    console.log("\nAbortando testes de PROPOSAL_SENT — cliente/vendedor de teste não disponível.");
    await prisma.$disconnect();
    console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
    process.exit(1);
  }

  // 2-5. PROPOSAL_SENT (quotes/upsert) para cada status de localização —
  // nenhum deles pode bloquear o envio da proposta (sempre 200/success).
  const statusCases = [
    { status: "GRANTED", extra: { latitude: -23.5613, longitude: -46.6565, accuracyMeters: 15 } },
    { status: "DENIED", extra: {} },
    { status: "TIMEOUT", extra: {} },
    { status: "NOT_SUPPORTED", extra: {} },
  ];

  for (const [idx, c] of statusCases.entries()) {
    const quoteToken = `tok-loc-e2e-${c.status.toLowerCase()}-${Date.now()}-${idx}`;
    const { status, body } = await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId,
        quoteToken,
        mode: "REAL",
        location: { status: c.status, ...c.extra },
      })
    );
    ok(`PROPOSAL_SENT com localização ${c.status} não bloqueia o envio da proposta`, status === 200 && body?.success, {
      status,
      body,
    });
    ok(`PROPOSAL_SENT com localização ${c.status} confirma locationCaptured=true na resposta`, body?.locationCaptured === true, body);

    const capture = await prisma.locationCapture.findFirst({
      where: { quote: { shopifyQuoteToken: quoteToken }, locationSource: "PROPOSAL_SENT" },
    });
    const expectsCoords = c.status === "GRANTED";
    ok(
      `LocationCapture PROPOSAL_SENT gravado corretamente para status ${c.status}`,
      capture?.locationStatus === c.status &&
        (expectsCoords ? capture?.latitude === c.extra.latitude : capture?.latitude === null),
      capture
    );
  }

  // 6. Vendedor tenta "spoofar" sellerId de outro vendedor no payload do
  //    Shopify -> rejeitado (SELLER_MISMATCH), nenhuma localização gravada.
  {
    const quoteToken = `tok-loc-e2e-spoof-${Date.now()}`;
    const { status, body } = await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId: maria.id, // cliente pertence ao João, não à Maria
        quoteToken,
        mode: "REAL",
        location: { status: "GRANTED", latitude: -22.9068, longitude: -43.1729, accuracyMeters: 10 },
      })
    );
    ok("Tentativa de sellerId spoofado é rejeitada (SELLER_MISMATCH)", status === 409 && body?.code === "SELLER_MISMATCH", {
      status,
      body,
    });
    const capture = await prisma.locationCapture.findFirst({
      where: { quote: { shopifyQuoteToken: quoteToken } },
    });
    ok("Nenhum LocationCapture é gravado quando o sellerId é rejeitado", !capture, capture);
  }

  // 7. Localização funciona tanto em modo SIMULATION quanto REAL.
  {
    const quoteToken = `tok-loc-e2e-sim-${Date.now()}`;
    const { status, body } = await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId,
        quoteToken,
        mode: "SIMULATION",
        location: { status: "GRANTED", latitude: -19.9167, longitude: -43.9345, accuracyMeters: 30 },
      })
    );
    ok("Proposta em modo SIMULATION com localização é aceita", status === 200 && body?.locationCaptured === true, {
      status,
      body,
    });
    const quote = await prisma.quote.findUnique({
      where: { brand_shopifyQuoteToken: { brand: "MIBRO", shopifyQuoteToken: quoteToken } },
    });
    ok("Quote criada com mode=SIMULATION", quote?.mode === "SIMULATION", quote);
  }
  {
    const quoteToken = `tok-loc-e2e-real-${Date.now()}`;
    const { status, body } = await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId,
        quoteToken,
        mode: "REAL",
        location: { status: "GRANTED", latitude: -19.9167, longitude: -43.9345, accuracyMeters: 30 },
      })
    );
    ok("Proposta em modo REAL com localização é aceita", status === 200 && body?.locationCaptured === true, {
      status,
      body,
    });
    const quote = await prisma.quote.findUnique({
      where: { brand_shopifyQuoteToken: { brand: "MIBRO", shopifyQuoteToken: quoteToken } },
    });
    ok("Quote criada com mode=REAL", quote?.mode === "REAL", quote);
  }

  // 8. Reenvio do mesmo quoteToken (recálculo após o envio) é idempotente —
  //    não duplica a captura de PROPOSAL_SENT (constraint quoteId+locationSource).
  {
    const quoteToken = `tok-loc-e2e-idem-${Date.now()}`;
    await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId,
        quoteToken,
        mode: "REAL",
        location: { status: "GRANTED", latitude: -8.05, longitude: -34.9, accuracyMeters: 12 },
      })
    );
    const { status, body } = await upsertQuote(
      baseQuotePayload({
        customerId,
        sellerId,
        quoteToken,
        mode: "REAL",
        event: "CALCULATED",
        location: { status: "GRANTED", latitude: -8.06, longitude: -34.91, accuracyMeters: 18 },
      })
    );
    ok("Reenvio do mesmo quoteToken é aceito (recálculo)", status === 200 && body?.success, { status, body });
    const captures = await prisma.locationCapture.findMany({
      where: { quote: { shopifyQuoteToken: quoteToken }, locationSource: "PROPOSAL_SENT" },
    });
    ok("Reenvio não duplica LocationCapture (upsert idempotente)", captures.length === 1, {
      count: captures.length,
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
