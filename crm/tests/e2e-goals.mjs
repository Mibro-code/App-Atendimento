// Testes E2E do sistema de METAS (valor/quantidade, progresso, alertas de
// prazo, atingimento e RBAC entre equipes). Mesma abordagem dos outros
// scripts em tests/e2e-*.mjs: cria fixtures reais via API (login de sessão
// de verdade, não chamada direta às libs "server-only") e via PrismaClient
// para simular passagem de tempo/vendas confirmadas, e limpa tudo no final.
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... \
//     node tests/e2e-goals.mjs
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
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

async function createUser(adminJar, { name, email, role, supervisorId }) {
  const res = await req(adminJar, "/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, role, supervisorId: supervisorId || null, password: "Senha12345!" }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function createGoal(jar, payload) {
  const res = await req(jar, "/api/goals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function listGoals(jar, sellerId) {
  const res = await req(jar, `/api/goals?sellerId=${sellerId}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log(`Testando sistema de metas contra ${BASE_URL}\n`);
  if (!ADMIN_PASSWORD) {
    console.log("AVISO: SEED_ADMIN_PASSWORD não definido — abortando.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const suffix = Date.now();
  const cleanupUserIds = [];
  const cleanupCustomerIds = [];
  const cleanupGoalIds = [];

  try {
    const adminLogin = await login("admin@mibro.local", ADMIN_PASSWORD);
    ok("Login do admin funciona", adminLogin.ok, adminLogin);
    const adminJar = adminLogin.jar;

    // Fixtures: duas equipes (A e B), cada uma com um supervisor e um vendedor.
    const supA = await createUser(adminJar, { name: `Supervisor A ${suffix}`, email: `sup.a.${suffix}@example.com`, role: "SUPERVISOR" });
    ok("Supervisor A criado", supA.status === 201, supA);
    cleanupUserIds.push(supA.body.user.id);

    const sellerA = await createUser(adminJar, { name: `Vendedor A ${suffix}`, email: `seller.a.${suffix}@example.com`, role: "VENDEDOR", supervisorId: supA.body.user.id });
    ok("Vendedor A criado", sellerA.status === 201, sellerA);
    cleanupUserIds.push(sellerA.body.user.id);

    const supB = await createUser(adminJar, { name: `Supervisor B ${suffix}`, email: `sup.b.${suffix}@example.com`, role: "SUPERVISOR" });
    ok("Supervisor B criado", supB.status === 201, supB);
    cleanupUserIds.push(supB.body.user.id);

    const supALogin = await login(`sup.a.${suffix}@example.com`, "Senha12345!");
    ok("Login do supervisor A funciona", supALogin.ok, supALogin);
    const supAJar = supALogin.jar;

    const supBLogin = await login(`sup.b.${suffix}@example.com`, "Senha12345!");
    ok("Login do supervisor B funciona", supBLogin.ok, supBLogin);
    const supBJar = supBLogin.jar;

    const sellerALogin = await login(`seller.a.${suffix}@example.com`, "Senha12345!");
    ok("Login do vendedor A funciona", sellerALogin.ok, sellerALogin);
    const sellerAJar = sellerALogin.jar;

    const customer = await prisma.customer.create({
      data: { contactName: `Cliente Metas E2E ${suffix}`, sellerId: sellerA.body.user.id },
    });
    cleanupCustomerIds.push(customer.id);

    // Caso 1: meta de R$ 10.000, R$ 7.000 confirmado -> 70%.
    {
      const created = await createGoal(supAJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 1_000_000, periodPreset: "30",
      });
      ok("Caso 1: supervisor cria meta de valor para o próprio vendedor", created.status === 201, created);
      cleanupGoalIds.push(created.body.goal.id);

      await prisma.sale.create({
        data: { customerId: customer.id, sellerId: sellerA.body.user.id, stage: "PAGAMENTO_CONFIRMADO", valueCents: 700_000, confirmedAt: new Date() },
      });

      const list = await listGoals(sellerAJar, sellerA.body.user.id);
      const row = list.body.goals.find((g) => g.goal.id === created.body.goal.id);
      ok("Caso 1: progresso calculado é 70%", row?.progress.progressPercent === 70, row);
    }

    // Caso 2: meta de 10 vendas, 7 confirmadas -> 70%. (soma com a venda do caso 1 seria 1 venda só;
    // usamos um vendedor/cliente novo para isolar a contagem.)
    {
      const created = await createGoal(supAJar, {
        sellerId: sellerA.body.user.id, type: "SALES_COUNT", targetSalesCount: 10, periodPreset: "30",
      });
      cleanupGoalIds.push(created.body.goal.id);

      for (let i = 0; i < 7; i++) {
        await prisma.sale.create({
          data: { customerId: customer.id, sellerId: sellerA.body.user.id, stage: "PAGAMENTO_CONFIRMADO", valueCents: 1000, confirmedAt: new Date() },
        });
      }

      const list = await listGoals(sellerAJar, sellerA.body.user.id);
      const row = list.body.goals.find((g) => g.goal.id === created.body.goal.id);
      ok("Caso 2: progresso calculado é 70% (7/10 vendas)", row?.progress.progressPercent === 70, row);

      // Caso 3/4: simulação e cotação real não convertida não alteram a contagem.
      await prisma.quote.create({ data: { customerId: customer.id, sellerId: sellerA.body.user.id, mode: "SIMULATION", status: "CALCULADA" } });
      await prisma.quote.create({ data: { customerId: customer.id, sellerId: sellerA.body.user.id, mode: "REAL", status: "ENVIADA_PARA_ANALISE" } });
      const cancelled = await prisma.sale.create({
        data: { customerId: customer.id, sellerId: sellerA.body.user.id, stage: "PAGAMENTO_CONFIRMADO", valueCents: 1000, confirmedAt: new Date() },
      });
      await prisma.sale.update({ where: { id: cancelled.id }, data: { stage: "CANCELADO", confirmedAt: null } });

      const listAfter = await listGoals(sellerAJar, sellerA.body.user.id);
      const rowAfter = listAfter.body.goals.find((g) => g.goal.id === created.body.goal.id);
      ok(
        "Caso 3/4: simulação/cotação real não convertida/venda cancelada não alteram o progresso",
        rowAfter?.progress.progressPercent === 70,
        rowAfter
      );
    }

    // Caso 9: supervisor de outra equipe não pode criar meta para vendedor A.
    {
      const attempt = await createGoal(supBJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 100000, periodPreset: "7",
      });
      ok("Caso 9: supervisor de outra equipe é bloqueado (403)", attempt.status === 403, attempt);
    }

    // Vendedor nunca pode criar/alterar a própria meta.
    {
      const attempt = await createGoal(sellerAJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 100000, periodPreset: "7",
      });
      ok("Vendedor não pode criar a própria meta (403)", attempt.status === 403, attempt);
    }

    // Caso 5/6/7: aviso de prazo. Cria a meta via API (30 dias) e depois
    // ajusta start/end diretamente no banco para simular "faltam N dias",
    // já que esperar dias reais não é viável num teste automatizado.
    for (const [presetDays, remainingDays] of [[30, 7], [15, 4], [7, 2]]) {
      const created = await createGoal(supAJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 100_000_000, periodPreset: String(presetDays),
      });
      cleanupGoalIds.push(created.body.goal.id);

      const now = new Date();
      const startDate = new Date(now.getTime() - (presetDays - remainingDays) * 86400000);
      const endDate = new Date(now.getTime() + remainingDays * 86400000);
      await prisma.salesGoal.update({ where: { id: created.body.goal.id }, data: { startDate, endDate } });

      await listGoals(supAJar, sellerA.body.user.id); // GET /api/goals roda syncGoalAlerts()

      const warning = await prisma.notification.findFirst({
        where: { goalId: created.body.goal.id, type: "GOAL_WARNING", recipientId: sellerA.body.user.id },
      });
      ok(`Caso alerta (${presetDays}d -> faltam ${remainingDays}d): aviso GOAL_WARNING criado para o vendedor`, Boolean(warning), warning);
      const warningSupervisor = await prisma.notification.findFirst({
        where: { goalId: created.body.goal.id, type: "GOAL_WARNING", recipientId: supA.body.user.id },
      });
      ok(`Caso alerta (${presetDays}d -> faltam ${remainingDays}d): aviso GOAL_WARNING criado para o supervisor`, Boolean(warningSupervisor), warningSupervisor);
    }

    // Caso 8: meta atinge 100% -> ACHIEVED + aviso único para vendedor e supervisor.
    {
      const created = await createGoal(supAJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 500_000, periodPreset: "30",
      });
      cleanupGoalIds.push(created.body.goal.id);
      await prisma.sale.create({
        data: { customerId: customer.id, sellerId: sellerA.body.user.id, stage: "PAGAMENTO_CONFIRMADO", valueCents: 500_000, confirmedAt: new Date() },
      });

      await listGoals(supAJar, sellerA.body.user.id);
      await listGoals(supAJar, sellerA.body.user.id); // roda de novo de propósito

      const updated = await prisma.salesGoal.findUnique({ where: { id: created.body.goal.id } });
      ok("Caso 8: status vira ACHIEVED", updated?.status === "ACHIEVED", updated);

      const achievedSeller = await prisma.notification.count({ where: { goalId: created.body.goal.id, type: "GOAL_ACHIEVED", recipientId: sellerA.body.user.id } });
      const achievedSupervisor = await prisma.notification.count({ where: { goalId: created.body.goal.id, type: "GOAL_ACHIEVED", recipientId: supA.body.user.id } });
      ok("Caso 8: exatamente 1 aviso para o vendedor (sem duplicar)", achievedSeller === 1, { achievedSeller });
      ok("Caso 8: exatamente 1 aviso para o supervisor (sem duplicar)", achievedSupervisor === 1, { achievedSupervisor });
    }

    // Caso 10: meta expira sem atingir 100% -> EXPIRED.
    {
      const created = await createGoal(supAJar, {
        sellerId: sellerA.body.user.id, type: "REVENUE", targetValueCents: 100_000_000, periodPreset: "7",
      });
      cleanupGoalIds.push(created.body.goal.id);
      const now = new Date();
      await prisma.salesGoal.update({
        where: { id: created.body.goal.id },
        data: { startDate: new Date(now.getTime() - 10 * 86400000), endDate: new Date(now.getTime() - 1 * 86400000) },
      });

      await listGoals(supAJar, sellerA.body.user.id);

      const updated = await prisma.salesGoal.findUnique({ where: { id: created.body.goal.id } });
      ok("Caso 10: status vira EXPIRED", updated?.status === "EXPIRED", updated);
      const expiredCount = await prisma.notification.count({ where: { goalId: created.body.goal.id, type: "GOAL_EXPIRED" } });
      ok("Caso 10: aviso de expiração enviado ao vendedor e ao supervisor", expiredCount === 2, { expiredCount });
    }
  } finally {
    await prisma.notification.deleteMany({ where: { goalId: { in: cleanupGoalIds } } });
    await prisma.salesGoal.deleteMany({ where: { id: { in: cleanupGoalIds } } });
    await prisma.sale.deleteMany({ where: { customerId: { in: cleanupCustomerIds } } });
    await prisma.quote.deleteMany({ where: { customerId: { in: cleanupCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
