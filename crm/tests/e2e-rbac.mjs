// Testes E2E (ponta a ponta) contra a API HTTP do CRM, exercitando o fluxo
// completo de autenticação (cookies httpOnly do NextAuth) e as regras de
// negócio obrigatórias: login, RBAC, duplicidade de cliente e histórico de
// status. Requer a aplicação rodando (Docker Compose ou "npm run dev") e o
// banco com o seed aplicado.
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... node tests/e2e-rbac.mjs
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

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

async function main() {
  console.log(`Testando contra ${BASE_URL}\n`);

  // 1. Login do admin funciona
  const adminLogin = await login("admin@mibro.local", process.env.SEED_ADMIN_PASSWORD || "");
  ok("Login do admin funciona", adminLogin.ok, adminLogin);
  const adminJar = adminLogin.jar;

  // 2. Criação de vendedor pelo admin funciona
  const newSellerEmail = `teste.vendedor.${Date.now()}@mibro.local`;
  const createSellerRes = await req(adminJar, "/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Vendedor Teste E2E",
      email: newSellerEmail,
      password: "senhaTeste123",
      role: "VENDEDOR",
    }),
  });
  const createSellerBody = await createSellerRes.json();
  ok("Criação de vendedor pelo admin funciona", createSellerRes.status === 201, createSellerBody);

  // 3. Login do vendedor (novo) funciona
  const sellerLogin = await login(newSellerEmail, "senhaTeste123");
  ok("Login do vendedor funciona", sellerLogin.ok, sellerLogin);
  const sellerJar = sellerLogin.jar;

  // 4. Vendedor não consegue acessar rotas /admin/* (bloqueado no backend)
  const adminUsersAsSeller = await req(sellerJar, "/api/users");
  ok("Vendedor bloqueado em /api/users (admin-only)", adminUsersAsSeller.status === 403, {
    status: adminUsersAsSeller.status,
  });

  const adminPageAsSeller = await req(sellerJar, "/admin");
  ok(
    "Vendedor é redirecionado ao acessar /admin (middleware + layout)",
    adminPageAsSeller.status === 307 || adminPageAsSeller.status === 302,
    { status: adminPageAsSeller.status, location: adminPageAsSeller.headers.get("location") }
  );

  // 5. Cadastro de cliente funciona
  const cnpj = `1122233300${String(Date.now()).slice(-4)}`;
  const createCustomerRes = await req(sellerJar, "/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contactName: "Cliente Teste E2E",
      tradeName: "Empresa Teste E2E",
      cnpjDigits: cnpj,
      email: `cliente.teste.e2e.${Date.now()}@example.com`,
      phoneDigits: `1199${String(Date.now()).slice(-7)}`,
      confirmDuplicate: false,
    }),
  });
  const createCustomerBody = await createCustomerRes.json();
  ok("Cadastro de cliente funciona", createCustomerRes.status === 201, createCustomerBody);
  const customerId = createCustomerBody.customer?.id;

  // 6. Tentativa de cadastrar cliente duplicado (mesmo CNPJ) é sinalizada
  const dupRes = await req(sellerJar, "/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contactName: "Cliente Duplicado E2E",
      cnpjDigits: cnpj,
      confirmDuplicate: false,
    }),
  });
  const dupBody = await dupRes.json();
  ok(
    "Cliente duplicado (mesmo CNPJ) é sinalizado (409 + possibleDuplicates)",
    dupRes.status === 409 && Array.isArray(dupBody.possibleDuplicates) && dupBody.possibleDuplicates.length > 0,
    dupBody
  );

  // 7. Alteração de status/temperatura gera entrada em CustomerStatusHistory
  let historyOk = false;
  if (customerId) {
    const statusRes = await req(sellerJar, `/api/customers/${customerId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CONTATO_REALIZADO", temperature: "QUENTE" }),
    });
    await statusRes.json();

    const detailRes = await req(sellerJar, `/api/customers/${customerId}`);
    const detailBody = await detailRes.json();
    historyOk =
      detailRes.status === 200 &&
      Array.isArray(detailBody.customer?.statusHistory) &&
      detailBody.customer.statusHistory.some((h) => h.field === "STATUS" && h.newValue === "CONTATO_REALIZADO") &&
      detailBody.customer.statusHistory.some((h) => h.field === "TEMPERATURE" && h.newValue === "QUENTE");
  }
  ok("Alteração de status/temperatura gera CustomerStatusHistory", historyOk);

  // 8. Registro de atividade funciona e aparece na timeline
  let activityOk = false;
  if (customerId) {
    const actRes = await req(sellerJar, `/api/customers/${customerId}/activities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "WHATSAPP", description: "Contato de teste E2E via WhatsApp." }),
    });
    const actBody = await actRes.json();

    const listRes = await req(sellerJar, `/api/customers/${customerId}/activities`);
    const listBody = await listRes.json();
    activityOk =
      actRes.status === 201 &&
      Array.isArray(listBody.activities) &&
      listBody.activities.some((a) => a.id === actBody.activity?.id);
  }
  ok("Registro de atividade funciona e aparece na timeline", activityOk);

  // 9. Vendedor A não consegue ver/acessar cliente de Vendedor B via API
  const seller2Login = await login("maria.vendedora@mibro.local", "vendedor123");
  let crossSellerBlocked = false;
  if (seller2Login.ok && customerId) {
    const crossRes = await req(seller2Login.jar, `/api/customers/${customerId}`);
    crossSellerBlocked = crossRes.status === 403 || crossRes.status === 404;
  }
  ok("Vendedor A não acessa cliente de Vendedor B via API", seller2Login.ok && crossSellerBlocked, {
    seller2LoginOk: seller2Login.ok,
  });

  // 10. Admin consegue ver clientes de todos os vendedores
  const adminCustomersRes = await req(adminJar, "/api/customers");
  const adminCustomersBody = await adminCustomersRes.json();
  const adminSeesNewCustomer =
    adminCustomersRes.status === 200 &&
    Array.isArray(adminCustomersBody.customers) &&
    adminCustomersBody.customers.some((c) => c.id === customerId);
  ok("Admin consegue ver clientes de todos os vendedores", adminSeesNewCustomer);

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
