// Testes E2E cobrindo a separação User/SellerProfile e o mapa comercial do
// admin (/admin/mapa): criação de vendedor já cria SellerProfile, edição de
// /perfil grava em SellerProfile sem quebrar login, RBAC de backend em
// /admin/mapa e na API que o alimenta, e que o admin realmente enxerga
// capturas de localização de qualquer vendedor.
//
// Reaproveita os mesmos helpers de login/HTTP dos outros scripts e2e deste
// projeto. Requer a aplicação rodando (Docker Compose) com o seed aplicado.
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... node tests/e2e-seller-profile-mapa.mjs
import { PrismaClient } from "@prisma/client";

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
  console.log(`Testando (SellerProfile + mapa comercial) contra ${BASE_URL}\n`);

  const prisma = new PrismaClient();

  const adminLogin = await login("admin@mibro.local", process.env.SEED_ADMIN_PASSWORD || "");
  ok("Login do admin funciona", adminLogin.ok, adminLogin);
  const adminJar = adminLogin.jar;

  // 1. Criação de vendedor pelo admin já cria o SellerProfile correspondente.
  const newSellerEmail = `teste.sellerprofile.${Date.now()}@mibro.local`;
  const createRes = await req(adminJar, "/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Vendedor SellerProfile E2E",
      email: newSellerEmail,
      password: "senhaTeste123",
      role: "VENDEDOR",
      jobTitle: "Consultor Comercial",
      phone: "11999990000",
    }),
  });
  const createBody = await createRes.json();
  ok("Criação de vendedor pelo admin funciona", createRes.status === 201, createBody);
  const newSellerId = createBody.user?.id;

  let profileCreatedOk = false;
  if (newSellerId) {
    const profile = await prisma.sellerProfile.findUnique({ where: { userId: newSellerId } });
    profileCreatedOk =
      !!profile && profile.displayName === "Vendedor SellerProfile E2E" && profile.jobTitle === "Consultor Comercial";
  }
  ok("Criação de vendedor já cria SellerProfile (displayName + jobTitle)", profileCreatedOk);

  // 2. Edição de /perfil (autoedição) grava em SellerProfile e não quebra o
  // login/sessão do próprio usuário.
  const sellerLogin = await login(newSellerEmail, "senhaTeste123");
  ok("Login do vendedor recém-criado funciona", sellerLogin.ok, sellerLogin);
  const sellerJar = sellerLogin.jar;

  const profilePatchRes = await req(sellerJar, "/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "11988887777", whatsapp: "11988887777" }),
  });
  const profilePatchBody = await profilePatchRes.json();
  ok(
    "PATCH /api/profile grava dados em SellerProfile",
    profilePatchRes.status === 200 && profilePatchBody.user?.sellerProfile?.phone === "11988887777",
    profilePatchBody
  );

  // Confere que a sessão do vendedor continua válida após a edição (não
  // quebrou login) — consegue acessar uma rota autenticada normalmente.
  const dashboardAfterEdit = await req(sellerJar, "/dashboard");
  ok(
    "Sessão do vendedor continua válida após editar /perfil",
    dashboardAfterEdit.status === 200,
    { status: dashboardAfterEdit.status }
  );

  let profileGetOk = false;
  if (newSellerId) {
    const profileRow = await prisma.sellerProfile.findUnique({ where: { userId: newSellerId } });
    profileGetOk = profileRow?.phone === "11988887777";
  }
  ok("Dado gravado por /api/profile persiste no SellerProfile", profileGetOk);

  // Cargo é definido pelo admin na criação/edição do vendedor
  // (/api/users/[id]) e não é mais autoeditável — /api/profile ignora
  // silenciosamente um jobTitle enviado, sem quebrar a requisição.
  const profilePatchWithJobTitleRes = await req(sellerJar, "/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "11988887777", jobTitle: "Tentativa de autoedição" }),
  });
  let jobTitleIgnoredOk = false;
  if (newSellerId) {
    const profileRow = await prisma.sellerProfile.findUnique({ where: { userId: newSellerId } });
    jobTitleIgnoredOk = profilePatchWithJobTitleRes.status === 200 && profileRow?.jobTitle === "Consultor Comercial";
  }
  ok("Cargo enviado por /api/profile é ignorado (só admin define cargo)", jobTitleIgnoredOk);

  // 3. Vendedor comum não acessa /admin/mapa nem a API por trás dela
  // (bloqueado no backend, não só escondido no menu).
  const mapaPageAsSeller = await req(sellerJar, "/admin/mapa");
  ok(
    "Vendedor é redirecionado ao acessar /admin/mapa (backend, via AdminLayout)",
    mapaPageAsSeller.status === 307 || mapaPageAsSeller.status === 302,
    { status: mapaPageAsSeller.status }
  );

  const mapaApiAsSeller = await req(sellerJar, "/api/admin/location-captures");
  ok(
    "Vendedor bloqueado em /api/admin/location-captures (403)",
    mapaApiAsSeller.status === 403,
    { status: mapaApiAsSeller.status }
  );

  // 4. Admin consegue acessar o mapa e ver capturas de localização de
  // qualquer vendedor (usa os dados de exemplo do seed, que incluem visitas
  // com localização concedida para joão/maria).
  const mapaApiAsAdmin = await req(adminJar, "/api/admin/location-captures?from=2000-01-01&to=2100-01-01");
  const mapaApiBody = await mapaApiAsAdmin.json();
  ok(
    "Admin acessa /api/admin/location-captures com sucesso",
    mapaApiAsAdmin.status === 200 && Array.isArray(mapaApiBody.points),
    { status: mapaApiAsAdmin.status }
  );

  const sellerIdsInPoints = new Set((mapaApiBody.points || []).map((p) => p.seller.id));
  const joao = await prisma.user.findUnique({ where: { email: "joao.vendedor@mibro.local" } });
  const maria = await prisma.user.findUnique({ where: { email: "maria.vendedora@mibro.local" } });
  ok(
    "Admin enxerga capturas de localização de mais de um vendedor (João e Maria, dados do seed)",
    !!joao && !!maria && sellerIdsInPoints.has(joao.id) && sellerIdsInPoints.has(maria.id),
    { sellerIdsInPoints: Array.from(sellerIdsInPoints), joaoId: joao?.id, mariaId: maria?.id }
  );

  const mapaPageAsAdmin = await req(adminJar, "/admin/mapa");
  ok("Admin acessa a página /admin/mapa (200)", mapaPageAsAdmin.status === 200, {
    status: mapaPageAsAdmin.status,
  });

  // 5. Registro de atividade tipo VISITA com locationAttempt grava o
  // LocationCapture correspondente (mesma ação/clique, cobrindo os quatro
  // desfechos possíveis: aqui testamos GRANTED e DENIED).
  const customer = await prisma.customer.findFirst({ where: { sellerId: joao.id } });
  if (customer) {
    const joaoLogin = await login("joao.vendedor@mibro.local", "vendedor123");
    const joaoJar = joaoLogin.jar;

    const grantedRes = await req(joaoJar, `/api/customers/${customer.id}/activities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "VISITA",
        description: "Visita E2E com localização concedida.",
        locationAttempt: {
          status: "GRANTED",
          latitude: -23.55,
          longitude: -46.63,
          accuracyMeters: 15,
          userAgentSummary: "Chrome 128 / Android",
          deviceType: "mobile",
        },
      }),
    });
    const grantedBody = await grantedRes.json();
    let grantedCaptureOk = false;
    if (grantedRes.status === 201 && grantedBody.activity?.id) {
      const capture = await prisma.locationCapture.findUnique({
        where: { activityId: grantedBody.activity.id },
      });
      grantedCaptureOk = capture?.locationStatus === "GRANTED" && capture.latitude === -23.55;
    }
    ok("Atividade VISITA com localização concedida cria LocationCapture (GRANTED)", grantedCaptureOk, grantedBody);

    const deniedRes = await req(joaoJar, `/api/customers/${customer.id}/activities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "VISITA",
        description: "Visita E2E com localização negada.",
        locationAttempt: {
          status: "DENIED",
          userAgentSummary: "Chrome 128 / Android",
          deviceType: "mobile",
        },
      }),
    });
    const deniedBody = await deniedRes.json();
    let deniedCaptureOk = false;
    if (deniedRes.status === 201 && deniedBody.activity?.id) {
      const capture = await prisma.locationCapture.findUnique({
        where: { activityId: deniedBody.activity.id },
      });
      deniedCaptureOk = capture?.locationStatus === "DENIED" && capture.latitude === null;
    }
    ok(
      "Atividade VISITA com localização negada também cria LocationCapture (DENIED, sem coordenadas)",
      deniedCaptureOk,
      deniedBody
    );
  } else {
    ok("Atividade VISITA com localização concedida cria LocationCapture (GRANTED)", false, "sem cliente de teste");
    ok(
      "Atividade VISITA com localização negada também cria LocationCapture (DENIED, sem coordenadas)",
      false,
      "sem cliente de teste"
    );
  }

  // 6. ADMIN sem SellerProfile (admin do seed) não quebra nenhuma tela —
  // acessa o próprio /perfil normalmente.
  const adminProfileRes = await req(adminJar, "/api/profile");
  const adminProfileBody = await adminProfileRes.json();
  ok(
    "Admin sem SellerProfile acessa /api/profile sem erro (sellerProfile null é válido)",
    adminProfileRes.status === 200 && adminProfileBody.user?.sellerProfile === null,
    adminProfileBody
  );

  await prisma.$disconnect();

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
