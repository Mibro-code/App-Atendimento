// Testes E2E das métricas do Painel (Dashboard) — casos A a E do plano de
// correção "SIMULATION nunca conta como REAL/venda". Cria fixtures reais via
// API (mesmo caminho que o app Shopify usa) e lê o HTML renderizado de
// /dashboard, checando o DELTA de cada card antes/depois de cada evento —
// isso evita depender do estado pré-existente do banco (outros dados de
// teste podem já estar lá) e testa a pilha completa (query -> render).
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... \
//     CRM_SHOPIFY_SHARED_SECRET=... node tests/e2e-dashboard-metrics.mjs
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const SHARED_SECRET = process.env.CRM_SHOPIFY_SHARED_SECRET || "";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "";

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`OK   - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`); }
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
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
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
    email, password, csrfToken, callbackUrl: BASE_URL + "/dashboard", json: "true",
  });
  const res = await req(jar, "/api/auth/callback/credentials", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const location = res.headers.get("location") || "";
  return { jar, ok: (res.status === 302 || res.status === 200) && !location.includes("error=") };
}

function extractToken(url) {
  try { return new URL(url).searchParams.get("crm_session"); } catch { return null; }
}

function extractCard(html, label) {
  const idx = html.indexOf(label);
  if (idx === -1) return null;
  const after = html.slice(idx, idx + 400);
  const m = after.match(/<p class="text-2xl[^"]*">([^<]*)<\/p>/);
  return m ? Number(m[1].trim().replace(/\D/g, "")) : null;
}

async function readCards(jar) {
  const res = await req(jar, "/dashboard");
  const html = await res.text();
  return {
    abertas: extractCard(html, "Cotações abertas"),
    simulacoes: extractCard(html, "Simulações enviadas"),
    reais: extractCard(html, "Cotações reais"),
    vendas: extractCard(html, "Vendas confirmadas"),
  };
}

async function upsertQuote({ event, mode, customerId, sellerId, quoteToken, valueCents, olistOrder }) {
  const res = await fetch(BASE_URL + "/api/integrations/shopify/quotes/upsert", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SHARED_SECRET}` },
    body: JSON.stringify({
      event, mode, customerId, sellerId, quoteToken, valueCents,
      products: [{ sku: "SKU-METRICS", name: "Produto Métricas", quantity: 1, unitPriceCents: valueCents, subtotalCents: valueCents }],
      ...(olistOrder ? { olistOrder } : {}),
    }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log(`Testando métricas do Painel contra ${BASE_URL}\n`);
  if (!SHARED_SECRET || !ADMIN_PASSWORD) {
    console.log("AVISO: CRM_SHOPIFY_SHARED_SECRET/SEED_ADMIN_PASSWORD não definidos — abortando.");
    process.exit(1);
  }

  const adminLogin = await login("admin@mibro.local", ADMIN_PASSWORD);
  ok("Login do admin funciona", adminLogin.ok, adminLogin);
  const jar = adminLogin.jar;

  const prisma = new PrismaClient();
  const suffix = Date.now();
  const createRes = await req(jar, "/api/customers", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contactName: "Cliente Metricas E2E", tradeName: "Empresa Metricas E2E",
      cnpjDigits: `2299${String(suffix).slice(-10)}`,
      email: `metricas.e2e.${suffix}@example.com`,
      phoneDigits: `1199${String(suffix).slice(-7)}`,
      confirmDuplicate: true,
    }),
  });
  const createBody = await createRes.json();
  ok("Cliente de teste criado", createRes.status === 201, createBody);
  const customerId = createBody.customer?.id;
  const sellerId = createBody.customer?.sellerId;

  // Caso A: SIMULATION + CALCULATED -> nenhum dos dois cards de cotação sobe.
  {
    const before = await readCards(jar);
    const result = await upsertQuote({
      event: "CALCULATED", mode: "SIMULATION", customerId, sellerId,
      quoteToken: `metrics-a-${suffix}`, valueCents: 100000,
    });
    ok("Caso A: upsert SIMULATION/CALCULATED aceito", result.status === 200, result);
    const after = await readCards(jar);
    ok("Caso A: Cotações reais NÃO aumenta", after.reais === before.reais, { before, after });
    ok("Caso A: Simulações enviadas NÃO aumenta", after.simulacoes === before.simulacoes, { before, after });
  }

  // Caso B: SIMULATION + SENT -> Simulações enviadas +1, Cotações reais intocado.
  let beforeB;
  {
    beforeB = await readCards(jar);
    const result = await upsertQuote({
      event: "SENT", mode: "SIMULATION", customerId, sellerId,
      quoteToken: `metrics-a-${suffix}`, valueCents: 100000,
    });
    ok("Caso B: upsert SIMULATION/SENT aceito", result.status === 200 && result.body?.quote?.status === "ENVIADA", result);
    const after = await readCards(jar);
    ok("Caso B: Cotações reais NÃO aumenta", after.reais === beforeB.reais, { beforeB, after });
    ok("Caso B: Simulações enviadas +1", after.simulacoes === beforeB.simulacoes + 1, { beforeB, after });
  }

  // Caso C: REAL + CALCULATED -> Cotações reais +1, Vendas confirmadas intocado.
  let beforeC;
  {
    beforeC = await readCards(jar);
    const result = await upsertQuote({
      event: "CALCULATED", mode: "REAL", customerId, sellerId,
      quoteToken: `metrics-c-${suffix}`, valueCents: 200000,
    });
    ok("Caso C: upsert REAL/CALCULATED aceito", result.status === 200, result);
    const after = await readCards(jar);
    ok("Caso C: Cotações reais +1", after.reais === beforeC.reais + 1, { beforeC, after });
    ok("Caso C: Vendas confirmadas NÃO aumenta", after.vendas === beforeC.vendas, { beforeC, after });
  }

  // Caso D: REAL + SENT (mesma cotação) -> continua contando só 1x em Cotações reais.
  {
    const before = await readCards(jar);
    const result = await upsertQuote({
      event: "SENT", mode: "REAL", customerId, sellerId,
      quoteToken: `metrics-c-${suffix}`, valueCents: 200000, olistOrder: null,
    });
    ok("Caso D: upsert REAL/SENT aceito", result.status === 200, result);
    const after = await readCards(jar);
    ok("Caso D: Cotações reais mantém (mesma cotação, não duplica)", after.reais === before.reais, { before, after });
    ok("Caso D: Vendas confirmadas NÃO aumenta", after.vendas === before.vendas, { before, after });
  }

  // Caso E: venda REAL confirmada -> Vendas confirmadas +1, valor vendido aumenta.
  // Cotações reais não deveria aumentar de novo por causa disso (a venda é
  // registrada num model separado, Sale, nunca derivada de Quote).
  {
    const before = await readCards(jar);
    const seller = await prisma.user.findUnique({ where: { id: sellerId } });
    const sale = await prisma.sale.create({
      data: {
        customerId, sellerId, stage: "PAGAMENTO_CONFIRMADO", valueCents: 200000, confirmedAt: new Date(),
      },
    });
    ok("Caso E: venda criada no banco", Boolean(sale.id), { sellerFound: Boolean(seller) });
    const after = await readCards(jar);
    ok("Caso E: Cotações reais mantém (Sale não é Quote)", after.reais === before.reais, { before, after });
    ok("Caso E: Vendas confirmadas +1", after.vendas === before.vendas + 1, { before, after });
  }

  // Limpeza dos dados criados neste teste.
  await prisma.sale.deleteMany({ where: { customerId } });
  await prisma.olistOrder.deleteMany({ where: { customerId } });
  await prisma.crmSessionToken.deleteMany({ where: { customerId } });
  await prisma.quote.deleteMany({ where: { customerId } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
